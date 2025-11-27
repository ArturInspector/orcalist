from utils.compat import recent_blockhash
from decimal import Decimal
from typing import Dict, Any
import logging
import asyncio

from solana.rpc.api import Client
from solana.transaction import Transaction
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token._layouts import MINT_LAYOUT
from spl.token.instructions import (
    get_associated_token_address,
    create_associated_token_account,
    mint_to_checked,
    MintToCheckedParams,
)

from solana.publickey import PublicKey

from utils.transfers import add_priority_fee

TOKEN_2022_PROGRAM_ID = PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")


logger = logging.getLogger("uvicorn.error")
async def get_mint_info(connection: Client, mint_address: str) -> Dict[str, Any]:
    max_retries = 5
    base_delay = 1.0
    
    for attempt in range(max_retries):
        try:
            mint_pubkey = PublicKey(mint_address)
            logger.debug(f"get_mint_info: requesting account info for mint={mint_address[:8]}... (attempt {attempt + 1}/{max_retries})")
            resp = connection.get_account_info(mint_pubkey)
            account_info = None
            
            if hasattr(resp, 'value') and resp.value:
                account_info = resp.value
            elif hasattr(resp, 'result') and resp.result:
                account_info = resp.result.get('value') if isinstance(resp.result, dict) else resp.result
            elif isinstance(resp, dict):
                account_info = resp.get('result', {}).get('value')
            
            logger.debug(f"get_mint_info: account_info is None={account_info is None}, resp_type={type(resp)}")
            
            if not account_info:
                if attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    logger.warning(f"get_mint_info: Mint account not found yet (attempt {attempt + 1}/{max_retries}), retrying in {delay:.1f}s...")
                    await asyncio.sleep(delay)
                    continue
                else:
                    logger.warning(f"get_mint_info: Mint account not found after {max_retries} attempts: mint={mint_address[:8]}..., resp={resp}")
                    return {
                        "success": False, 
                        "message": "Mint account not found on blockchain. Make sure token creation transaction was sent and confirmed."
                    }
            
            if not hasattr(account_info, 'data') or not account_info.data:
                if attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    logger.warning(f"get_mint_info: Mint account exists but has no data yet (attempt {attempt + 1}/{max_retries}), retrying in {delay:.1f}s...")
                    await asyncio.sleep(delay)
                    continue
                else:
                    return {
                        "success": False,
                        "message": "Mint account exists but has no data. Transaction may still be confirming."
                    }
            
            data = account_info.data
            if isinstance(data, list):
                data = bytes(data)
            elif hasattr(data, '__iter__') and not isinstance(data, (str, bytes)):
                data = bytes(data)
            
            mint_data = MINT_LAYOUT.parse(data)
            decimals = mint_data.decimals
        
            owner = account_info.owner if hasattr(account_info, 'owner') else None
            if not owner:
                if hasattr(resp, 'value') and hasattr(resp.value, 'owner'):
                    owner = resp.value.owner
        
            if isinstance(owner, str):
                owner = PublicKey(owner)
            use_token_2022 = str(owner) == str(TOKEN_2022_PROGRAM_ID) if owner else False
            
            logger.info(f"get_mint_info: success for mint={mint_address[:8]}..., decimals={decimals}, token_2022={use_token_2022}")
            return {
                "success": True,
                "decimals": decimals,
                "program_id": owner,
                "use_token_2022": use_token_2022
            }
        except Exception as e:
            error_type = type(e).__name__
            error_msg = str(e)
            is_timeout = (
                "timeout" in error_msg.lower() 
                or "TimeoutError" in error_type
                or "ReadTimeout" in error_type
                or "SolanaRpcException" in error_type
            )
            
            if is_timeout and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                logger.warning(
                    f"get_mint_info: RPC timeout (attempt {attempt + 1}/{max_retries}), "
                    f"retrying in {delay:.1f}s... error={error_type}: {error_msg[:100]}"
                )
                await asyncio.sleep(delay)
                continue
            else:
                logger.error(f"get_mint_info: exception for mint={mint_address[:8] if mint_address else 'None'}..., error={type(e).__name__}: {e}", exc_info=True)
                if attempt == max_retries - 1:
                    return {"success": False, "message": f"Error getting mint info: {e}"}
    
    return {"success": False, "message": "Error getting mint info: Max retries exceeded"}


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
        wallet_pubkey = PublicKey(wallet)
        mint_pubkey = PublicKey(mint_address)
        program_id = TOKEN_2022_PROGRAM_ID if use_token_2022 else TOKEN_PROGRAM_ID

        tx = Transaction()
        tx.fee_payer = wallet_pubkey

        add_priority_fee(tx, priority_fee)

        ata = get_associated_token_address(owner=wallet_pubkey, mint=mint_pubkey)
        resp = connection.get_account_info(ata)
        
        # проверяем существует ли ATA
        account_info = None
        if hasattr(resp, 'value') and resp.value:
            account_info = resp.value
        elif hasattr(resp, 'result') and resp.result:
            account_info = resp.result.get('value') if isinstance(resp.result, dict) else resp.result
        elif isinstance(resp, dict):
            account_info = resp.get('result', {}).get('value')
        
        need_create = account_info is None

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
