from utils.compat import recent_blockhash
from solana.rpc.api import Client
from solana.transaction import Transaction
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token._layouts import MINT_LAYOUT
from spl.token.instructions import (
    set_authority,
    SetAuthorityParams,
    AuthorityType,
)

from solders.pubkey import Pubkey as PublicKey
from solana.publickey import PublicKey as SolanaPublicKey
from utils.transfers import add_priority_fee
import base64

TOKEN_2022_PROGRAM_ID = PublicKey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")


def _get_mint_authority(connection: Client, mint_pubkey: PublicKey):
    try:
        resp = connection.get_account_info(mint_pubkey)
        data = None
        if hasattr(resp, 'value') and resp.value:
            data = resp.value.data
        elif hasattr(resp, 'result') and resp.result and resp.result.get('value'):
            data = resp.result['value'].get('data')
        elif isinstance(resp, dict):
            value = resp.get('result', {}).get('value')
            if value:
                data = value.get('data')
        if not data:
            return None

        if isinstance(data, list):
            data = bytes(data)
        elif isinstance(data, str):
            data = base64.b64decode(data)
        
        parsed = MINT_LAYOUT.parse(data)
        mint_authority_option = parsed.mint_authority_option
        if mint_authority_option == 0:
            return None
        
        mint_authority = parsed.mint_authority
        mint_str = str(mint_authority)
        if mint_str == "11111111111111111111111111111111":
            return None
        
        return PublicKey.from_string(str(mint_authority))
    except Exception:
        return None

def _get_freeze_authority(connection: Client, mint_pubkey: PublicKey):
    try:
        resp = connection.get_account_info(mint_pubkey)
        data = None
        if hasattr(resp, 'value') and resp.value:
            data = resp.value.data
        elif hasattr(resp, 'result') and resp.result and resp.result.get('value'):
            data = resp.result['value'].get('data')
        elif isinstance(resp, dict):
            value = resp.get('result', {}).get('value')
            if value:
                data = value.get('data')
        if not data:
            return None

        if isinstance(data, list):
            data = bytes(data)
        elif isinstance(data, str):
            data = base64.b64decode(data)
        
        parsed = MINT_LAYOUT.parse(data)
        if parsed.freeze_authority_option == 0:
            return None
        
        freeze_pubkey = parsed.freeze_authority # спарсенный freeze_authority
        freeze_str = str(freeze_pubkey)
        if freeze_str == "11111111111111111111111111111111": # не дефолт
            return None
        
        return PublicKey.from_string(str(freeze_pubkey))
    except Exception:
        # пусть попробует с wallet
        return None


async def update_mint_authority_transaction(connection: Client, wallet: str, mint_address: str,
                                            priority_fee: int = 250000, use_token_2022: bool = True):
        try:
            wallet_pubkey = PublicKey.from_string(wallet)
            mint_pubkey = PublicKey.from_string(mint_address)
            program_id = TOKEN_2022_PROGRAM_ID if use_token_2022 else TOKEN_PROGRAM_ID

            tx = Transaction()
            # Transaction.fee_payer требует solana.publickey.PublicKey, а не solders.pubkey.Pubkey
            tx.fee_payer = SolanaPublicKey(str(wallet_pubkey))
            add_priority_fee(tx, priority_fee)

            # Конвертируем solders.pubkey.Pubkey в solana.publickey.PublicKey для set_authority
            wallet_solana_pubkey = SolanaPublicKey(str(wallet_pubkey))
            mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
            program_id_solana = SolanaPublicKey(str(program_id)) if use_token_2022 else TOKEN_PROGRAM_ID
            tx.add(set_authority(SetAuthorityParams(
                program_id=program_id_solana,
                account=mint_solana_pubkey,
                current_authority=wallet_solana_pubkey,
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

        real_freeze_auth = _get_freeze_authority(connection, mint_pubkey)# freeze_authority
        if real_freeze_auth is None:
            # уже revoked, возвращаем успех без транзы
            return {"success": True, "message": "Freeze authority already revoked", "transaction": None}


        tx = Transaction()
        # Transaction.fee_payer требует solana.publickey.PublicKey, а не solders.pubkey.Pubkey
        tx.fee_payer = SolanaPublicKey(str(wallet_pubkey))
        add_priority_fee(tx, priority_fee)

        # Конвертируем solders.pubkey.Pubkey в solana.publickey.PublicKey для set_authority
        current_authority_solana = SolanaPublicKey(str(real_freeze_auth))
        mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
        program_id_solana = SolanaPublicKey(str(program_id)) if use_token_2022 else TOKEN_PROGRAM_ID
        tx.add(set_authority(SetAuthorityParams(
            program_id=program_id_solana,
            account=mint_solana_pubkey,
            current_authority=current_authority_solana,
            authority_type=AuthorityType.FREEZE_ACCOUNT,
            new_authority=None,
        )))

        tx.recent_blockhash = recent_blockhash(connection)
        return {"success": True, "transaction": tx}
    except Exception as e:
        return {"success": False, "message": f"Error updating freeze authority: {e}"}




async def create_revoke_transactions(connection: Client, wallet: str, mint_address: str,
                                     revoke_mint: bool = False, revoke_freeze: bool = False,
                                            priority_fee: int = 250000, use_token_2022: bool = True):
    try:
        wallet_pubkey = PublicKey.from_string(wallet)
        mint_pubkey = PublicKey.from_string(mint_address)
        program_id = TOKEN_2022_PROGRAM_ID if use_token_2022 else TOKEN_PROGRAM_ID

        if not revoke_mint and not revoke_freeze:
            return {"success": True, "transactions": []}

        tx = Transaction()
        # Transaction.fee_payer требует solana.publickey.PublicKey, а не solders.pubkey.Pubkey
        tx.fee_payer = SolanaPublicKey(str(wallet_pubkey))
        add_priority_fee(tx, priority_fee)

        if revoke_mint:
            real_mint_auth = _get_mint_authority(connection, mint_pubkey)
            if real_mint_auth is None:
                # уже revoked, пропускаем
                pass
            elif str(real_mint_auth) != str(wallet_pubkey):
                # wallet не является mint authority
                return {"success": False, "message": f"Wallet is not the mint authority. Current mint authority: {real_mint_auth}"}
            else:
                # Конвертируем solders.pubkey.Pubkey в solana.publickey.PublicKey для set_authority
                wallet_solana_pubkey = SolanaPublicKey(str(wallet_pubkey))
                mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
                if use_token_2022:
                    program_id_solana = SolanaPublicKey(str(program_id))
                else:
                    # TOKEN_PROGRAM_ID уже solana.publickey.PublicKey
                    program_id_solana = TOKEN_PROGRAM_ID
                tx.add(set_authority(SetAuthorityParams(
                    program_id=program_id_solana,
                    account=mint_solana_pubkey,
                    current_authority=wallet_solana_pubkey,
                    authority_type=AuthorityType.MINT_TOKENS,
                    new_authority=None,
                )))

        if revoke_freeze:
            real_freeze_auth = _get_freeze_authority(connection, mint_pubkey)
            if real_freeze_auth is None:
                # уже revoked, пропускаем
                pass
            elif str(real_freeze_auth) != str(wallet_pubkey):
                # wallet не является freeze authority
                return {"success": False, "message": f"Wallet is not the freeze authority. Current freeze authority: {real_freeze_auth}"}
            else:
                # Конвертируем solders.pubkey.Pubkey в solana.publickey.PublicKey для set_authority
                wallet_solana_pubkey = SolanaPublicKey(str(wallet_pubkey))
                mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
                if use_token_2022:
                    program_id_solana = SolanaPublicKey(str(program_id))
                else:
                    # TOKEN_PROGRAM_ID уже solana.publickey.PublicKey
                    program_id_solana = TOKEN_PROGRAM_ID
                tx.add(set_authority(SetAuthorityParams(
                    program_id=program_id_solana,
                    account=mint_solana_pubkey,
                    current_authority=wallet_solana_pubkey,
                    authority_type=AuthorityType.FREEZE_ACCOUNT,
                    new_authority=None,
                )))

        if len(tx.instructions) == 0:
            return {"success": True, "transactions": [], "message": "All requested authorities are already revoked"}

        tx.recent_blockhash = recent_blockhash(connection)
        return {"success": True, "transactions": [tx]}
    except Exception as e:
        return {"success": False, "message": f"Error creating revoke transactions: {e}"}
