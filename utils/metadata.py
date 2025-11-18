from typing import Optional, List
from solana.publickey import PublicKey
from solana.transaction import Transaction, TransactionInstruction, AccountMeta
from solana.rpc.api import Client
import struct
import logging

logger = logging.getLogger("uvicorn.error")

METADATA_PROGRAM_ID = PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
SYSTEM_PROGRAM_ID = PublicKey("11111111111111111111111111111111")
RENT_SYSVAR = PublicKey("SysvarRent111111111111111111111111111111111")

def find_metadata_account(mint: PublicKey) -> PublicKey:
    seeds = [
        b"metadata",
        bytes(METADATA_PROGRAM_ID),
        bytes(mint)
    ]
    metadata_account, _ = PublicKey.find_program_address(seeds, METADATA_PROGRAM_ID)
    return metadata_account

def _encode_string(s: str, max_len: int) -> bytes:
    s_bytes = s.encode("utf-8")[:max_len]
    length = len(s_bytes)
    return struct.pack("<I", length) + s_bytes

def create_metadata_instruction_v3(
    metadata_account: PublicKey,
    mint: PublicKey,
    mint_authority: PublicKey,
    payer: PublicKey,
    update_authority: PublicKey,
    name: str,
    symbol: str,
    uri: str,
    is_mutable: bool = True,
    token_program: Optional[PublicKey] = None,
) -> TransactionInstruction:
    from spl.token.constants import TOKEN_PROGRAM_ID
    
    logger.info(f"create_metadata_instruction_v3 called: name={name}, symbol={symbol}, uri={uri[:50] if uri else 'empty'}, is_mutable={is_mutable}")
    logger.info(f"metadata_account={metadata_account}, mint={mint}, mint_authority={mint_authority}, payer={payer}, update_authority={update_authority}")
    
    name_encoded = _encode_string(name, 32)
    symbol_encoded = _encode_string(symbol, 10)
    uri_encoded = _encode_string(uri, 200)
    
    logger.info(f"Encoded strings: name_len={len(name_encoded)}, symbol_len={len(symbol_encoded)}, uri_len={len(uri_encoded)}")
    logger.info(f"name_bytes={name_encoded.hex()[:64]}, symbol_bytes={symbol_encoded.hex()[:32]}, uri_bytes={uri_encoded.hex()[:64]}")
    
    token_prog = token_program or TOKEN_PROGRAM_ID
    logger.info(f"Using token_program={token_prog}")
    
    # CreateMetadataAccountV3 структура данных:
    # discriminator (u8) = 33
    # DataV2:
    #   name: String (u32 len + bytes)
    #   symbol: String (u32 len + bytes)
    #   uri: String (u32 len + bytes)
    #   seller_fee_basis_points: u16
    #   creators: Option<Vec<Creator>> (u8: 0=None, 1=Some + data)
    #   collection: Option<Collection> (u8: 0=None, 1=Some + data)
    #   uses: Option<Uses> (u8: 0=None, 1=Some + data)
    # is_mutable: bool (u8)
    # collection_details: Option<CollectionDetails> (u8: 0=None, 1=Some + data)
    
    data = b""
    data += struct.pack("<B", 33)  # discriminator
    data += name_encoded
    data += symbol_encoded
    data += uri_encoded
    data += struct.pack("<H", 0)  # seller_fee_basis_points
    data += struct.pack("<B", 0)  # creators: None
    data += struct.pack("<B", 0)  # collection: None
    data += struct.pack("<B", 0)  # uses: None
    data += struct.pack("<B", 1 if is_mutable else 0)  # is_mutable
    data += struct.pack("<B", 0)  # collection_details: None
    
    logger.info(f"Instruction data length={len(data)}, hex={data.hex()[:128]}")
    logger.info(f"Data structure: discriminator=33, name={len(name_encoded)} bytes, symbol={len(symbol_encoded)} bytes, uri={len(uri_encoded)} bytes")
    
    keys = [
        AccountMeta(pubkey=metadata_account, is_signer=False, is_writable=True),
        AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
        AccountMeta(pubkey=mint_authority, is_signer=True, is_writable=False),
        AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
        AccountMeta(pubkey=update_authority, is_signer=False, is_writable=False),
        AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=RENT_SYSVAR, is_signer=False, is_writable=False),
        AccountMeta(pubkey=token_prog, is_signer=False, is_writable=False),
    ]
    
    logger.info(f"Instruction keys count={len(keys)}")
    for i, key in enumerate(keys):
        logger.info(f"  Key[{i}]: pubkey={key.pubkey}, signer={key.is_signer}, writable={key.is_writable}")
    
    instruction = TransactionInstruction(
        program_id=METADATA_PROGRAM_ID,
        data=data,
        keys=keys
    )
    
    logger.info(f"Created instruction: program_id={instruction.program_id}, data_len={len(instruction.data)}, keys_count={len(instruction.keys)}")
    
    return instruction


def create_token_2022_metadata_instruction(
    mint: PublicKey,
    update_authority: PublicKey,
    mint_authority: PublicKey,
    payer: PublicKey,
    name: str,
    symbol: str,
    uri: str,
    token_program: PublicKey,
) -> TransactionInstruction:
    """Создает инструкцию InitializeMetadata для Token-2022."""
    logger.info(f"create_token_2022_metadata_instruction called: name={name}, symbol={symbol}, uri={uri[:50] if uri else 'empty'}")
    logger.info(f"mint={mint}, update_authority={update_authority}, mint_authority={mint_authority}, payer={payer}")
    
    # Token-2022 Metadata extension limits:
    # name: max 35 bytes
    # symbol: max 11 bytes
    # uri: max 200 bytes
    name_bytes = name.encode("utf-8")[:35]
    symbol_bytes = symbol.encode("utf-8")[:11]
    uri_bytes = uri.encode("utf-8")[:200]
    
    logger.info(f"Encoded strings: name_len={len(name_bytes)}, symbol_len={len(symbol_bytes)}, uri_len={len(uri_bytes)}")
    
    # InitializeMetadata instruction structure:
    # discriminator (u8) = 35 (0x23)
    # update_authority: Pubkey (32 bytes)
    # name: String (u32 len + bytes)
    # symbol: String (u32 len + bytes)
    # uri: String (u32 len + bytes)
    
    data = b""
    data += struct.pack("<B", 35)  # discriminator = 35 (0x23)
    data += bytes(update_authority)  # update_authority (32 bytes)
    data += struct.pack("<I", len(name_bytes))  # name length
    data += name_bytes  # name bytes
    data += struct.pack("<I", len(symbol_bytes))  # symbol length
    data += symbol_bytes  # symbol bytes
    data += struct.pack("<I", len(uri_bytes))  # uri length
    data += uri_bytes  # uri bytes
    
    logger.info(f"Instruction data length={len(data)}, hex={data.hex()[:128]}")
    
    # Keys for InitializeMetadata:
    # 0. mint: writable, NOT signer (mint is a system account, cannot sign)
    # 1. update_authority: signer
    # 2. mint_authority: signer (if different from update_authority)
    # 3. payer: signer, writable
    # 4. system_program: not signer, not writable
    
    keys = [
        AccountMeta(pubkey=mint, is_signer=False, is_writable=True),  # mint never signs
        AccountMeta(pubkey=update_authority, is_signer=True, is_writable=False),
    ]
    
    # Если mint_authority != update_authority, добавляем mint_authority как отдельный signer
    if mint_authority != update_authority:
        keys.append(AccountMeta(pubkey=mint_authority, is_signer=True, is_writable=False))
    
    keys.extend([
        AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
        AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ])
    
    logger.info(f"Instruction keys count={len(keys)}")
    for i, key in enumerate(keys):
        logger.info(f"  Key[{i}]: pubkey={key.pubkey}, signer={key.is_signer}, writable={key.is_writable}")
    
    instruction = TransactionInstruction(
        program_id=token_program,
        data=data,
        keys=keys
    )
    
    logger.info(f"Created Token-2022 metadata instruction: program_id={instruction.program_id}, data_len={len(instruction.data)}, keys_count={len(instruction.keys)}")
    
    return instruction

