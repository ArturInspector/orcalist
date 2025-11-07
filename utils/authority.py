from utils.compat import recent_blockhash
from solana.rpc.api import Client
from solana.transaction import Transaction
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token.instructions import (
    set_authority,
    SetAuthorityParams,
    AuthorityType,
)

from solders.pubkey import Pubkey as PublicKey
from utils.transfers import add_priority_fee
from utils.rpc_helpers import get_blockhash

TOKEN_2022_PROGRAM_ID = PublicKey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")


async def update_mint_authority_transaction(connection: Client, wallet: str, mint_address: str,
                                            priority_fee: int = 250000, use_token_2022: bool = True):
    try:
        wallet_pubkey = PublicKey.from_string(wallet)
        mint_pubkey = PublicKey.from_string(mint_address)
        program_id = TOKEN_2022_PROGRAM_ID if use_token_2022 else TOKEN_PROGRAM_ID

        tx = Transaction()
        tx.fee_payer = wallet_pubkey
        add_priority_fee(tx, priority_fee)

        tx.add(set_authority(SetAuthorityParams(
            program_id=program_id,
            account=mint_pubkey,
            current_authority=wallet_pubkey,
            authority_type=AuthorityType.MINT_TOKENS,
            new_authority=None,
        )))

        tx.recent_blockhash = recent_blockhash(connection)
        return {"success": True, "transaction": tx}
    except Exception as e:
        return {"success": False, "message": f"Error updating mint authority: {e}"}


async def update_freeze_authority_transaction(connection: Client, wallet: str, mint_address: str,
                                              priority_fee: int = 250000, use_token_2022: bool = True):
    try:
        wallet_pubkey = PublicKey.from_string(wallet)
        mint_pubkey = PublicKey.from_string(mint_address)
        program_id = TOKEN_2022_PROGRAM_ID if use_token_2022 else TOKEN_PROGRAM_ID

        tx = Transaction()
        tx.fee_payer = wallet_pubkey
        add_priority_fee(tx, priority_fee)

        tx.add(set_authority(SetAuthorityParams(
            program_id=program_id,
            account=mint_pubkey,
            current_authority=wallet_pubkey,
            authority_type=AuthorityType.FREEZE_ACCOUNT,
            new_authority=None,
        )))

        tx.recent_blockhash = recent_blockhash(connection)
        return {"success": True, "transaction": tx}
    except Exception as e:
        return {"success": False, "message": f"Error updating freeze authority: {e}"}


async def update_update_authority_transaction(connection: Client, wallet: str, mint_address: str,
                                              priority_fee: int = 250000, use_token_2022: bool = True):
    try:
        return await update_mint_authority_transaction(connection, wallet, mint_address, priority_fee, use_token_2022)
    except Exception as e:
        return {"success": False, "message": f"Error updating update authority: {e}"}
