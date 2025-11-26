
/// steps.js — devnet версия, без ES-модулей
(() => {
  // ========= CONFIG =========
  const RPC_URL = "https://api.devnet.solana.com"; // devnet
  const TOKEN_SERVICE_URL = "http://localhost:3001"; // Token Service (Node.js)
  // Определяем базовый URL API автоматически.
  // 1) meta[name="api-base"] имеет приоритет
  // 2) если фронт работает на 3000 → шьём :8000 на тот же host
  // 3) иначе — тот же origin (пустая строка = относительные пути)
  const API_BASE = (() => {
    try {
      const meta = document.querySelector('meta[name="api-base"]');
      const fromMeta = meta && meta.getAttribute('content');
      if (fromMeta && typeof fromMeta === 'string') {
        return fromMeta.replace(/\/$/, '');
      }
      const loc = window.location;
      const port = Number(loc.port || (loc.protocol === 'https:' ? 443 : 80));
      if (port === 3000) {
        return `${loc.protocol}//${loc.hostname}:8000`;
      }
      return "";
    } catch (_e) {
      return "";
    }
  })();

  // web3 глобаль приходит из <script src="...iife.min.js">
  const solanaWeb3 = window.solanaWeb3;
  const { Connection, PublicKey, Transaction } = solanaWeb3;

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

  async function freshBlockhash(connection) {
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    return blockhash;
  }

  // Перед подписью: всем транзам ставим feePayer и свежий blockhash (devnet)
  async function prepareUnsignedTxs(base64List, connection, feePayer) {
    const blockhash = await freshBlockhash(connection);
    const payer = new PublicKey(feePayer);
    return base64List.map((b64) => {
      const tx = Transaction.from(b64ToBytes(b64));
      tx.feePayer = payer;
      tx.recentBlockhash = blockhash;
      return tx;
    });
  }

  async function signAll(provider, txs) {
    // и Phantom, и Solflare имеют signAllTransactions
    return provider.wallet.signAllTransactions(txs);
  }

  async function sendAndConfirm(connection, signedTx) {
    const sig = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    // devnet подтверждение
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  async function sendAll(connection, signedTxs) {
    const sigs = [];
    for (const stx of signedTxs) {
      const sig = await sendAndConfirm(connection, stx);
      sigs.push(sig);
      await sleep(150);
    }
    return sigs;
  }

  // Универсалка под /api/proceed и /api/listing
  async function signAndSendFromApiResponse(apiData, feePayer) {
    const connection = new Connection(RPC_URL, "confirmed");
    const provider = await getProvider();

    // Соберём список base64-транзакций
    let base64List = [];
    if (Array.isArray(apiData?.updatedTx) && apiData.updatedTx.length) {
      base64List = apiData.updatedTx;
    } else if (apiData?.tx) {
      base64List = [apiData.tx];
    } else {
      throw new Error("API did not return tx/updatedTx.");
    }

    // 1) feePayer + свежий blockhash с DEVNET
    let unsigned = await prepareUnsignedTxs(base64List, connection, feePayer);

    // 2) подпись кошельком
    let signed = await signAll(provider, unsigned);

    // 3) отправка (+ 1 ретрай при “blockhash not found/expired”)
    try {
      return await sendAll(connection, signed);
    } catch (err) {
      const msg = String(err?.message || err);
      const bhExpired =
        /blockhash not found/i.test(msg) ||
        /Transaction expired/i.test(msg) ||
        /Blockhash not found/i.test(msg);
      if (bhExpired) {
        unsigned = await prepareUnsignedTxs(base64List, connection, feePayer);
        signed = await signAll(provider, unsigned);
        return await sendAll(connection, signed);
      }
      throw err;
    }
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

  function updateCost() {
    const baseCost = 0.2;
    const revokeCostReal = (revokeState.freeze ? 0.0999 : 0) + 
                           (revokeState.mint ? 0.0999 : 0) + 
                           (revokeState.update ? 0.0999 : 0);
    const revokeCostDisplay = (revokeState.freeze ? 0.1 : 0) + 
                              (revokeState.mint ? 0.1 : 0) + 
                              (revokeState.update ? 0.1 : 0);
    const total = baseCost + revokeCostDisplay;
    
    if (elTotalCost) {
      if (revokeCostDisplay > 0) {
        elTotalCost.textContent = `Cost: ${baseCost.toFixed(1)} SOL + ${revokeCostDisplay.toFixed(1)} SOL (revokes) = ${total.toFixed(1)} SOL`;
      } else {
        elTotalCost.textContent = `Cost: ${total.toFixed(1)} SOL`;
      }
      elTotalCost.style.display = "block";
    }
  }

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
      const tokenName = document.getElementById("tokenName")?.value || "";
      const tokenSymbol = document.getElementById("tokenSymbol")?.value || "";
      const description = document.getElementById("description")?.value || "";
      console.log("[onCreateToken] Description from form:", description);
      const ipfsLogo = (window.formData && window.formData.tokenLogo) || "";

      // Валидация: проверяем, что name и symbol не пустые
      if (!tokenName || !tokenName.trim()) {
        throw new Error("Token name is required");
      }
      if (!tokenSymbol || !tokenSymbol.trim()) {
        throw new Error("Token symbol is required");
      }

      // Сохраняем значения для использования в обоих шагах
      const savedTokenName = tokenName.trim();
      const savedTokenSymbol = tokenSymbol.trim();
      const savedIpfsLogo = ipfsLogo;

      const connection = new solanaWeb3.Connection(RPC_URL, "confirmed");
      const provider = await getProvider();

      // Получаем конфиг с fixed_charge
      let chargeTo = null;
      let fixedChargeSol = 0;
      try {
        const configResp = await fetch(`${API_BASE}/api/config`);
        if (configResp.ok) {
          const config = await configResp.json();
          chargeTo = config.charge_to || null;
          fixedChargeSol = config.fixed_charge_sol || 0;
          console.log(`[Config] charge_to: ${chargeTo}, fixed_charge_sol: ${fixedChargeSol}`);
        }
      } catch (error) {
        console.warn("Failed to fetch config, continuing without fixed_charge:", error);
      }

      const revokeCostReal = (revokeState.freeze ? 0.0999 : 0) + 
                             (revokeState.mint ? 0.0999 : 0) + 
                             (revokeState.update ? 0.0999 : 0);
      const revokeCostDisplay = (revokeState.freeze ? 0.1 : 0) + 
                                (revokeState.mint ? 0.1 : 0) + 
                                (revokeState.update ? 0.1 : 0);
      
      if (revokeCostReal > 0) {
        console.log(`[Revokes] Will charge ${revokeCostReal.toFixed(4)} SOL separately for revokes (freeze: ${revokeState.freeze}, mint: ${revokeState.mint}, update: ${revokeState.update})`);
      }

    if (elLoadInfo) {
        const revokeText = revokeCostDisplay > 0 ? ` (revokes will be charged separately: ${revokeCostDisplay.toFixed(1)} SOL)` : '';
        elLoadInfo.textContent = `Step 1/2: Creating token (service fee: ${fixedChargeSol.toFixed(1)} SOL${revokeText})...`;
      }
      
      const createResp = await fetch(`${TOKEN_SERVICE_URL}/api/create-token-metaplex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: storedWallet,
          name: savedTokenName,
          symbol: savedTokenSymbol,
          decimals,
          image_uri: savedIpfsLogo,
          priority_fee: 250000,
          rpc_url: RPC_URL,
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
      
      // Обновляем blockhash перед подписью (может устареть между созданием и подписью)
      const { blockhash } = await connection.getLatestBlockhash("finalized");
      tx1.recentBlockhash = blockhash;
      
      const mintKeypair = solanaWeb3.Keypair.fromSecretKey(new Uint8Array(mintSecretKey));
      tx1.partialSign(mintKeypair);
        
      const signedTx1 = await provider.wallet.signTransaction(tx1);
      
      if (elLoadInfo) elLoadInfo.textContent = "Sending first transaction...";
      
      let binary1 = '';
      const signedTx1Bytes = signedTx1.serialize();
      for (let i = 0; i < signedTx1Bytes.length; i++) {
        binary1 += String.fromCharCode(signedTx1Bytes[i]);
      }
      const signedTx1Base64 = btoa(binary1);
      
      const send1Resp = await fetch(`${TOKEN_SERVICE_URL}/api/send-transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signed_transaction: signedTx1Base64,
          rpc_url: RPC_URL,
        }),
      });

      const send1Data = await send1Resp.json();
      if (!send1Resp.ok || !send1Data?.success) {
        throw new Error(send1Data?.error || "Failed to send first transaction");
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
          image: savedIpfsLogo || "" // Может быть пустым
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
      
      const metadataResp = await fetch(`${TOKEN_SERVICE_URL}/api/add-metaplex-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: mint,
          mint_secret_key: mintSecretKey,
          payer: storedWallet,
          name: savedTokenName,
          symbol: savedTokenSymbol,
          uri: metadataUri, // URI JSON метаданных, а не изображения напрямую
          rpc_url: RPC_URL,
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
      
      // Обновляем blockhash перед подписью (может устареть между созданием и подписью)
      const { blockhash: blockhash2 } = await connection.getLatestBlockhash("finalized");
      tx2.recentBlockhash = blockhash2;
      
      const signedTx2 = await provider.wallet.signTransaction(tx2);
      
      if (elLoadInfo) elLoadInfo.textContent = "Sending second transaction...";
      
      let binary2 = '';
      const signedTx2Bytes = signedTx2.serialize();
      for (let i = 0; i < signedTx2Bytes.length; i++) {
        binary2 += String.fromCharCode(signedTx2Bytes[i]);
      }
      const signedTx2Base64 = btoa(binary2);
      
      const send2Resp = await fetch(`${TOKEN_SERVICE_URL}/api/send-transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signed_transaction: signedTx2Base64,
          rpc_url: RPC_URL,
        }),
      });

      const send2Data = await send2Resp.json();
      if (!send2Resp.ok || !send2Data?.success) {
        throw new Error(send2Data?.error || "Failed to send second transaction");
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
              
              if (tokenInstructions.length === 0 && (revokeState.mint || revokeState.freeze)) {
                console.error(`❌ CRITICAL: No Token Program instructions found! Expected revoke instructions but transaction only has:`, 
                  tx.instructions.map(ix => ix.programId.toBase58())
                );
                if (elLoadInfo) {
                  elLoadInfo.textContent = `Error: Transaction missing revoke instructions. Please contact support.`;
                  elLoadInfo.style.color = "#ff4444";
                }
                continue;
              }
              
              const { blockhash } = await connection.getLatestBlockhash("finalized");
              console.log(`🔗 New blockhash: ${blockhash}`);
              tx.recentBlockhash = blockhash;
              console.log(`✅ Blockhash updated in transaction`);
              
              // Проверка после изменения blockhash
              const tokenInstructionsAfter = tx.instructions.filter(ix => {
                const programId = ix.programId.toBase58();
                return programId === TOKEN_2022_PROGRAM_ID || programId === TOKEN_PROGRAM_ID;
              });
              console.log(`🔍 Token Program instructions after blockhash update:`, {
                found: tokenInstructionsAfter.length,
                instructionsCount: tx.instructions.length
              });
              
              if (tokenInstructionsAfter.length === 0 && (revokeState.mint || revokeState.freeze)) {
                console.error(`❌ CRITICAL: Token Program instructions lost after blockhash update!`);
              }
              
              console.log(`✍️ Signing transaction...`);
              const signedTx = await provider.wallet.signTransaction(tx);
              console.log(`✅ Transaction signed:`, {
                signatures: signedTx.signatures.map(sig => sig.publicKey.toBase58()),
                signatureCount: signedTx.signatures.length
              });
              
              if (elLoadInfo) elLoadInfo.textContent = `Sending revoke transaction ${i + 1}/${revokeData.transactions.length}...`;
              
              let binary = '';
              const signedBytes = signedTx.serialize();
              console.log(`📦 Serialized signed transaction: ${signedBytes.length} bytes`);
              for (let j = 0; j < signedBytes.length; j++) {
                binary += String.fromCharCode(signedBytes[j]);
              }
              const signedB64 = btoa(binary);
              console.log(`📤 Sending transaction to ${TOKEN_SERVICE_URL}/api/send-transaction`);
              
              const sendRevokeResp = await fetch(`${TOKEN_SERVICE_URL}/api/send-transaction`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  signed_transaction: signedB64,
                  rpc_url: RPC_URL,
                }),
              });
              
              console.log(`📥 Response status: ${sendRevokeResp.status} ${sendRevokeResp.statusText}`);
              const sendRevokeData = await sendRevokeResp.json();
              console.log(`📥 Response data:`, sendRevokeData);
              
              if (!sendRevokeResp.ok || !sendRevokeData?.success) {
                const errorMsg = sendRevokeData?.error || sendRevokeData?.detail || sendRevokeData?.message || "Unknown error";
                console.error(`❌ Failed to send revoke transaction ${i + 1}:`, {
                  status: sendRevokeResp.status,
                  statusText: sendRevokeResp.statusText,
                  error: errorMsg,
                  fullResponse: sendRevokeData
                });
                
                // Сохраняем информацию о неудачной попытке revoke для возможности повтора
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
                
                // Не прерываем процесс - токен уже создан, revoke можно повторить позже
                // Но логируем ошибку для пользователя
              } else {
                console.log(`✅ Revoke transaction ${i + 1} sent successfully:`, {
                  signature: sendRevokeData.signature,
                  success: sendRevokeData.success
                });
                
                // Проверяем, что транзакция действительно подтверждена
                if (sendRevokeData.signature) {
                  console.log(`🔍 Check transaction on explorer:`, {
                    devnet: `https://explorer.solana.com/tx/${sendRevokeData.signature}?cluster=devnet`,
                    solscan: `https://solscan.io/tx/${sendRevokeData.signature}?cluster=devnet`
                  });
                }
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

