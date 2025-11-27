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
from solana.system_program import TransferParams, transfer
from utils.transfers import add_priority_fee
import base64
import logging

logger = logging.getLogger("uvicorn.error")

TOKEN_2022_PROGRAM_ID = PublicKey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")


def _get_mint_authority(connection: Client, mint_pubkey: PublicKey):
    """
    Получает mint authority из mint account.
    Для Token-2022 с extensions может не работать парсинг MINT_LAYOUT,
    в этом случае возвращает None (будет использован fallback).
    """
    try:
        mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
        resp = connection.get_account_info(mint_solana_pubkey)
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
            logger.debug(f"_get_mint_authority: no data for mint={mint_pubkey}")
            return None

        if isinstance(data, list):
            data = bytes(data)
        elif isinstance(data, str):
            data = base64.b64decode(data)
        
        # Для Token-2022 с extensions структура может отличаться
        # Пробуем парсить только базовую часть MINT_LAYOUT (первые 82 байта)
        try:
            # Базовый MINT_LAYOUT: mint_authority_option (4) + mint_authority (32) + supply (8) + decimals (1) + is_initialized (1) + freeze_authority_option (4) + freeze_authority (32) = 82 байта
            if len(data) < 82:
                logger.warning(f"_get_mint_authority: data too short ({len(data)} bytes), cannot parse")
                return None
            
            # Парсим только базовую часть
            mint_authority_option = int.from_bytes(data[0:4], byteorder='little')
            logger.debug(f"_get_mint_authority: mint_authority_option={mint_authority_option}")
            
            if mint_authority_option == 0:
                logger.debug(f"_get_mint_authority: mint_authority_option is 0, returning None")
                return None
            
            # Извлекаем mint_authority (32 байта начиная с позиции 4)
            mint_authority_bytes = data[4:36]
            
            # Проверяем, не является ли это системным адресом (все нули или все единицы)
            if all(b == 0 for b in mint_authority_bytes) or all(b == 0xFF for b in mint_authority_bytes):
                logger.debug(f"_get_mint_authority: mint_authority is default, returning None")
                return None
            
            # Конвертируем bytes в PublicKey
            mint_str = SolanaPublicKey(mint_authority_bytes).to_base58()
            logger.debug(f"_get_mint_authority: converted mint_authority={mint_str}")
            
            result = PublicKey.from_string(mint_str)
            logger.debug(f"_get_mint_authority: returning {result}")
            return result
            
        except Exception as parse_e:
            logger.warning(f"_get_mint_authority: Failed to parse MINT_LAYOUT (Token-2022 with extensions?): {parse_e}")
            # Возвращаем None - будет использован fallback
            return None
        
    except Exception as e:
        logger.error(f"_get_mint_authority exception: {e}", exc_info=True)
        return None

def _get_freeze_authority(connection: Client, mint_pubkey: PublicKey):
    """
    Получает freeze authority из mint account.
    Для Token-2022 с extensions может не работать парсинг MINT_LAYOUT,
    в этом случае возвращает None (будет использован fallback).
    """
    try:
        mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
        resp = connection.get_account_info(mint_solana_pubkey)
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
            logger.debug(f"_get_freeze_authority: no data for mint={mint_pubkey}")
            return None

        if isinstance(data, list):
            data = bytes(data)
        elif isinstance(data, str):
            data = base64.b64decode(data)
        
        # Для Token-2022 с extensions структура может отличаться
        # Пробуем парсить только базовую часть MINT_LAYOUT
        try:
            if len(data) < 82:
                logger.warning(f"_get_freeze_authority: data too short ({len(data)} bytes), cannot parse")
                return None
            
            # freeze_authority_option находится на позиции 46 (после mint_authority_option(4) + mint_authority(32) + supply(8) + decimals(1) + is_initialized(1) = 46)
            freeze_authority_option = int.from_bytes(data[46:50], byteorder='little')
            logger.debug(f"_get_freeze_authority: freeze_authority_option={freeze_authority_option}")
            
            if freeze_authority_option == 0:
                logger.debug(f"_get_freeze_authority: freeze_authority_option is 0, returning None")
                return None
            
            # Извлекаем freeze_authority (32 байта начиная с позиции 50)
            freeze_authority_bytes = data[50:82]
            
            # Проверяем, не является ли это системным адресом
            if all(b == 0 for b in freeze_authority_bytes) or all(b == 0xFF for b in freeze_authority_bytes):
                logger.debug(f"_get_freeze_authority: freeze_authority is default, returning None")
                return None
            
            # Конвертируем bytes в PublicKey
            freeze_str = SolanaPublicKey(freeze_authority_bytes).to_base58()
            logger.debug(f"_get_freeze_authority: converted freeze_authority={freeze_str}")
            
            result = PublicKey.from_string(freeze_str)
            logger.debug(f"_get_freeze_authority: returning {result}")
            return result
            
        except Exception as parse_e:
            logger.warning(f"_get_freeze_authority: Failed to parse MINT_LAYOUT (Token-2022 with extensions?): {parse_e}")
            # Возвращаем None - будет использован fallback
            return None
        
    except Exception as e:
        logger.error(f"_get_freeze_authority exception: {e}", exc_info=True)
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

            wallet_solana_pubkey = SolanaPublicKey(str(wallet_pubkey))
            mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
            program_id_solana = SolanaPublicKey(str(program_id)) if use_token_2022 else TOKEN_PROGRAM_ID
            tx.add(set_authority(
                program_id=program_id_solana,
                account=mint_solana_pubkey,
                current_authority=wallet_solana_pubkey,
                authority_type=AuthorityType.MINT_TOKENS,
                new_authority=None,
            ))

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
        tx.fee_payer = SolanaPublicKey(str(wallet_pubkey))
        add_priority_fee(tx, priority_fee)

        # Конвертируем solders.pubkey.Pubkey в solana.publickey.PublicKey для set_authority
        current_authority_solana = SolanaPublicKey(str(real_freeze_auth))
        mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
        program_id_solana = SolanaPublicKey(str(program_id)) if use_token_2022 else TOKEN_PROGRAM_ID
        # Правильный формат для set_authority - используем SetAuthorityParams
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
                                            priority_fee: int = 250000, use_token_2022: bool = True,
                                            charge_to: str = None):
    logger.info(
        f"create_revoke_transactions called: mint={mint_address[:8]}..., "
        f"revoke_mint={revoke_mint}, revoke_freeze={revoke_freeze}"
    )
    try:
        wallet_pubkey = PublicKey.from_string(wallet)
        mint_pubkey = PublicKey.from_string(mint_address)
        program_id = TOKEN_2022_PROGRAM_ID if use_token_2022 else TOKEN_PROGRAM_ID

        if not revoke_mint and not revoke_freeze:
            return {"success": True, "transactions": []}

        tx = Transaction()
        tx.fee_payer = SolanaPublicKey(str(wallet_pubkey))
        add_priority_fee(tx, priority_fee)

        if revoke_mint:
            logger.info(f"Starting revoke_mint check for mint={mint_address[:8]}...")
            real_mint_auth = _get_mint_authority(connection, mint_pubkey)
            logger.info(
                f"revoke_mint check: real_mint_auth={real_mint_auth}, "
                f"wallet_pubkey={wallet_pubkey}, "
                f"match={str(real_mint_auth) == str(wallet_pubkey) if real_mint_auth else False}"
            )
            
            should_add_revoke = False
            
            if real_mint_auth is None:
                logger.warning(f"Mint authority could not be determined (Token-2022 with extensions?), assuming wallet is authority for revoke")
                should_add_revoke = True
            elif str(real_mint_auth) != str(wallet_pubkey):
                logger.error(
                    f"Wallet is not mint authority: wallet={wallet_pubkey}, "
                    f"current_mint_auth={real_mint_auth}"
                )
                return {"success": False, "message": f"Wallet is not the mint authority. Current mint authority: {real_mint_auth}"}
            else:
                # authority совпадает
                should_add_revoke = True
            
            if should_add_revoke:
                logger.info(f"Adding revoke_mint instruction to transaction")
                # Конвертируем solders.pubkey.Pubkey в solana.publickey.PublicKey для set_authority
                wallet_solana_pubkey = SolanaPublicKey(str(wallet_pubkey))
                mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
                if use_token_2022:
                    program_id_solana = SolanaPublicKey(str(program_id))
                else:
                    # TOKEN_PROGRAM_ID уже solana.publickey.PublicKey
                    program_id_solana = TOKEN_PROGRAM_ID
                # Правильный формат для set_authority - используем SetAuthorityParams
                tx.add(set_authority(SetAuthorityParams(
                    program_id=program_id_solana,
                    account=mint_solana_pubkey,
                    current_authority=wallet_solana_pubkey,
                    authority_type=AuthorityType.MINT_TOKENS,
                    new_authority=None,
                )))
                logger.info(f"revoke_mint instruction added, total instructions now: {len(tx.instructions)}")

        if revoke_freeze:
            logger.info(f"Starting revoke_freeze check for mint={mint_address[:8]}...")
            real_freeze_auth = _get_freeze_authority(connection, mint_pubkey)
            logger.info(
                f"revoke_freeze check: real_freeze_auth={real_freeze_auth}, "
                f"wallet_pubkey={wallet_pubkey}, "
                f"match={str(real_freeze_auth) == str(wallet_pubkey) if real_freeze_auth else False}"
            )
            
            should_add_revoke = False
            
            if real_freeze_auth is None:
                # Не удалось определить authority (возможно Token-2022 с extensions)
                # Для только что созданных токенов предполагаем, что wallet является authority
                logger.warning(f"Freeze authority could not be determined (Token-2022 with extensions?), assuming wallet is authority for revoke")
                should_add_revoke = True
            elif str(real_freeze_auth) != str(wallet_pubkey):
                # wallet не является freeze authority
                logger.error(
                    f"Wallet is not freeze authority: wallet={wallet_pubkey}, "
                    f"current_freeze_auth={real_freeze_auth}"
                )
                return {"success": False, "message": f"Wallet is not the freeze authority. Current freeze authority: {real_freeze_auth}"}
            else:
                # authority совпадает
                should_add_revoke = True
            
            if should_add_revoke:
                logger.info(f"Adding revoke_freeze instruction to transaction")
                # Конвертируем solders.pubkey.Pubkey в solana.publickey.PublicKey для set_authority
                wallet_solana_pubkey = SolanaPublicKey(str(wallet_pubkey))
                mint_solana_pubkey = SolanaPublicKey(str(mint_pubkey))
                if use_token_2022:
                    program_id_solana = SolanaPublicKey(str(program_id))
                else:
                    # TOKEN_PROGRAM_ID уже solana.publickey.PublicKey
                    program_id_solana = TOKEN_PROGRAM_ID
                # Правильный формат для set_authority - используем SetAuthorityParams
                tx.add(set_authority(SetAuthorityParams(
                    program_id=program_id_solana,
                    account=mint_solana_pubkey,
                    current_authority=wallet_solana_pubkey,
                    authority_type=AuthorityType.FREEZE_ACCOUNT,
                    new_authority=None,
                )))
                logger.info(f"revoke_freeze instruction added, total instructions now: {len(tx.instructions)}")

        if len(tx.instructions) == 0:
            return {"success": True, "transactions": [], "message": "All requested authorities are already revoked"}

        if charge_to:
            try:
                charge_to_pubkey = SolanaPublicKey(charge_to)
                revoke_charge_lamports = int(0.0999 * 1_000_000_000)  # 99,900,000 lamports
                tx.add(transfer(TransferParams(
                    from_pubkey=SolanaPublicKey(str(wallet_pubkey)),
                    to_pubkey=charge_to_pubkey,
                    lamports=revoke_charge_lamports,
                )))
            except Exception as e:
                return {"success": False, "message": f"Error adding charge transfer: {e}"}
        
        tx.recent_blockhash = recent_blockhash(connection)
        
        # Детальная проверка инструкций перед сериализацией
        instructions_info = []
        token_program_instructions = []
        for i, instr in enumerate(tx.instructions):
            program_id_str = str(instr.program_id) if hasattr(instr, 'program_id') else 'unknown'
            program_id_full = str(instr.program_id) if hasattr(instr, 'program_id') else 'unknown'
            instructions_info.append(f"instr_{i}: program={program_id_str[:8]}...")
            
            # Проверяем, есть ли инструкции от Token Program
            if hasattr(instr, 'program_id'):
                program_str = str(instr.program_id)
                if program_str == str(TOKEN_2022_PROGRAM_ID) or program_str == str(TOKEN_PROGRAM_ID):
                    token_program_instructions.append({
                        'index': i,
                        'program_id': program_str,
                        'keys_count': len(instr.keys) if hasattr(instr, 'keys') else 0,
                        'data_length': len(instr.data) if hasattr(instr, 'data') else 0
                    })
                    logger.info(
                        f"Token Program instruction found at index {i}: "
                        f"program={program_str[:16]}..., keys={len(instr.keys) if hasattr(instr, 'keys') else 0}, "
                        f"data={len(instr.data) if hasattr(instr, 'data') else 0} bytes"
                    )
        
        logger.info(
            f"Revoke transaction created: mint={mint_address[:8]}..., "
            f"instructions_count={len(tx.instructions)}, "
            f"revoke_mint={revoke_mint}, revoke_freeze={revoke_freeze}, "
            f"has_transfer={charge_to is not None}, "
            f"token_program_instructions={len(token_program_instructions)}, "
            f"instructions={', '.join(instructions_info)}"
        )
        
        # КРИТИЧЕСКАЯ ПРОВЕРКА: должны быть инструкции от Token Program
        if revoke_mint or revoke_freeze:
            if len(token_program_instructions) == 0:
                logger.error(
                    f"CRITICAL: No Token Program instructions found in transaction! "
                    f"Expected revoke_mint={revoke_mint}, revoke_freeze={revoke_freeze}, "
                    f"but found {len(tx.instructions)} total instructions: {instructions_info}"
                )
                return {
                    "success": False, 
                    "message": f"No Token Program instructions found. Transaction has {len(tx.instructions)} instructions but no set_authority."
                }
            else:
                logger.info(f"✅ Token Program instructions verified: {len(token_program_instructions)} found")
        
        return {"success": True, "transactions": [tx]}
    except Exception as e:
        return {"success": False, "message": f"Error creating revoke transactions: {e}"}
