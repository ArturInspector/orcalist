# utils/transaction_helpers.py
# SRP: Helper functions for transaction serialization
# Token-2022 creation moved to token-service (Node.js)

import base64
import logging
import time

from solana.rpc.api import Client
from solana.publickey import PublicKey
from solana.transaction import Transaction

from utils.compat import recent_blockhash

logger = logging.getLogger("uvicorn.error")


def serialize_transaction_b64(tx: Transaction) -> str:
    """Serialize transaction to base64 string"""
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
    """Set fee_payer and fresh blockhash for transaction"""
    tx.fee_payer = PublicKey(fee_payer)
    tx.recent_blockhash = recent_blockhash(conn)

