from __future__ import annotations
import base64
import pytest
from httpx import AsyncClient
from solana.transaction import Transaction
from solana.publickey import PublicKey
import main

VALID_WALLET = "6gCw4YyWaRCg6nGXiQTNyHwVRBnQsj5rVJf7PHQEwdcE"
INVALID_WALLET = "invalid_pubkey_123"


@pytest.fixture
async def client() -> AsyncClient:
    async with AsyncClient(app=main.app, base_url="http://test") as ac:
        yield ac

@pytest.mark.asyncio
async def test_proceed_creates_valid_transaction(client: AsyncClient) -> None:
    payload = {
        "wallet": VALID_WALLET,
        "decimals": 9,
        "name": "Test Token",
        "symbol": "TEST",
        "description": "Test description",
        "metadata_uri": "",
        "priority_fee": 250000,
        "use_token_2022": False,
    }
    
    response = await client.post("/api/proceed", json=payload)
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "tx" in data
    assert "mint" in data
    assert "seed" in data
    tx_b64 = data["tx"]
    tx_bytes = base64.b64decode(tx_b64)
    tx = Transaction.deserialize(tx_bytes)
    
    assert tx.fee_payer == PublicKey(VALID_WALLET)
    assert tx.recent_blockhash is not None
    assert len(tx.instructions) >= 2  # создание аккаунта + инициализация mint + фикс-чардж


@pytest.mark.asyncio
async def test_proceed_rejects_invalid_wallet(client: AsyncClient) -> None:
    payload = {
        "wallet": INVALID_WALLET,
        "decimals": 9,
        "symbol": "TEST",
    }
    
    response = await client.post("/api/proceed", json=payload)
    
    assert response.status_code == 400
    data = response.json()
    assert "Invalid payer wallet" in data["detail"]


@pytest.mark.asyncio
async def test_proceed_returns_mint_address(client: AsyncClient) -> None:
    payload = {
        "wallet": VALID_WALLET,
        "decimals": 9,
        "symbol": "UNIQ",
        "name": "Unique Token",
    }
    
    response = await client.post("/api/proceed", json=payload)
    
    assert response.status_code == 200
    data = response.json()
    
    # проверяем что mint адрес валидный PublicKey
    mint = data["mint"]
    try:
        PublicKey(mint)
    except Exception:
        pytest.fail(f"Invalid mint address: {mint}")


@pytest.mark.asyncio
async def test_listing_creates_sol_transfer(client: AsyncClient) -> None:
    payload = {
        "wallet": VALID_WALLET,
        "amount": 0.01,
        "priority_fee": 250000,
    }
    
    response = await client.post("/api/listing", json=payload)
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "tx" in data
    
    # проверяем что транзакция валидная
    tx_b64 = data["tx"]
    tx_bytes = base64.b64decode(tx_b64)
    tx = Transaction.deserialize(tx_bytes)
    
    assert tx.fee_payer == PublicKey(VALID_WALLET)
    assert tx.recent_blockhash is not None
    assert len(tx.instructions) == 1  # только SOL transfer


@pytest.mark.asyncio
async def test_listing_rejects_invalid_amount(client: AsyncClient) -> None:
    payload = {
        "wallet": VALID_WALLET,
        "amount": -1.0,
    }
    
    response = await client.post("/api/listing", json=payload)
    
    assert response.status_code == 400
    data = response.json()
    assert "wallet/amount required" in data["detail"]


@pytest.mark.asyncio
async def test_listing_supports_payload_format(client: AsyncClient) -> None:
    # проверяем что работает формат с payload
    payload = {
        "payload": {
            "wallet": VALID_WALLET,
            "solAmount": 0.02,
        },
        "priority_fee": 250000,
    }
    
    response = await client.post("/api/listing", json=payload)
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "tx" in data

