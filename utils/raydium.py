from utils.compat import recent_blockhash
from solana.rpc.api import Client
from solana.transaction import Transaction
from solders.pubkey import Pubkey as PublicKey

from utils.transfers import add_priority_fee
from utils.rpc_helpers import get_blockhash


async def create_pool_transaction(
    connection: Client,
    wallet: str,
    mint_address: str,
    decimals: int,
    sol_amount: float,
    token_amount: float,
    priority_fee: int = 250000,
    use_token_2022: bool = True,
):
    try:
        wallet_pubkey = PublicKey.from_string(wallet)

        tx = Transaction()
        tx.fee_payer = wallet_pubkey

        add_priority_fee(tx, priority_fee)

        # Тут когда-нибудь добавим Raydium ix
        tx.recent_blockhash = recent_blockhash(connection)

        return {
            "success": True,
            "transaction": tx,
            "pool_id": "placeholder_pool_id",
            "lp_mint": "placeholder_lp_mint",
        }
    except Exception as e:
        return {"success": False, "message": f"Error creating pool: {e}"}
