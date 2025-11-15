# utils/security_funcs.py
import hashlib
from typing import Optional
from urllib.parse import urlparse


def safe_wallet_log(wallet: str) -> str:
    #возвр безопасный для логирования wallet
    if not wallet or len(wallet) <= 8:
        return "***"
    return f"{wallet[:4]}...{wallet[-4:]}"


def hash_wallet(wallet: str) -> str:
    #возвр хэш
    if not wallet:
        return "none"
    return hashlib.sha256(wallet.encode()).hexdigest()[:12]


def hash_ip(ip: Optional[str]) -> str:
    if not ip:
        return "unknown"
    return hashlib.sha256(ip.encode()).hexdigest()[:12]


def safe_rpc_url(rpc_url: str) -> str:
    if not rpc_url:
        return "not_set"
    if "devnet.solana.com" in rpc_url or "mainnet-beta.solana.com" in rpc_url:
        return rpc_url
    try:
        parsed = urlparse(rpc_url)
        return f"{parsed.scheme}://{parsed.netloc}/***"
    except Exception:
        return "***"

