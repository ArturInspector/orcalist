from utils.compat import recent_blockhash
from decimal import Decimal

from solana.rpc.api import Client
from solana.transaction import Transaction
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token.instructions import (
    get_associated_token_address,
    create_associated_token_account,
    mint_to_checked,
    MintToCheckedParams,
)

from solders.pubkey import Pubkey as PublicKey

from utils.transfers import add_priority_fee
from utils.rpc_helpers import get_blockhash

TOKEN_2022_PROGRAM_ID = PublicKey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")


async def mint_tokens_transaction(
    connection: Client,
    wallet: str,
    mint_address: str,
    amount: float,
    decimals: int,
    priority_fee: int = 250000,
    use_token_2022: bool = True,
):
    try:
        wallet_pubkey = PublicKey.from_string(wallet)
        mint_pubkey = PublicKey.from_string(mint_address)
        program_id = TOKEN_2022_PROGRAM_ID if use_token_2022 else TOKEN_PROGRAM_ID

        tx = Transaction()
        tx.fee_payer = wallet_pubkey

        add_priority_fee(tx, priority_fee)

        ata = get_associated_token_address(owner=wallet_pubkey, mint=mint_pubkey)
        ata_info = connection.resp_value(connection.get_account_info(ata))
        # у тебя Client возвращает dict-подобные ответы для account_info? Если да:
        if isinstance(ata_info, dict):
            value = ata_info.get("result", {}).get("value")
            need_create = value is None
        else:
            # на случай клиент-объектов
            need_create = getattr(ata_info, "value", None) is None

        if need_create:
            tx.add(
                create_associated_token_account(
                    payer=wallet_pubkey,
                    owner=wallet_pubkey,
                    mint=mint_pubkey,
                )
            )

        mint_amount = int((Decimal(str(amount)) * (Decimal(10) ** decimals)).to_integral_value())

        tx.add(
            mint_to_checked(
                MintToCheckedParams(
                    program_id=program_id,
                    mint=mint_pubkey,
                    dest=ata,
                    mint_authority=wallet_pubkey,
                    amount=mint_amount,
                    decimals=decimals,
                )
            )
        )

        tx.recent_blockhash = recent_blockhash(connection)
        return {"success": True, "transaction": tx, "token_account": str(ata)}
    except Exception as e:
        return {"success": False, "message": f"Error minting tokens: {e}"}
