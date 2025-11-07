export function modalAddress() {
  document.getElementById("modalCopyAddress").addEventListener("click", function () {
    const addressElement = document.getElementById("modalAddressWallet");
    const copyButton = this;
    const originalText = addressElement.textContent;

    if (copyButton.disabled) return;

    navigator.clipboard.writeText(originalText).then(() => {
      addressElement.textContent = "Copied!";
      copyButton.disabled = true;

      setTimeout(() => {
        addressElement.textContent = originalText;
        copyButton.disabled = false;
      }, 1500);
    });
  });
}