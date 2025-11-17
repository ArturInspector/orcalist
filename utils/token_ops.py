# utils/token_ops.py
import os
from typing import Dict, Any

from solana.rpc.api import Client
from solana.publickey import PublicKey
from solana.transaction import Transaction
from solana.system_program import (
    CreateAccountWithSeedParams,
    create_account_with_seed,
)
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token._layouts import MINT_LAYOUT
from spl.token.instructions import (
    initialize_mint,
    InitializeMintParams,
)

from utils.compat import recent_blockhash
from utils.metadata import (
    find_metadata_account,
    create_metadata_instruction_v3,
)

TOKEN_2022_PROGRAM_ID = PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")


def _rent_exempt(connection: Client, size: int) -> int:
    """Возвращает кол-во лампортов для rent-exempt, независимо от формы ответа."""
    resp = connection.get_minimum_balance_for_rent_exemption(size)
    val = getattr(resp, "value", None)
    if val is None:
        if isinstance(resp, int):
            val = resp
        elif isinstance(resp, dict):
            val = resp.get("result")
    if val is None:
        raise RuntimeError("cannot fetch rent exempt")
    return int(val)


async def create_token_transaction(
    connection: Client,
    wallet: str,
    decimals: int = 9,
    name: str = "",
    symbol: str = "",
    description: str = "",
    metadata_uri: str = "",
    priority_fee: int = 250000,
    use_token_2022: bool = False,
) -> Dict[str, Any]:
    try:
        wallet_pk = PublicKey(wallet)
        program_id = TOKEN_2022_PROGRAM_ID if use_token_2022 else TOKEN_PROGRAM_ID
        seed = (symbol or "mint")[:16] or "mint"
        mint_pk = PublicKey.create_with_seed(wallet_pk, seed, program_id)

        mint_size = MINT_LAYOUT.sizeof()
        lamports = _rent_exempt(connection, mint_size)

        tx = Transaction()
        tx.fee_payer = wallet_pk

        tx.add(
            create_account_with_seed(
                CreateAccountWithSeedParams(
                    from_pubkey=wallet_pk,
                    base_pubkey=wallet_pk,
                    seed=seed,
                    new_account_pubkey=mint_pk,
                    lamports=lamports,
                    space=mint_size,
                    program_id=program_id,
                )
            )
        )

        tx.add(
            initialize_mint(
                InitializeMintParams(
                    program_id=program_id,
                    mint=mint_pk,
                    decimals=int(decimals),
                    mint_authority=wallet_pk,
                    freeze_authority=wallet_pk,
                )
            )
        )

        if metadata_uri or name or symbol:
            try:
                metadata_account = find_metadata_account(mint_pk)
                
                tx.add(
                    create_metadata_instruction_v3(
                        metadata_account=metadata_account,
                        mint=mint_pk,
                        mint_authority=wallet_pk,
                        payer=wallet_pk,
                        update_authority=wallet_pk,
                        name=name or symbol or "Token",
                        symbol=symbol or "TKN",
                        uri=metadata_uri or "",
                        is_mutable=True,
                    )
                )
            except Exception as e:
                import logging
                logging.getLogger("uvicorn.error").warning(
                    f"Failed to add metadata instruction: {type(e).__name__}: {e}"
                )
                pass

        tx.recent_blockhash = recent_blockhash(connection)

        return {
            "success": True,
            "transaction": tx,
            "mint": str(mint_pk),
            "seed": seed,
        }

    except Exception as e:
        return {"success": False, "message": f"Error creating token: {e}"}
