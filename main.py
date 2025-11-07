# main.py
from utils.compat import recent_blockhash

import os
import base64
import logging
import time
from typing import Optional, Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from solana.rpc.api import Client
from solana.publickey import PublicKey
from solana.transaction import Transaction
from solana.system_program import TransferParams, transfer

# твои утилиты (оставляем как есть)
from utils.token_ops import create_token_transaction
from utils.transfers import create_sol_transfer_transaction  # если не нужен — можешь убрать импорт

# =====================================================================
# CONFIG (по умолчанию devnet, чтобы фронт/бэк совпадали)
# =====================================================================

RPC_URL = (
    os.getenv("SOLANA_RPC_URL")
    or os.getenv("RPC_URL")
    or "https://api.devnet.solana.com"
).strip()

# Куда уходит фикс-чардж (адрес НА devnet!). Лучше поставить тот же Phantom,
# которым подписываешь — точно существует на devnet.
CHARGE_TO = (os.getenv("CHARGE_TO") or "HD7dHSFCuvDQqSUuCULA6ssrwceTVVYQwb9wc3iZG5rG").strip()

# Сколько снимаем за создание токена (в SOL)
FIXED_CHARGE_SOL = float(os.getenv("FIXED_CHARGE_SOL", "0.02"))

# =====================================================================
# APP / CORS
# =====================================================================

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",
        "https://tokenstart.app",
        "https://www.tokenstart.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger("uvicorn.error")

# =====================================================================
# SCHEMAS
# =====================================================================

class ProceedReq(BaseModel):
    wallet: str
    decimals: int = 9
    name: Optional[str] = "Cool Name"
    symbol: Optional[str] = "CLSMBL"
    description: Optional[str] = "Cool description"
    metadata_uri: Optional[str] = ""   # IPFS-лого с фронта
    priority_fee: int = 250_000
    use_token_2022: bool = True


class ListingReq(BaseModel):
    wallet: Optional[str] = None
    amount: Optional[float] = None     # solAmount
    priority_fee: int = 250_000
    payload: Optional[Dict[str, Any]] = None

# =====================================================================
# HELPERS
# =====================================================================

def _b64(tx: Transaction) -> str:
    start_time = time.time()
    try:
        raw = tx.serialize(verify_signatures=False)
        elapsed_ms = (time.time() - start_time) * 1000
        logger.info(
            f"Transaction serialized: size={len(raw)} bytes, "
            f"instructions={len(tx.instructions)}, elapsed={elapsed_ms:.2f}ms"
        )
        return base64.b64encode(raw).decode("utf-8")
    except Exception as e:
        logger.error(
            f"Transaction serialization failed: {type(e).__name__}: {e}, "
            f"elapsed={(time.time() - start_time) * 1000:.2f}ms",
            exc_info=True
        )
        raise

def _ensure_main_fields(conn: Client, tx: Transaction, fee_payer: str) -> None:
    tx.fee_payer = PublicKey(fee_payer)
    tx.recent_blockhash = recent_blockhash(conn)

def _append_fixed_charge(tx: Transaction, user_wallet: str) -> None:
    if not CHARGE_TO:
        return
    lamports = int(FIXED_CHARGE_SOL * 1_000_000_000)
    if lamports <= 0:
        return
    tx.add(
        transfer(
            TransferParams(
                from_pubkey=PublicKey(user_wallet),
                to_pubkey=PublicKey(CHARGE_TO),
                lamports=lamports,
            )
        )
    )

# =====================================================================
# ROUTES
# =====================================================================

@app.get("/healthz")
@app.get("/health")
def health():
    return {
        "status": "ok",
        "rpc": RPC_URL,
        "charge_to": CHARGE_TO,
        "fixed_charge_sol": FIXED_CHARGE_SOL,
    }

@app.post("/api/proceed")
async def api_proceed(req: ProceedReq):
    """
    1) Собираем транзу создания токена (utils.token_ops)
    2) Проставляем fee_payer + свежий blockhash с ЭТОГО RPC
    3) Вклеиваем фикс-чардж FIXED_CHARGE_SOL → CHARGE_TO
    4) Возвращаем base64 транзу(ы) для подписи кошельком
    """
    try:
        # валидации сразу, чтобы не ловить странные падения симуляции
        try:
            PublicKey(req.wallet)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid payer wallet")

        if CHARGE_TO:
            try:
                PublicKey(CHARGE_TO)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid CHARGE_TO pubkey")

        conn = Client(RPC_URL)

        # 1) заготовка транзы создания токена
        res = await create_token_transaction(
            connection=conn,
            wallet=req.wallet,
            decimals=req.decimals,
            name=req.name or "",
            symbol=req.symbol or "",
            description=req.description or "",
            metadata_uri=req.metadata_uri or "",
            priority_fee=req.priority_fee,
            use_token_2022=req.use_token_2022,
        )
        if not res or not res.get("success"):
            raise HTTPException(status_code=500, detail=res.get("message", "create_token failed"))

        tx: Transaction = res["transaction"]

        # 2) fee payer + свежий блокхеш
        _ensure_main_fields(conn, tx, req.wallet)

        # 3) фикс-чардж (в ту же транзу)
        _append_fixed_charge(tx, req.wallet)

        # sanity
        assert tx.fee_payer is not None, "fee_payer is not set"
        assert tx.recent_blockhash, "recent_blockhash is empty"

        # 4) serialize → base64
        b64 = _b64(tx)
        return {
            "success": True,
            "tx": b64,
            "updatedTx": [b64],   # совместимость если фронт ждёт массив
            "mint": res.get("mint"),
            "seed": res.get("seed"),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error in token creation: {e}")

@app.post("/api/listing")
async def api_listing(req: ListingReq):
    """
    Временно: простой SOL-трансфер на CHARGE_TO, чтобы кнопка "Create Pool"
    реально отправляла транзу (до интеграции Raydium).
    """
    try:
        wallet = req.wallet
        amount = req.amount

        # поддержка { payload: {...} }
        if req.payload and isinstance(req.payload, dict):
            wallet = wallet or req.payload.get("wallet")
            if amount is None:
                sa = req.payload.get("solAmount")
                if sa is not None:
                    try:
                        amount = float(sa)
                    except Exception:
                        pass

        if not wallet or not amount or amount <= 0:
            raise HTTPException(status_code=400, detail="wallet/amount required")

        try:
            PublicKey(wallet)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid payer wallet")

        if not CHARGE_TO:
            raise HTTPException(status_code=400, detail="CHARGE_TO is empty")

        try:
            PublicKey(CHARGE_TO)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid CHARGE_TO pubkey")

        conn = Client(RPC_URL)
        tx = Transaction()

        _ensure_main_fields(conn, tx, wallet)

        lamports = int(float(amount) * 1_000_000_000)
        tx.add(
            transfer(
                TransferParams(
                    from_pubkey=PublicKey(wallet),
                    to_pubkey=PublicKey(CHARGE_TO),
                    lamports=lamports,
                )
            )
        )
# =====================================================================
# CONFIG (по умолчанию devnet, чтобы фрон
        # sanity
        assert tx.fee_payer is not None, "fee_payer is not set"
        assert tx.recent_blockhash, "recent_blockhash is empty"

        b64 = _b64(tx)
        return {"success": True, "tx": b64, "updatedTx": [b64]}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating SOL transfer: {e}")

# =====================================================================
# STATIC FRONT
# =====================================================================

FRONTEND_DIR = "/root/soltokenmint/soltoken-frontend"
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")

