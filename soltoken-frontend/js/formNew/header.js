document.addEventListener("DOMContentLoaded", async () => {
  const { Connection } = window.solanaWeb3;
  const connection = new Connection("https://solana-rpc.publicnode.com", "confirmed");

  const connectWalletButton   = document.getElementById("connectWalletButton"); // в шапке
  const connectWalletBtn      = document.getElementById("connectWalletBtn");    // в форме
  const walletConnectSolflare = document.getElementById("walletConnectSolflare");
  const walletConnectPhantom  = document.getElementById("walletConnectPhantom");
  const walletMenu            = document.getElementById("walletMenuConnect");
  const walletMenuActions     = document.getElementById("walletMenuActions");

  // --- Helpers ---
  const getPhantom = () => {
    const provider = window.phantom?.solana || window.solana;
    return provider?.isPhantom ? provider : null;
  };
  const getSolflare = () => (window.solflare?.isSolflare ? window.solflare : null);

  function shortenAddress(address) {
    return `${address.slice(0, 5)}...${address.slice(-5)}`;
  }

  function updateUIAfterConnect(walletAddress) {
    if (connectWalletButton) {
      connectWalletButton.innerHTML = `<span class="btn-xe__address">${shortenAddress(walletAddress)}</span>`;
    }
    if (connectWalletBtn) {
      connectWalletBtn.innerHTML = `<span class="btn-xe__address">${shortenAddress(walletAddress)}</span>`;
    }

    walletMenu?.classList.remove("active");
    walletMenuActions?.classList.remove("active");

    const makeItem    = document.querySelector(".make__item");
    const makeConnect = document.querySelector(".make__connect");
    const stepOne     = document.getElementById("stepOne");

    if (makeItem)    makeItem.style.display = "block";
    if (makeConnect) makeConnect.style.display = "none";
    if (stepOne)     stepOne.style.display = "block";
  }

  function resetUIToDisconnected() {
    if (connectWalletButton) connectWalletButton.textContent = "Connect wallet";
    if (connectWalletBtn)    connectWalletBtn.textContent    = "Connect wallet";

    walletMenuActions?.classList.remove("active");
    walletMenu?.classList.remove("active");

    const makeItem    = document.querySelector(".make__item");
    const makeConnect = document.querySelector(".make__connect");
    const stepOne     = document.getElementById("stepOne");

    if (makeItem)    makeItem.style.display = "none";
    if (makeConnect) makeConnect.style.display = "flex";
    if (stepOne)     stepOne.style.display = "none";
  }

  function checkStoredWallet() {
    const storedWallet = sessionStorage.getItem("walletAddress");
    if (storedWallet) {
      updateUIAfterConnect(storedWallet);
    } else {
      resetUIToDisconnected();
    }
  }

  checkStoredWallet();

  // --- Connectors ---
  async function connectPhantom() {
    try {
      const provider = getPhantom();
      if (!provider) {
        alert("Phantom wallet not installed!");
        return;
      }

      const res = await provider.connect();
      const walletAddress = res.publicKey.toString();

      sessionStorage.setItem("walletAddress", walletAddress);
      sessionStorage.setItem("walletProvider", "phantom");
      updateUIAfterConnect(walletAddress);
    } catch (error) {
      // Connection error - silently fail
    }
  }

  async function connectSolflare() {
    try {
      const provider = getSolflare();
      if (!provider) {
        alert("Solflare wallet not installed!");
        return;
      }

      await provider.connect();
      const walletAddress = provider.publicKey.toString();

      sessionStorage.setItem("walletAddress", walletAddress);
      sessionStorage.setItem("walletProvider", "solflare");
      updateUIAfterConnect(walletAddress);
    } catch (error) {
      // Connection error - silently fail
    }
  }

  // --- Actions ---
  function copyAddress() {
    const walletAddress = sessionStorage.getItem("walletAddress");
    if (!walletAddress) return;
    const textArea = document.createElement("textarea");
    textArea.value = walletAddress;
    document.body.appendChild(textArea);
    textArea.select();
    textArea.setSelectionRange(0, 99999);
    try {
      document.execCommand("copy");
    } catch (err) {
      // Copy failed - silently ignore
    }
    document.body.removeChild(textArea);
  }

  async function disconnectWallet() {
    const providerName = sessionStorage.getItem("walletProvider");
    try {
      if (providerName === "phantom") {
        const p = getPhantom();
        if (p?.isConnected) await p.disconnect();
      } else if (providerName === "solflare") {
        const s = getSolflare();
        if (s?.isConnected) await s.disconnect();
      }
    } catch (e) {
      // игнорируем ошибки
    }

    sessionStorage.removeItem("walletAddress");
    sessionStorage.removeItem("walletProvider");
    resetUIToDisconnected();
  }

  function changeWallet() {
    sessionStorage.removeItem("walletAddress");
    sessionStorage.removeItem("walletProvider");
    walletMenuActions?.classList.remove("active");
    walletMenu?.classList.add("active");
    resetUIToDisconnected();
  }

  function toggleWalletMenu() {
    if (sessionStorage.getItem("walletAddress")) {
      walletMenuActions?.classList.toggle("active");
    } else {
      walletMenu?.classList.toggle("active");
    }
  }

  // --- Listeners ---
  document.getElementById("walletCopyAddress")?.addEventListener("click", copyAddress);
  document.getElementById("walletDisconnect")?.addEventListener("click", disconnectWallet);
  document.getElementById("walletChange")?.addEventListener("click", changeWallet);

  connectWalletButton?.addEventListener("click", toggleWalletMenu);
  connectWalletBtn?.addEventListener("click", () => {
    if (!sessionStorage.getItem("walletAddress")) {
      walletMenu?.classList.toggle("active");
    } else {
      walletMenuActions?.classList.toggle("active");
    }
  });

  walletConnectPhantom?.addEventListener("click", connectPhantom);
  walletConnectSolflare?.addEventListener("click", connectSolflare);

  // Подписки на события Phantom (без логирования)
  const phantom = getPhantom();
  if (phantom) {
    phantom.on?.("connect", () => {});
    phantom.on?.("disconnect", () => {});
    phantom.on?.("accountChanged", () => {});
  }
});
