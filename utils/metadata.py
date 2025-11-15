from typing import Optional, List
from solana.publickey import PublicKey
from solana.transaction import Transaction, TransactionInstruction, AccountMeta
from solana.rpc.api import Client
import struct

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
) -> TransactionInstruction:
    name_encoded = _encode_string(name, 32)
    symbol_encoded = _encode_string(symbol, 10)
    uri_encoded = _encode_string(uri, 200)
    
    data = b""
    data += struct.pack("<B", 33)
    data += name_encoded
    data += symbol_encoded
    data += uri_encoded
    data += struct.pack("<H", 0)
    data += struct.pack("<B", 0)
    data += struct.pack("<B", 1 if is_mutable else 0)
    data += struct.pack("<B", 0)
    
    keys = [
        AccountMeta(pubkey=metadata_account, is_signer=False, is_writable=True),
        AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
        AccountMeta(pubkey=mint_authority, is_signer=True, is_writable=False),
        AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
        AccountMeta(pubkey=update_authority, is_signer=False, is_writable=False),
        AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=RENT_SYSVAR, is_signer=False, is_writable=False),
    ]
    
    return TransactionInstruction(
        program_id=METADATA_PROGRAM_ID,
        data=data,
        keys=keys
    )

