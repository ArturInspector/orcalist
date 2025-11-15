# config.py
import os

# RPC конфигурация (по умолчанию devnet)
RPC_URL = (
    os.getenv("SOLANA_RPC_URL")
    or os.getenv("RPC_URL")
    or "https://api.devnet.solana.com"
).strip()

# Куда уходит фикс-чардж (адрес НА devnet!)
# Лучше поставить тот же Phantom, которым подписываешь — точно существует на devnet.
CHARGE_TO = (os.getenv("CHARGE_TO") or "HD7dHSFCuvDQqSUuCULA6ssrwceTVVYQwb9wc3iZG5rG").strip()

# Сколько снимаем за создание токена (в SOL)
FIXED_CHARGE_SOL = float(os.getenv("FIXED_CHARGE_SOL", "0.02"))

