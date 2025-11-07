
/// steps.js — devnet версия, без ES-модулей
(() => {
  // ========= CONFIG =========
  const RPC_URL = "https://api.devnet.solana.com"; // devnet
  const API_BASE = ""; // бек смонтирован на том же домене, /api/...

  // web3 глобаль приходит из <script src="...iife.min.js">
  const { Connection, PublicKey, Transaction } = window.solanaWeb3;

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
      return { name: "phantom", wallet: window.solana };
    }
    if (which === "solflare" && window.solflare) {
      if (!window.solflare.isConnected) await window.solflare.connect();
      return { name: "solflare", wallet: window.solflare };
    }
    // Фоллбек: если провайдер не выбран — пробуем Phantom
    if (window.solana?.isPhantom) {
      if (!window.solana.isConnected) await window.solana.connect();
      sessionStorage.setItem("walletProvider", "phantom");
      return { name: "phantom", wallet: window.solana };
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
  const elLoadInfo = document.querySelector(".load__info");
  const elExplorer = document.getElementById("explorerLink");
  const elSolscan = document.getElementById("solcanLink");
  const elModalAddress = document.getElementById("modalAddressWallet");

  function short(addr) {
    if (!addr || addr.length < 10) return addr || "";
    return `${addr.slice(0, 5)}...${addr.slice(-5)}`;
  }

  // CREATE TOKEN
  async function onCreateToken() {
    try {
      if (!elCreateBtn) return;
      elCreateBtn.disabled = true;
      if (elLoadInfo) {
        elLoadInfo.style.display = "flex";
        elLoadInfo.textContent = "Preparing transaction…";
      }

      const storedWallet = sessionStorage.getItem("walletAddress");
      if (!storedWallet) throw new Error("Connect wallet first.");

      // БАЗОВЫЕ ПОЛЯ
      const decimals = Number(document.getElementById("decimals")?.value || 9);
      const tokenName = document.getElementById("tokenName")?.value || "Token";
      const tokenSymbol = document.getElementById("tokenSymbol")?.value || "TKN";
      const description = document.getElementById("description")?.value || "";
      const ipfsLogo = (window.formData && window.formData.tokenLogo) || "";

      // Вызов бэка — он собирает транзу (создание + фикс-чардж)
      const r = await fetch(`${API_BASE}/api/proceed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: storedWallet,
          decimals,
          name: tokenName,
          symbol: tokenSymbol,
          description,
          metadata_uri: ipfsLogo,
          priority_fee: 0,          // на devnet не нужен
          use_token_2022: true
        }),
      });

      const data = await r.json();
      if (!r.ok || !data?.success) {
        throw new Error(data?.detail || data?.message || "API /api/proceed failed");
      }

      // Подписываем и шлём
      if (elLoadInfo) elLoadInfo.textContent = "Sign in wallet and send…";
      await signAndSendFromApiResponse(data, storedWallet);

      const mint = data.mint;
      sessionStorage.setItem("token", mint);

      // ссылки на devnet
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
      if (elLoadInfo) elLoadInfo.textContent = String(e?.message || e);
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

  // Закрытие модалки
  const closeModal = document.getElementById("modalSuccessClose");
  if (closeModal) {
    closeModal.addEventListener("click", () => {
      if (elModal) elModal.classList.remove("active");
      document.documentElement.style.overflow = "";
      document.body.classList.remove("active");
    });
  }
})();

