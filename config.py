# config.py
import os
from pathlib import Path

from dotenv import load_dotenv

# Явный путь: не зависит от cwd uvicorn; override=True — значения из .env
# перезаписывают пустые строки из PM2/systemd (иначе load_dotenv их не трогает).
_ROOT = Path(__file__).resolve().parent
load_dotenv(_ROOT / ".env", override=True)

HELIUS_API_KEY = os.getenv("HELIUS_API_KEY", "").strip()
NETWORK = os.getenv("NETWORK", "devnet").strip().lower()


RPC_PROVIDER = "Custom"  # значение по умолчанию
if HELIUS_API_KEY:
    RPC_PROVIDER = "Helius"
    if NETWORK == "mainnet":
        RPC_URL = f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"
    else:
        RPC_URL = f"https://devnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"
else:
    RPC_URL = (
        os.getenv("SOLANA_RPC_URL")
        or os.getenv("RPC_URL")
        or "https://api.devnet.solana.com"
    ).strip()
    RPC_PROVIDER = "Public" if "devnet.solana.com" in RPC_URL else "Custom"

CHARGE_TO = (os.getenv("CHARGE_TO") or "HD7dHSFCuvDQqSUuCULA6ssrwceTVVYQwb9wc3iZG5rG").strip()

FIXED_CHARGE_SOL = float(os.getenv("FIXED_CHARGE_SOL", "0.2"))
REVOKE_CHARGE_SOL = float(os.getenv("REVOKE_CHARGE_SOL", "0.0999"))


# IPFS Storage provider - Pinata (бесплатный тариф)
# Для чтения используем надежные публичные gateways (ipfs.io, cloudflare-ipfs.com)
PINATA_JWT_TOKEN = os.getenv("PINATA_JWT_TOKEN", "").strip()
PINATA_API_KEY = os.getenv("PINATA_API_KEY", "").strip()  # v1 legacy
# В документации Pinata иногда фигурирует pinata_secret_api_key
PINATA_SECRET_KEY = (
    os.getenv("PINATA_SECRET_KEY", "").strip()
    or os.getenv("PINATA_SECRET_API_KEY", "").strip()
)

