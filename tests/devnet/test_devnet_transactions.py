from __future__ import annotations
import os
import base64
import pytest
from httpx import AsyncClient
from solana.rpc.api import Client
from solana.transaction import Transaction
from solana.publickey import PublicKey
from solana import system_program
import main
from spl.token.constants import TOKEN_PROGRAM_ID

DEVNET_WALLET = os.getenv("DEVNET_TEST_WALLET", "6gCw4YyWaRCg6nGXiQTNyHwVRBnQsj5rVJf7PHQEwdcE")
DEVNET_RPC = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")

@pytest.fixture
async def client() -> AsyncClient:
    async with AsyncClient(app=main.app, base_url="http://test") as ac:
        yield ac

@pytest.fixture
def rpc_client() -> Client:
    return Client(DEVNET_RPC)


@pytest.mark.devnet
@pytest.mark.asyncio
async def test_proceed_creates_valid_devnet_transaction(client: AsyncClient, rpc_client: Client) -> None:    
    payload = {
        "wallet": DEVNET_WALLET,
        "decimals": 9,
        "name": "Devnet Test Token",
        "symbol": "DTT",
        "description": "Test token for devnet",
        "metadata_uri": "",
        "priority_fee": 250000,
        "use_token_2022": False,
    }
    
    response = await client.post("/api/proceed", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    
    # десериализуем транзакцию
    tx_b64 = data["tx"]
    tx_bytes = base64.b64decode(tx_b64)
    tx = Transaction.deserialize(tx_bytes)
    
    # проверяем структуру
    assert tx.fee_payer == PublicKey(DEVNET_WALLET)
    assert tx.recent_blockhash is not None
    try:
        sim_result = rpc_client.simulate_transaction(tx)
        assert sim_result is not None
    except Exception as e:
        pytest.fail(f"Transaction simulation failed: {e}")

    mint = data["mint"]
    seed = data["seed"]
    expected_mint = PublicKey.create_with_seed(
        PublicKey(DEVNET_WALLET),
        seed,
        TOKEN_PROGRAM_ID
    )
    assert str(expected_mint) == mint


@pytest.mark.devnet
@pytest.mark.asyncio
async def test_listing_creates_valid_devnet_transfer(client: AsyncClient, rpc_client: Client) -> None:
    """Проверяем что SOL transfer транзакция корректно формируется на devnet."""
    
    payload = {
        "wallet": DEVNET_WALLET,
        "amount": 0.001,  # минимальная сумма для теста
        "priority_fee": 250000,
    }
    
    response = await client.post("/api/listing", json=payload)
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    
    # десериализуем транзакцию
    tx_b64 = data["tx"]
    tx_bytes = base64.b64decode(tx_b64)
    tx = Transaction.deserialize(tx_bytes)
    
    # проверяем структуру
    assert tx.fee_payer == PublicKey(DEVNET_WALLET)
    assert tx.recent_blockhash is not None
    assert len(tx.instructions) == 1
    
    # симулируем транзакцию (не отправляем реально)
    try:
        sim_result = rpc_client.simulate_transaction(tx)
        assert sim_result is not None
    except Exception as e:
        pytest.fail(f"Transaction simulation failed: {e}")


@pytest.mark.devnet
@pytest.mark.asyncio
async def test_proceed_includes_fixed_charge(client: AsyncClient) -> None:
    payload = {
        "wallet": DEVNET_WALLET,
        "decimals": 9,
        "symbol": "FEE",
    }
    
    response = await client.post("/api/proceed", json=payload)
    
    assert response.status_code == 200
    data = response.json()
    
    # десериализуем транзакцию
    tx_b64 = data["tx"]
    tx_bytes = base64.b64decode(tx_b64)
    tx = Transaction.deserialize(tx_bytes)
    
    # проверяем что есть инструкция transfer для фикс-чарджа
    # должна быть минимум одна transfer инструкция (фикс-чардж)
    transfer_instructions = [
        instr for instr in tx.instructions
        if instr.program_id == system_program.SYS_PROGRAM_ID
    ]
    
    assert len(transfer_instructions) >= 1, "Fixed charge transfer not found in transaction"

