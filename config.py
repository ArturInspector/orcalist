# config.py
import os
from dotenv import load_dotenv

load_dotenv()

HELIUS_API_KEY = os.getenv("HELIUS_API_KEY", "").strip()
NETWORK = os.getenv("NETWORK", "devnet").strip().lower()

if HELIUS_API_KEY:
    if NETWORK == "mainnet":
        RPC_URL = f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"
    else:
        RPC_URL = f"https://devnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"
        RPC_PROVIDER = "Helius"
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
PINATA_API_KEY = os.getenv("PINATA_API_KEY", "").strip()  # для v1 legacy)
PINATA_SECRET_KEY = os.getenv("PINATA_SECRET_KEY", "").strip()  # для v1

