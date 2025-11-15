# utils/transaction_helpers.py
import base64
import logging
import time

from solana.rpc.api import Client
from solana.publickey import PublicKey
from solana.transaction import Transaction
from solana.system_program import TransferParams, transfer

from utils.compat import recent_blockhash
from config import CHARGE_TO, FIXED_CHARGE_SOL

logger = logging.getLogger("uvicorn.error")


def serialize_transaction_b64(tx: Transaction) -> str:
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


def ensure_transaction_fields(conn: Client, tx: Transaction, fee_payer: str) -> None:
    """Проставляет fee_payer и свежий blockhash."""
    tx.fee_payer = PublicKey(fee_payer)
    tx.recent_blockhash = recent_blockhash(conn)


def append_fixed_charge(tx: Transaction, user_wallet: str) -> None:
    """Добавляет фикс-чардж в транзакцию, если настроен."""
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

