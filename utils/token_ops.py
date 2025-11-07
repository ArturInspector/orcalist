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


PROGRAM_ID = TOKEN_PROGRAM_ID  # Token-2022 не трогаем, чтобы не ловить несовместимости


def _rent_exempt(connection: Client, size: int) -> int:
    """Возвращает кол-во лампортов для rent-exempt, независимо от формы ответа."""
    resp = connection.get_minimum_balance_for_rent_exemption(size)
    # Возможные варианты: объект с .value, просто int, либо dict с "result"
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
    use_token_2022: bool = False,  # оставляем SPL Token v2
) -> Dict[str, Any]:
    try:
        wallet_pk = PublicKey(wallet)

        # Делаем детерминированный mint через seed -> signer только кошелёк
        seed = (symbol or "mint")[:16] or "mint"  # <= 32 байт, лучше короче
        mint_pk = PublicKey.create_with_seed(wallet_pk, seed, PROGRAM_ID)

        # Rent-exempt размер под MINT
        mint_size = MINT_LAYOUT.sizeof()
        lamports = _rent_exempt(connection, mint_size)

        tx = Transaction()
        tx.fee_payer = wallet_pk

        # ВАЖНО: здесь параметр называется base_pubkey (НЕ 'base')
        tx.add(
            create_account_with_seed(
                CreateAccountWithSeedParams(
                    from_pubkey=wallet_pk,          # единственный signer будет твой кошелёк
                    base_pubkey=wallet_pk,          # база для сид-адреса
                    seed=seed,
                    new_account_pubkey=mint_pk,     # вычисленный адрес аккаунта mint
                    lamports=lamports,
                    space=mint_size,
                    program_id=PROGRAM_ID,
                )
            )
        )

        tx.add(
            initialize_mint(
                InitializeMintParams(
                    program_id=PROGRAM_ID,
                    mint=mint_pk,
                    decimals=int(decimals),
                    mint_authority=wallet_pk,
                    freeze_authority=wallet_pk,
                )
            )
        )

        # Без подписей на бэке — только blockhash
        tx.recent_blockhash = recent_blockhash(connection)

        return {
            "success": True,
            "transaction": tx,   # main.py сам сериализует в base64
            "mint": str(mint_pk),
            "seed": seed,
        }

    except Exception as e:
        return {"success": False, "message": f"Error creating token: {e}"}
