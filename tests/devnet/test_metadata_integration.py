import pytest
import os
from solana.rpc.api import Client
from solders.pubkey import Pubkey as PublicKey
from utils.token_ops import create_token_transaction
from utils.metadata import find_metadata_account, METADATA_PROGRAM_ID

RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")

@pytest.mark.asyncio
async def test_create_token_with_metadata():
    conn = Client(RPC_URL)
    
    test_wallet = "HD7dHSFCuvDQqSUuCULA6ssrwceTVVYQwb9wc3iZG5rG"
    
    result = await create_token_transaction(
        connection=conn,
        wallet=test_wallet,
        decimals=9,
        name="Test Token",
        symbol="TEST",
        description="Test token description",
        metadata_uri="https://example.com/metadata.json",
        priority_fee=0,
        use_token_2022=False,
    )
    
    assert result["success"] is True, f"Token creation failed: {result.get('message')}"
    assert "transaction" in result
    assert "mint" in result
    
    tx = result["transaction"]
    mint_address = result["mint"]
    
    assert len(tx.instructions) == 3, f"Expected 3 instructions (create account, init mint, create metadata), got {len(tx.instructions)}"
    
    mint_pk = PublicKey.from_string(mint_address)
    metadata_account = find_metadata_account(mint_pk)
    
    metadata_instruction = tx.instructions[2]
    assert str(metadata_instruction.program_id) == str(METADATA_PROGRAM_ID), "Metadata instruction should use Metaplex program"
    
    metadata_account_from_ix = metadata_instruction.keys[0].pubkey
    assert str(metadata_account_from_ix) == str(metadata_account), "Metadata account mismatch"
    
    assert str(metadata_instruction.keys[1].pubkey) == str(mint_pk), "Mint account mismatch"
    assert metadata_instruction.keys[0].is_writable is True, "Metadata account should be writable"
    assert metadata_instruction.keys[2].is_signer is True, "Mint authority should be signer"

@pytest.mark.asyncio
async def test_create_token_without_metadata():
    conn = Client(RPC_URL)
    
    test_wallet = "HD7dHSFCuvDQqSUuCULA6ssrwceTVVYQwb9wc3iZG5rG"
    
    result = await create_token_transaction(
        connection=conn,
        wallet=test_wallet,
        decimals=9,
        name="",
        symbol="",
        description="",
        metadata_uri="",
        priority_fee=0,
        use_token_2022=False,
    )
    
    assert result["success"] is True
    tx = result["transaction"]
    
    assert len(tx.instructions) == 2, f"Expected 2 instructions (no metadata), got {len(tx.instructions)}"

@pytest.mark.asyncio
async def test_metadata_account_derivation():
    conn = Client(RPC_URL)
    
    test_wallet = "HD7dHSFCuvDQqSUuCULA6ssrwceTVVYQwb9wc3iZG5rG"
    
    result = await create_token_transaction(
        connection=conn,
        wallet=test_wallet,
        decimals=9,
        name="Test",
        symbol="TST",
        metadata_uri="https://test.com/meta.json",
        priority_fee=0,
        use_token_2022=False,
    )
    
    assert result["success"] is True
    mint_address = result["mint"]
    
    from solana.publickey import PublicKey as SolanaPublicKey
    mint_pk_solana = SolanaPublicKey(mint_address)
    metadata_account = find_metadata_account(mint_pk_solana)
    
    assert str(metadata_account), "Metadata account should be derived"

@pytest.mark.asyncio
async def test_metadata_instruction_data_structure():
    conn = Client(RPC_URL)
    
    test_wallet = "HD7dHSFCuvDQqSUuCULA6ssrwceTVVYQwb9wc3iZG5rG"
    
    result = await create_token_transaction(
        connection=conn,
        wallet=test_wallet,
        decimals=9,
        name="My Token",
        symbol="MTK",
        metadata_uri="https://example.com/token.json",
        priority_fee=0,
        use_token_2022=False,
    )
    
    assert result["success"] is True
    tx = result["transaction"]
    
    metadata_instruction = tx.instructions[2]
    data = metadata_instruction.data
    
    assert data[0] == 33, f"Expected discriminator 33 (CreateMetadataAccountV3), got {data[0]}"
    
    name_len = int.from_bytes(data[1:5], "little")
    assert name_len == len("My Token"), f"Name length mismatch: expected {len('My Token')}, got {name_len}"
    
    name_bytes = data[5:5+name_len]
    assert name_bytes.decode("utf-8") == "My Token", "Name mismatch in instruction data"

@pytest.mark.asyncio
async def test_use_token_2022_program():
    conn = Client(RPC_URL)
    
    test_wallet = "HD7dHSFCuvDQqSUuCULA6ssrwceTVVYQwb9wc3iZG5rG"
    
    result_standard = await create_token_transaction(
        connection=conn,
        wallet=test_wallet,
        decimals=9,
        name="Standard Token",
        symbol="STD",
        metadata_uri="",
        priority_fee=0,
        use_token_2022=False,
    )
    
    result_2022 = await create_token_transaction(
        connection=conn,
        wallet=test_wallet,
        decimals=9,
        name="Token 2022",
        symbol="T22",
        metadata_uri="",
        priority_fee=0,
        use_token_2022=True,
    )
    
    assert result_standard["success"] is True
    assert result_2022["success"] is True
    
    mint_standard = result_standard["mint"]
    mint_2022 = result_2022["mint"]
    
    assert mint_standard != mint_2022, "Mints should be different for different symbols"

