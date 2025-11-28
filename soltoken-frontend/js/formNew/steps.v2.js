
/// steps.js — devnet версия, без ES-модулей
(() => {
  // ========= CONFIG =========
  // Определяем базовый URL API автоматически.
  // 1) meta[name="api-base"] имеет приоритет (если не пустой)
  // 2) если фронт работает на 3000 → шьём :8000 на тот же host
  // 3) если фронт на стандартных портах (80/443) → используем относительный путь (nginx проксирует)
  // 4) иначе — тот же origin (пустая строка = относительные пути)
  const API_BASE = (() => {
    try {
      const meta = document.querySelector('meta[name="api-base"]');
      const fromMeta = meta && meta.getAttribute('content');
      // Используем meta только если он не пустой
      if (fromMeta && typeof fromMeta === 'string' && fromMeta.trim()) {
        return fromMeta.replace(/\/$/, '');
      }
      const loc = window.location;
      const port = Number(loc.port || (loc.protocol === 'https:' ? 443 : 80));
      // Если фронтенд на порту 3000, API на порту 8000 того же хоста
      if (port === 3000) {
        return `${loc.protocol}//${loc.hostname}:8000`;
      }
      // Если фронтенд на стандартных портах (80/443), используем относительный путь
      // Nginx проксирует все запросы (включая /api/) на порт 8000
      if (port === 80 || port === 443) {
        return ""; // Относительный путь - nginx проксирует
      }
      // Иначе используем относительный путь
      return "";
    } catch (_e) {
      return "";
    }
  })();

  // Убрали TOKEN_SERVICE_URL - используем API_BASE для всех запросов
  // Все запросы идут через /api/, Python API проксирует на Token Service при необходимости

  // web3 глобаль приходит из <script src="...iife.min.js">
  const solanaWeb3 = window.solanaWeb3;
  const { PublicKey, Transaction } = solanaWeb3;

  // ========= HELPERS =========
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function getProvider() {
    const which = sessionStorage.getItem("walletProvider"); // 'phantom' | 'solflare'
    if (which === "phantom" && window.solana?.isPhantom) {
      if (!window.solana.isConnected) await window.solana.connect();
      return { name: "phantom", wallet: window.solana, isPhantom: true, isSolflare: false };
    }
    if (which === "solflare" && window.solflare) {
      if (!window.solflare.isConnected) await window.solflare.connect();
      return { name: "solflare", wallet: window.solflare, isPhantom: false, isSolflare: true };
    }
    // Фоллбек: если провайдер не выбран — пробуем Phantom
    if (window.solana?.isPhantom) {
      if (!window.solana.isConnected) await window.solana.connect();
      sessionStorage.setItem("walletProvider", "phantom");
      return { name: "phantom", wallet: window.solana, isPhantom: true, isSolflare: false };
    }
    throw new Error("Wallet is not connected (phantom/solflare).");
  }

  async function signAll(provider, txs) {
    return provider.wallet.signAllTransactions(txs);
  }

  async function signAndSendFromApiResponse(apiData, feePayer) {
    const provider = await getProvider();

    let base64List = [];
    if (Array.isArray(apiData?.updatedTx) && apiData.updatedTx.length) {
      base64List = apiData.updatedTx;
    } else if (apiData?.tx) {
      base64List = [apiData.tx];
    } else {
      throw new Error("API did not return tx/updatedTx.");
    }

    const payer = new PublicKey(feePayer);
    const unsigned = base64List.map((b64) => {
      const tx = Transaction.from(b64ToBytes(b64));
      tx.feePayer = payer;
      return tx;
    });

    const signed = await signAll(provider, unsigned);

    const sigs = [];
    for (const stx of signed) {
      let binary = '';
      const signedBytes = stx.serialize();
      for (let i = 0; i < signedBytes.length; i++) {
        binary += String.fromCharCode(signedBytes[i]);
      }
      const signedB64 = btoa(binary);

      const sendResp = await fetch(`${API_BASE}/api/send-transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signed_transaction: signedB64,
        }),
      });

      if (!sendResp.ok) {
        const errorData = await sendResp.json();
        throw new Error(errorData?.error || `Backend returned status ${sendResp.status}`);
      }

      const sendData = await sendResp.json();
      if (!sendData?.success) {
        throw new Error(sendData?.error || "Failed to send transaction");
      }

      sigs.push(sendData.signature);
      await sleep(150);
    }
    return sigs;
  }

  // ========= UI HOOKS =========

  // элементы
  const elCreateBtn = document.getElementById("createTokenBtn");
  const elModal = document.getElementById("modalSuccess");
  const elModalError = document.getElementById("modalError");
  const elLoadInfo = document.querySelector(".load__info");
  const elExplorer = document.getElementById("explorerLink");
  const elSolscan = document.getElementById("solcanLink");
  const elModalAddress = document.getElementById("modalAddressWallet");
  const elModalErrorText = document.getElementById("modalErrorText");
  const elTotalCost = document.getElementById("totalCost");

  const revokeState = {
    freeze: false,
    mint: false,
    update: false
  };

  // Захардкоженные значения (не зависят от API)
  let fixedChargeSol = 0.2;
  let revokeChargeSol = 0.0999;

  async function loadConfig() {
    // Загружаем только charge_to, остальное захардкожено
    try {
      const configResp = await fetch(`${API_BASE}/api/config`);
      if (configResp.ok) {
        const config = await configResp.json();
        // fixedChargeSol и revokeChargeSol захардкожены выше
        updateCost();
      }
    } catch (error) {
      console.warn("Failed to load config:", error);
    }
  }

  function updateCost() {
    const revokeCount = (revokeState.freeze ? 1 : 0) + (revokeState.mint ? 1 : 0) + (revokeState.update ? 1 : 0);
    const revokeCostDisplay = revokeCount * revokeChargeSol;
    const total = fixedChargeSol + revokeCostDisplay;
    
    if (elTotalCost) {
      if (revokeCostDisplay > 0) {
        elTotalCost.textContent = `Cost: ${fixedChargeSol.toFixed(2)} SOL + ${revokeCostDisplay.toFixed(2)} SOL (revokes) = ${total.toFixed(2)} SOL`;
      } else {
        elTotalCost.textContent = `Cost: ${total.toFixed(2)} SOL`;
      }
      elTotalCost.style.display = "block";
    }
  }

  loadConfig();

  document.querySelectorAll('.selector__btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const selector = this.closest('.selector');
      const selectType = selector?.getAttribute('data-select');
      if (!selectType) return;

      const isSelected = selector.classList.contains('selected');
      selector.classList.toggle('selected');
      revokeState[selectType] = !isSelected;
      
      this.textContent = revokeState[selectType] ? 'Selected' : 'Select to Revoke';
      updateCost();
    });
  });

  function short(addr) {
    if (!addr || addr.length < 10) return addr || "";
    return `${addr.slice(0, 5)}...${addr.slice(-5)}`;
  }

  function checkIncompleteTokenCreation() {
    try {
      const stateStr = sessionStorage.getItem("tokenCreationState");
      if (!stateStr) return false;
      
      const state = JSON.parse(stateStr);
      if (!state.mint || !state.mintSecretKey) return false;
      
      // Показываем предупреждение о незавершенном процессе
        if (elLoadInfo) {
          elLoadInfo.style.display = "flex";
          elLoadInfo.textContent = `⚠️ Unfinished token creation detected. Mint: ${short(state.mint)}. Continue on step 3.`;
          elLoadInfo.style.color = "#ff9900";
        }
      
      return true;
    } catch (error) {
      console.error("Error checking incomplete token creation:", error);
      return false;
    }
  }

  // Проверяем при загрузке страницы
  checkIncompleteTokenCreation();

  // CREATE TOKEN
  async function onCreateToken() {
    try {
      if (!elCreateBtn) return;
      elCreateBtn.disabled = true;
      if (elLoadInfo) {
        elLoadInfo.style.display = "flex";
        elLoadInfo.style.color = ""; // Сбрасываем цвет предупреждения
        elLoadInfo.textContent = "Preparing transaction…";
      }
      
      // Проверяем, есть ли незавершенный процесс
      const stateStr = sessionStorage.getItem("tokenCreationState");
      if (stateStr) {
        const savedState = JSON.parse(stateStr);
        if (savedState.step === "first_tx_sent" || savedState.step === "metadata_uploaded") {
          // Продолжаем с того места, где остановились
          console.log("🔄 Resuming incomplete token creation from step:", savedState.step);
          // Можно добавить логику восстановления здесь, но пока просто очищаем и начинаем заново
          // sessionStorage.removeItem("tokenCreationState");
        }
      }

      const storedWallet = sessionStorage.getItem("walletAddress");
      if (!storedWallet) throw new Error("Connect wallet first.");

      const decimals = Number(document.getElementById("decimals")?.value || 9);
      const supply = Number(document.getElementById("supply")?.value || 0);
      const tokenName = document.getElementById("tokenName")?.value || "";
      const tokenSymbol = document.getElementById("tokenSymbol")?.value || "";
      const description = document.getElementById("description")?.value || "";
      console.log("[onCreateToken] Description from form:", description);
      console.log("[onCreateToken] Supply from form:", supply);
      const ipfsLogo = (window.formData && window.formData.tokenLogo) || "";

      // Собираем соцсети
      const website = document.getElementById("website")?.value?.trim() || "";
      const twitter = document.getElementById("twitter")?.value?.trim() || "";
      const telegram = document.getElementById("telegram")?.value?.trim() || "";
      const discord = document.getElementById("discord")?.value?.trim() || "";

      if (!tokenName || !tokenName.trim()) {
        throw new Error("Token name is required");
      }
      if (!tokenSymbol || !tokenSymbol.trim()) {
        throw new Error("Token symbol is required");
      }

      const savedTokenName = tokenName.trim();
      const savedTokenSymbol = tokenSymbol.trim();
      const savedIpfsLogo = ipfsLogo;

      const provider = await getProvider();

      let chargeTo = null;
      // Захардкоженные значения
      const fixedChargeSol = 0.2;
      const revokeChargeSol = 0.0999;
      try {
        const configResp = await fetch(`${API_BASE}/api/config`);
        if (configResp.ok) {
          const config = await configResp.json();
          chargeTo = config.charge_to || null;
          // fixedChargeSol и revokeChargeSol захардкожены выше
          console.log(`[Config] charge_to: ${chargeTo}, fixed_charge_sol: ${fixedChargeSol}, revoke_charge_sol: ${revokeChargeSol}`);
        }
      } catch (error) {
        console.warn("Failed to fetch config, continuing without charge_to:", error);
      }

      const revokeCostReal = (revokeState.freeze ? revokeChargeSol : 0) + 
                             (revokeState.mint ? revokeChargeSol : 0) + 
                             (revokeState.update ? revokeChargeSol : 0);
      const revokeCostDisplay = (revokeState.freeze ? revokeChargeSol : 0) + 
                                (revokeState.mint ? revokeChargeSol : 0) + 
                                (revokeState.update ? revokeChargeSol : 0);
      
      if (revokeCostReal > 0) {
        console.log(`[Revokes] Will charge ${revokeCostReal.toFixed(4)} SOL separately for revokes (freeze: ${revokeState.freeze}, mint: ${revokeState.mint}, update: ${revokeState.update})`);
      }

    if (elLoadInfo) {
        const revokeText = revokeCostDisplay > 0 ? ` (revokes will be charged separately: ${revokeCostDisplay.toFixed(1)} SOL)` : '';
        elLoadInfo.textContent = `Step 1/2: Creating token (service fee: ${fixedChargeSol.toFixed(1)} SOL${revokeText})...`;
      }
      
      const createResp = await fetch(`${API_BASE}/api/create-token-metaplex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: storedWallet,
          name: savedTokenName,
          symbol: savedTokenSymbol,
          decimals,
          supply: supply > 0 ? supply : undefined,
          image_uri: savedIpfsLogo,
          priority_fee: 250000,
          charge_to: chargeTo,
          fixed_charge_sol: fixedChargeSol,
        }),
      });

      const createData = await createResp.json();
      if (!createResp.ok || !createData?.success) {
        throw new Error(createData?.error || "Failed to create base token");
      }

      const mint = createData.mint;
      const mintSecretKey = createData.mintSecretKey;
      
      // Сохраняем состояние для восстановления при перезагрузке страницы
      sessionStorage.setItem("tokenCreationState", JSON.stringify({
        step: "token_created",
        mint: mint,
        mintSecretKey: mintSecretKey,
        tokenName: savedTokenName,
        tokenSymbol: savedTokenSymbol,
        ipfsLogo: savedIpfsLogo,
        description: description,
        decimals: decimals,
      }));
      
      console.log("✅ Base token created (unsigned):", mint);

      // Sign & send first transaction
      const revokeText = revokeCostDisplay > 0 ? ` Revokes (${revokeCostDisplay.toFixed(1)} SOL) will be charged separately.` : '';
      if (elLoadInfo) elLoadInfo.textContent = `Please sign the first transaction in your wallet. This creates the token and pays the service fee (${fixedChargeSol.toFixed(1)} SOL total).${revokeText}`;
      
      const tx1Bytes = b64ToBytes(createData.transaction);
      const tx1 = solanaWeb3.Transaction.from(tx1Bytes);
      
      // IMPORTANT: User signs FIRST (Phantom requirement for single signer)
      // Then we add mintKeypair signature after user signs
      const signedTx1 = await provider.wallet.signTransaction(tx1);
      
      // Now add mintKeypair signature after user signed
      const mintKeypair = solanaWeb3.Keypair.fromSecretKey(new Uint8Array(mintSecretKey));
      signedTx1.partialSign(mintKeypair);
      
      if (elLoadInfo) elLoadInfo.textContent = "Sending first transaction...";
      
      let binary1 = '';
      const signedTx1Bytes = signedTx1.serialize();
      for (let i = 0; i < signedTx1Bytes.length; i++) {
        binary1 += String.fromCharCode(signedTx1Bytes[i]);
      }
      const signedTx1Base64 = btoa(binary1);
      
      let send1Resp;
      let send1Data;
      try {
        send1Resp = await fetch(`${API_BASE}/api/send-transaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signed_transaction: signedTx1Base64,
          }),
        });
        
        if (!send1Resp.ok) {
          throw new Error(`Backend returned status ${send1Resp.status}: ${send1Resp.statusText}`);
        }
        
        send1Data = await send1Resp.json();
        if (!send1Data?.success) {
          throw new Error(send1Data?.error || "Failed to send first transaction");
        }
      } catch (error) {
        if (error.message?.includes('fetch') || error.message?.includes('network') || error.message?.includes('Failed to fetch')) {
          throw new Error("Backend is not responding. Please try again later.");
        }
        throw error;
      }

      console.log("✅ First transaction sent:", send1Data.signature);
      
      // Обновляем состояние - первая транзакция отправлена
      const currentState = JSON.parse(sessionStorage.getItem("tokenCreationState") || "{}");
      currentState.step = "first_tx_sent";
      currentState.tx1Signature = send1Data.signature;
      sessionStorage.setItem("tokenCreationState", JSON.stringify(currentState));
      
      await sleep(1000); // wait for confirmation

      // ========= STEP 2: Upload metadata JSON to IPFS =========
      let metadataUri = "";
      if (elLoadInfo) elLoadInfo.textContent = "Uploading metadata to IPFS...";
      
      // Всегда загружаем метаданные JSON (даже без изображения)
      const metaResp = await fetch(`${API_BASE}/api/upload-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: savedTokenName,
          symbol: savedTokenSymbol,
          description: description,
          image: savedIpfsLogo || "", // Может быть пустым
          website: website,
          twitter: twitter,
          telegram: telegram,
          discord: discord
        }),
      });
      
      const metaData = await metaResp.json();
      if (metaResp.ok && metaData?.uri) {
        metadataUri = metaData.uri;
        console.log("✅ Metadata JSON uploaded to IPFS:", metadataUri);
        
        // Обновляем состояние - метаданные загружены
        const currentState = JSON.parse(sessionStorage.getItem("tokenCreationState") || "{}");
        currentState.step = "metadata_uploaded";
        currentState.metadataUri = metadataUri;
        sessionStorage.setItem("tokenCreationState", JSON.stringify(currentState));
      } else {
        console.warn("⚠️ Failed to upload metadata JSON, continuing without URI");
      }

      // ========= STEP 3: Add Metaplex metadata =========
      if (elLoadInfo) elLoadInfo.textContent = "Step 2/2: Adding metadata to token...";
      
      // Повторная валидация перед шагом 3 (на случай, если значения изменились)
      if (!savedTokenName || !savedTokenSymbol) {
        throw new Error("Token name and symbol are required for metadata");
      }
      
      const metadataResp = await fetch(`${API_BASE}/api/add-metaplex-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: mint,
          mint_secret_key: mintSecretKey,
          payer: storedWallet,
          name: savedTokenName,
          symbol: savedTokenSymbol,
          uri: metadataUri,
        }),
      });

      const metadataData = await metadataResp.json();
      if (!metadataResp.ok || !metadataData?.success) {
        throw new Error(metadataData?.error || "Failed to create metadata transaction");
      }

      console.log("✅ Metadata transaction created (unsigned)");

      // Sign & send second transaction
      if (elLoadInfo) elLoadInfo.textContent = "Please sign the second transaction in your wallet. This adds metadata (cost already included in 0.2 SOL service fee).";
      
      const tx2Bytes = b64ToBytes(metadataData.transaction);
      const tx2 = solanaWeb3.Transaction.from(tx2Bytes);
      
      const signedTx2 = await provider.wallet.signTransaction(tx2);
      
      if (elLoadInfo) elLoadInfo.textContent = "Sending second transaction...";
      
      let binary2 = '';
      const signedTx2Bytes = signedTx2.serialize();
      for (let i = 0; i < signedTx2Bytes.length; i++) {
        binary2 += String.fromCharCode(signedTx2Bytes[i]);
      }
      const signedTx2Base64 = btoa(binary2);
      
      let send2Resp;
      let send2Data;
      try {
        send2Resp = await fetch(`${API_BASE}/api/send-transaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signed_transaction: signedTx2Base64,
          }),
        });
        
        if (!send2Resp.ok) {
          throw new Error(`Backend returned status ${send2Resp.status}: ${send2Resp.statusText}`);
        }
        
        send2Data = await send2Resp.json();
        if (!send2Data?.success) {
          throw new Error(send2Data?.error || "Failed to send second transaction");
        }
      } catch (error) {
        if (error.message?.includes('fetch') || error.message?.includes('network') || error.message?.includes('Failed to fetch')) {
          throw new Error("Backend is not responding. Please try again later.");
        }
        throw error;
      }

      console.log("✅ Second transaction sent:", send2Data.signature);
      console.log("🎉 Token created with Metaplex metadata!");

      if (revokeState.freeze || revokeState.mint || revokeState.update) {
        if (elLoadInfo) elLoadInfo.textContent = "Preparing revoke transactions...";
        
        console.log("Requesting revoke transactions:", {
          wallet: storedWallet,
          mint: mint,
          revoke_mint: revokeState.mint,
          revoke_freeze: revokeState.freeze,
          revoke_update: revokeState.update
        });
        
        const revokeResp = await fetch(`${API_BASE}/api/revoke-all`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet: storedWallet,
            mint_address: mint,
            revoke_mint: revokeState.mint,
            revoke_freeze: revokeState.freeze,
            revoke_update: revokeState.update,
          }),
        });

        console.log(`📥 Revoke response status: ${revokeResp.status} ${revokeResp.statusText}`);
        const revokeData = await revokeResp.json();
        console.log(`📥 Revoke response data:`, revokeData);
        
        if (!revokeResp.ok) {
          const errorMsg = revokeData?.detail || revokeData?.message || revokeData?.error || "Failed to create revoke transactions";
          console.error("❌ Revoke request failed:", {
            status: revokeResp.status,
            statusText: revokeResp.statusText,
            error: errorMsg,
            fullResponse: revokeData
          });
          if (elLoadInfo) {
            elLoadInfo.textContent = `Error: ${errorMsg}`;
            elLoadInfo.style.color = "#ff4444";
          }
        } else if (revokeData?.success) {
          console.log("📋 Revoke response:", {
            success: revokeData.success,
            transactionsCount: revokeData.transactions?.length || 0,
            message: revokeData.message
          });
          
          if (revokeData.transactions?.length > 0) {
            if (elLoadInfo) elLoadInfo.textContent = `Please sign ${revokeData.transactions.length} revoke transaction(s)...`;
            
            for (let i = 0; i < revokeData.transactions.length; i++) {
              console.log(`\n🔄 Processing revoke transaction ${i + 1}/${revokeData.transactions.length}`);
              
              const txB64 = revokeData.transactions[i];
              console.log(`📦 Transaction base64 length: ${txB64.length} chars`);
              
              const txBytes = b64ToBytes(txB64);
              console.log(`📦 Transaction bytes length: ${txBytes.length} bytes`);
              
              const tx = solanaWeb3.Transaction.from(txBytes);
              console.log(`📝 Transaction after deserialize:`, {
                instructionsCount: tx.instructions.length,
                instructionPrograms: tx.instructions.map((ix, idx) => ({
                  index: idx,
                  programId: ix.programId.toBase58(),
                  keysCount: ix.keys.length,
                  dataLength: ix.data.length
                })),
                feePayer: tx.feePayer?.toBase58(),
                recentBlockhash: tx.recentBlockhash
              });
              
              // КРИТИЧЕСКАЯ ПРОВЕРКА: должны быть инструкции от Token Program
              const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
              const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
              const tokenInstructions = tx.instructions.filter(ix => {
                const programId = ix.programId.toBase58();
                return programId === TOKEN_2022_PROGRAM_ID || programId === TOKEN_PROGRAM_ID;
              });
              
              console.log(`🔍 Token Program instructions check:`, {
                found: tokenInstructions.length,
                expected: (revokeState.mint ? 1 : 0) + (revokeState.freeze ? 1 : 0),
                tokenInstructions: tokenInstructions.map((ix, idx) => ({
                  index: tx.instructions.indexOf(ix),
                  programId: ix.programId.toBase58(),
                  keysCount: ix.keys.length,
                  dataLength: ix.data.length
                }))
              });
              
              if (i === 0 && tokenInstructions.length === 0 && (revokeState.mint || revokeState.freeze)) {
                console.error(`❌ CRITICAL: First transaction should contain Token Program instructions!`);
                if (elLoadInfo) {
                  elLoadInfo.textContent = `Error: Transaction missing revoke instructions. Please contact support.`;
                  elLoadInfo.style.color = "#ff4444";
                }
                continue;
              }
              
              const METAPLEX_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
              const isUpdateRevokeTransaction = tx.instructions.some(ix => 
                ix.programId.toBase58() === METAPLEX_PROGRAM_ID
              );

              if (!isUpdateRevokeTransaction && tokenInstructions.length === 0 && (revokeState.mint || revokeState.freeze)) {
                // Это должна быть транзакция с mint/freeze revoke, но Token Program инструкций нет
                console.error(`❌ CRITICAL: No Token Program instructions found! Expected revoke instructions but transaction only has:`, 
                  tx.instructions.map(ix => ix.programId.toBase58())
                );
                if (elLoadInfo) {
                  elLoadInfo.textContent = `Error: Transaction missing revoke instructions. Please contact support.`;
                  elLoadInfo.style.color = "#ff4444";
                }
                continue;
              } else if (isUpdateRevokeTransaction) {
                // Это транзакция revoke_update - использует Metaplex Program, это нормально
                console.log(`✅ Update revoke transaction detected (Metaplex Program)`);
                console.log(`📋 Metaplex instruction details:`, {
                  programId: tx.instructions.find(ix => ix.programId.toBase58() === METAPLEX_PROGRAM_ID)?.programId.toBase58(),
                  keysCount: tx.instructions.find(ix => ix.programId.toBase58() === METAPLEX_PROGRAM_ID)?.keys.length,
                  dataLength: tx.instructions.find(ix => ix.programId.toBase58() === METAPLEX_PROGRAM_ID)?.data.length,
                });
              }
              
              // Проверка транзакции
              
              let signedTx;
              try {
                console.log(`✍️ Signing transaction...`);
                signedTx = await provider.wallet.signTransaction(tx);
                console.log(`✅ Transaction signed:`, {
                  signatures: signedTx.signatures.map(sig => sig.publicKey.toBase58()),
                  signatureCount: signedTx.signatures.length
                });
              } catch (error) {
                if (error.code === 4001 || error.message?.includes('User rejected') || error.message?.includes('User cancelled')) {
                  console.log('❌ User rejected transaction');
                  if (elLoadInfo) {
                    elLoadInfo.textContent = 'Transaction cancelled by user';
                    elLoadInfo.style.color = "#ff9900";
                  }
                  return;
                }
                throw error;
              }
              
              if (elLoadInfo) elLoadInfo.textContent = `Sending revoke transaction ${i + 1}/${revokeData.transactions.length}...`;
              
              let binary = '';
              const signedBytes = signedTx.serialize();
              console.log(`📦 Serialized signed transaction: ${signedBytes.length} bytes`);
              for (let j = 0; j < signedBytes.length; j++) {
                binary += String.fromCharCode(signedBytes[j]);
              }
              const signedB64 = btoa(binary);
              console.log(`📤 Sending transaction to ${API_BASE}/api/send-transaction`);
              
              let sendRevokeResp;
              let sendRevokeData;
              try {
                sendRevokeResp = await fetch(`${API_BASE}/api/send-transaction`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    signed_transaction: signedB64,
                  }),
                });
                
                if (!sendRevokeResp.ok) {
                  throw new Error(`Backend returned status ${sendRevokeResp.status}: ${sendRevokeResp.statusText}`);
                }
                
                console.log(`📥 Response status: ${sendRevokeResp.status} ${sendRevokeResp.statusText}`);
                sendRevokeData = await sendRevokeResp.json();
                console.log(`📥 Response data:`, sendRevokeData);
                
                if (!sendRevokeData?.success) {
                  throw new Error(sendRevokeData?.error || sendRevokeData?.detail || sendRevokeData?.message || "Failed to send revoke transaction");
                }
              } catch (error) {
                if (error.message?.includes('fetch') || error.message?.includes('network') || error.message?.includes('Failed to fetch') || error.message?.includes('Backend returned status')) {
                  const errorMsg = error.message?.includes('Backend returned status') ? error.message : "Backend is not responding. Please try again later.";
                  console.error(`❌ Backend error for revoke transaction ${i + 1}:`, errorMsg);
                  if (elLoadInfo) {
                    elLoadInfo.textContent = `Error: ${errorMsg}`;
                    elLoadInfo.style.color = "#ff4444";
                  }
                  throw error;
                }
                
                const errorMsg = sendRevokeData?.error || sendRevokeData?.detail || sendRevokeData?.message || error.message || "Unknown error";
                console.error(`❌ Failed to send revoke transaction ${i + 1}:`, {
                  status: sendRevokeResp?.status,
                  statusText: sendRevokeResp?.statusText,
                  error: errorMsg,
                  fullResponse: sendRevokeData
                });
                
                const revokeErrorInfo = {
                  mint: mint,
                  wallet: storedWallet,
                  revokeType: i === 0 ? (revokeState.mint ? 'mint' : 'freeze') : 'freeze',
                  error: errorMsg,
                  timestamp: new Date().toISOString()
                };
                console.warn(`⚠️ Revoke failed, you can retry later. Info:`, revokeErrorInfo);
                
                if (elLoadInfo) {
                  elLoadInfo.innerHTML = `
                    <div style="color: #ff4444;">
                      <strong>Error sending revoke transaction ${i + 1}:</strong><br>
                      ${errorMsg}<br><br>
                      <small style="color: #888;">
                        ⚠️ Your token was created successfully, but revoke failed.<br>
                        You can retry revoke later using the same mint address: <code>${mint}</code>
                      </small>
                    </div>
                  `;
                }
                return;
              }
              
              console.log(`✅ Revoke transaction ${i + 1} sent successfully:`, {
                signature: sendRevokeData.signature,
                success: sendRevokeData.success
              });
              
              if (sendRevokeData.signature) {
                console.log(`🔍 Check transaction on explorer:`, {
                  devnet: `https://explorer.solana.com/tx/${sendRevokeData.signature}?cluster=devnet`,
                  solscan: `https://solscan.io/tx/${sendRevokeData.signature}?cluster=devnet`
                });
              }
              
              await sleep(500);
            }
          } else {
            const message = revokeData.message || "All requested authorities are already revoked";
            console.log("Revoke info:", message);
            if (elLoadInfo) {
              elLoadInfo.textContent = message;
              elLoadInfo.style.color = "#44ff44";
            }
          }
        } else {
          const errorMsg = revokeData?.message || revokeData?.error || "Unknown error";
          console.error("Revoke failed:", errorMsg);
          if (elLoadInfo) {
            elLoadInfo.textContent = `Error: ${errorMsg}`;
            elLoadInfo.style.color = "#ff4444";
          }
        }
      }

      sessionStorage.removeItem("tokenCreationState");
      sessionStorage.setItem("token", mint);

      if (elExplorer) elExplorer.href = `https://explorer.solana.com/address/${mint}?cluster=devnet`;
      if (elSolscan) elSolscan.href = `https://solscan.io/token/${mint}?cluster=devnet`;
      if (elModalAddress) elModalAddress.textContent = short(mint);

      if (elLoadInfo) elLoadInfo.style.display = "none";
      if (elModal) {
        elModal.classList.add("active");
        document.documentElement.style.overflow = "hidden";
        document.body.classList.add("active");
      }
    } catch (e) {
      console.error(e);
      const errorMessage = String(e?.message || e);
      if (elLoadInfo) {
        elLoadInfo.style.display = "none";
      }
      if (elModalErrorText) {
        elModalErrorText.textContent = errorMessage;
      }
      if (elModalError) {
        elModalError.classList.add("active");
        document.documentElement.style.overflow = "hidden";
        document.body.classList.add("active");
      }
    } finally {
      if (elCreateBtn) elCreateBtn.disabled = false;
    }
  }

  // CREATE POOL (пока — простой SOL перевод на CHARGE_TO на бэке)
  async function onCreatePool() {
    try {
      const solValueInput = document.getElementById("solValue");
      const tokenAmountPool = document.getElementById("tokenAmountPool");
      const storedWallet = sessionStorage.getItem("walletAddress");

      if (!storedWallet) throw new Error("Connect wallet first.");
      if (!solValueInput || !tokenAmountPool) throw new Error("Pool inputs not found.");

      const solAmount = parseFloat(solValueInput.value);
      if (!Number.isFinite(solAmount) || solAmount <= 0) {
        solValueInput.style.border = "2px solid red";
        return;
      } else {
        solValueInput.style.border = "";
      }

      const mint = sessionStorage.getItem("token") || "";
      const r = await fetch(`${API_BASE}/api/listing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: {
            wallet: storedWallet,
            solAmount: String(solAmount),
            tokenAmount: tokenAmountPool.value || "",
            mint,
          },
        }),
      });

      const data = await r.json();
      if (!r.ok || !data?.success) {
        throw new Error(data?.detail || data?.message || "API /api/listing failed");
      }

      await signAndSendFromApiResponse(data, storedWallet);

      const modalTitle = document.getElementById("tokenTitleModal");
      if (modalTitle) modalTitle.textContent = "Liquidity pool transaction sent (devnet)!";
    } catch (e) {
      console.error(e);
      const solValueInput = document.getElementById("solValue");
      const tokenAmountPool = document.getElementById("tokenAmountPool");
      if (solValueInput) solValueInput.style.border = "2px solid red";
      if (tokenAmountPool) tokenAmountPool.style.border = "2px solid red";
    }
  }

  // Привязки
  const createBtn = document.getElementById("createTokenBtn");
  if (createBtn) createBtn.addEventListener("click", onCreateToken);

  const createPoolBtn = document.getElementById("createPool");
  if (createPoolBtn) createPoolBtn.addEventListener("click", onCreatePool);

  // Копирование адреса в модалке
  const copyBtn = document.getElementById("modalCopyAddress");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      const mint = sessionStorage.getItem("token") || "";
      const tempInput = document.createElement("input");
      document.body.appendChild(tempInput);
      tempInput.value = mint;
      tempInput.select();
      document.execCommand("copy");
      document.body.removeChild(tempInput);
      if (elModalAddress) {
        elModalAddress.textContent = "Copied!";
        setTimeout(() => (elModalAddress.textContent = short(mint)), 1200);
      }
      copyBtn.disabled = true;
      setTimeout(() => (copyBtn.disabled = false), 1200);
    });
  }

  // Закрытие модалки успеха
  const closeModal = document.getElementById("modalSuccessClose");
  if (closeModal) {
    closeModal.addEventListener("click", () => {
      if (elModal) elModal.classList.remove("active");
      document.documentElement.style.overflow = "";
      document.body.classList.remove("active");
    });
  }

  // Закрытие модалки ошибки
  const closeErrorModal = document.getElementById("modalErrorClose");
  if (closeErrorModal) {
    closeErrorModal.addEventListener("click", () => {
      if (elModalError) elModalError.classList.remove("active");
      document.documentElement.style.overflow = "";
      document.body.classList.remove("active");
    });
  }

  const stepOne = document.getElementById("stepOne");
  const stepTwo = document.getElementById("stepTwo");
  const stepThree = document.getElementById("stepThree");
  
  const stepNumOne = document.getElementById("stepNumOne");
  const stepNumTwo = document.getElementById("stepNumTwo");
  const stepNumThree = document.getElementById("stepNumThree");

  const btnChooseSupply = document.getElementById("manipulationBtn");
  const btnNextStepTwo = document.getElementById("nextStepTwoBtn");
  const backToStepOne = document.getElementById("backToStepOne");
  const backToStepTwo = document.getElementById("backToStepTwo");
  const stepThreeData = document.getElementById("stepThreeData");
  
  function setStep(active) {
    if (stepOne) stepOne.style.display = active === 1 ? "block" : "none";
    if (stepTwo) stepTwo.style.display = active === 2 ? "block" : "none";
    if (stepThree) stepThree.style.display = active === 3 ? "block" : "none";

    [stepNumOne, stepNumTwo, stepNumThree].forEach((el, idx) => {
      if (el) {
        if (active === idx + 1) el.classList.add("make__step--active");
        else el.classList.remove("make__step--active");
      }
    });

    if (btnChooseSupply) btnChooseSupply.style.display = active === 1 ? "inline-block" : "none";
    if (backToStepOne) backToStepOne.style.display = active === 2 ? "inline-block" : "none";
    if (btnNextStepTwo) btnNextStepTwo.style.display = active === 2 ? "inline-block" : "none";
    if (backToStepTwo) backToStepTwo.style.display = active === 3 ? "inline-block" : "none";
    if (stepThreeData) stepThreeData.style.display = active === 3 ? "block" : "none";
  }

  [stepNumOne, stepNumTwo, stepNumThree].forEach((el, idx) => {
    if (el) el.addEventListener("click", () => setStep(idx + 1));
  });

  try {
    const storedWallet = sessionStorage.getItem("walletAddress");
    if (storedWallet) {
      setStep(1);
      updateCost();
    }
  } catch (_) {}

  if (btnChooseSupply) btnChooseSupply.addEventListener("click", () => setStep(2));
  if (btnNextStepTwo) btnNextStepTwo.addEventListener("click", () => setStep(3));
  if (backToStepOne) backToStepOne.addEventListener("click", () => setStep(1));
  if (backToStepTwo) backToStepTwo.addEventListener("click", () => setStep(2));


  // Загрузка файла на IPFS через бэкенд
  async function uploadToIPFS(file) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch(`${API_BASE}/api/upload-ipfs`, {
        method: "POST",
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (!data.success || !data.ipfs_url) {
        throw new Error(data.message || "Upload failed");
      }
      
      return data.ipfs_url;
    } catch (error) {
      console.error("IPFS upload failed:", error);
      throw error;
    }
  }

  const selectLogoBtn = document.querySelector(".make__select");
  const logoInput = document.getElementById("tokenLogo");
  if (selectLogoBtn && logoInput) {
    selectLogoBtn.addEventListener("click", () => logoInput.click());
    logoInput.addEventListener("change", async () => {
      const file = logoInput.files && logoInput.files[0];
      if (!file) return;
      
      window.formData = window.formData || {};
      const label = document.querySelector(".make__select-text");
      const sublabel = document.querySelector(".make__select-subtext");
      
      if (label) label.textContent = "Uploading to IPFS...";
      if (sublabel) sublabel.textContent = "Please wait";
      
      try {
        const ipfsUrl = await uploadToIPFS(file);
        window.formData.tokenLogo = ipfsUrl;
        
        if (label) label.textContent = file.name || "logo uploaded";
        if (sublabel) sublabel.textContent = "IPFS: " + ipfsUrl.substring(0, 30) + "...";
        
        console.log("Image uploaded to IPFS:", ipfsUrl);
      } catch (error) {
        console.error("Failed to upload to IPFS:", error);
        if (label) label.textContent = "Upload failed, using local";
        if (sublabel) sublabel.textContent = "Click to retry";
        window.formData.tokenLogo = URL.createObjectURL(file);
      }
    });
  }
})();

