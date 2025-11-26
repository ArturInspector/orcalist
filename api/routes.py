# api/routes.py
import base64
import logging
import os
import io
from typing import Dict, Any

import aiohttp

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from solana.rpc.api import Client
from solana.publickey import PublicKey
from solana.transaction import Transaction
from solana.system_program import TransferParams, transfer

from config import RPC_URL, CHARGE_TO, FIXED_CHARGE_SOL, REVOKE_CHARGE_SOL, PINATA_JWT_TOKEN, PINATA_API_KEY, PINATA_SECRET_KEY, RPC_PROVIDER
from schemas import ListingReq
from utils.mint import mint_tokens_transaction, get_mint_info
from utils.transaction_helpers import serialize_transaction_b64, ensure_transaction_fields
from utils.security_funcs import safe_wallet_log, hash_wallet, hash_ip, safe_rpc_url
from utils.simulation import simulate_transaction, log_simulation_result
from utils.authority import create_revoke_transactions

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


@router.post("/api/upload-ipfs")
async def upload_ipfs(file: UploadFile = File(...)):
    """Загружает файл на IPFS через Pinata и возвращает URI с надежным gateway."""
    try:
        file_content = await file.read()
        file_size = len(file_content)
        if file_size > 5 * 1024 * 1024:  # 5mb limit
            raise HTTPException(status_code=400, detail="File too large (max 5MB)")
        logger.info(f"Uploading file to IPFS: name={file.filename}, size={file_size} bytes")
        
        if PINATA_JWT_TOKEN:
            form_data = aiohttp.FormData()
            form_data.add_field("file", io.BytesIO(file_content), filename=file.filename, content_type=file.content_type)
            form_data.add_field("network", "public")
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://uploads.pinata.cloud/v3/files",
                    headers={
                        "Authorization": f"Bearer {PINATA_JWT_TOKEN}",
                    },
                    data=form_data
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        logger.error(f"Pinata v3 upload failed: {resp.status}, {error_text}")
                        raise HTTPException(status_code=500, detail=f"IPFS upload failed: {error_text}")
                    
                    data = await resp.json()
                    cid = data.get("data", {}).get("cid") or data.get("data", {}).get("IpfsHash")
                    if not cid:
                        logger.error(f"Pinata v3 response: {data}")
                        raise HTTPException(status_code=500, detail="No IPFS hash returned")
                    
                    ipfs_url = f"https://ipfs.io/ipfs/{cid}"
                    logger.info(f"File uploaded to IPFS via Pinata (v3), gateway: {ipfs_url}")
                    return {"success": True, "ipfs_url": ipfs_url, "provider": "pinata"}
        
        # Fallback на v1 API (legacy)
        elif PINATA_API_KEY and PINATA_SECRET_KEY:
            form_data = aiohttp.FormData()
            form_data.add_field("file", io.BytesIO(file_content), filename=file.filename, content_type=file.content_type)
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.pinata.cloud/pinning/pinFileToIPFS",
                    headers={
                        "pinata_api_key": PINATA_API_KEY,
                        "pinata_secret_api_key": PINATA_SECRET_KEY,
                    },
                    data=form_data
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        logger.error(f"Pinata v1 upload failed: {resp.status}, {error_text}")
                        raise HTTPException(status_code=500, detail="IPFS upload failed")
                    
                    data = await resp.json()
                    ipfs_hash = data.get("IpfsHash")
                    if not ipfs_hash:
                        raise HTTPException(status_code=500, detail="No IPFS hash returned")
                    
                    # Используем надежный gateway вместо Pinata
                    ipfs_url = f"https://ipfs.io/ipfs/{ipfs_hash}"
                    logger.info(f"File uploaded to IPFS via Pinata (v1), gateway: {ipfs_url}")
                    return {"success": True, "ipfs_url": ipfs_url, "provider": "pinata"}
        else:
            logger.warning("Pinata credentials not configured, IPFS upload disabled")
            raise HTTPException(
                status_code=503,
                detail="IPFS upload not configured. Set PINATA_JWT_TOKEN (preferred) or PINATA_API_KEY + PINATA_SECRET_KEY in environment."
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"IPFS upload error: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.post("/api/upload-metadata")
async def upload_metadata(request: Request):
    """
    Upload token metadata JSON to Pinata IPFS.
    Возвращает URI с надежным публичным gateway (ipfs.io).
    SRP: Python API handles IPFS uploads
    """
    try:
        body = await request.json()
        name = body.get("name", "")
        symbol = body.get("symbol", "")
        description = body.get("description", "") or ""
        image = body.get("image", "")
        website = body.get("website", "").strip()
        twitter = body.get("twitter", "").strip()
        telegram = body.get("telegram", "").strip()
        discord = body.get("discord", "").strip()
        
        logger.info(f"Upload metadata: name={name}, symbol={symbol}, description='{description}', image={image[:50] if image else 'empty'}...")
        
        # Заменяем любые gateway на надежный для изображения в метаданных
        if image and "/ipfs/" in image:
            # Извлекаем CID из любого URL
            cid = image.split("/ipfs/")[-1].split("?")[0]
            # Заменяем на надежный публичный gateway
            image = f"https://ipfs.io/ipfs/{cid}"
            logger.info(f"Replaced gateway with ipfs.io for image: {image}")
        
        metadata = {
            "name": name,
            "symbol": symbol,
            "description": description,
        }
        if image:
            metadata["image"] = image
        
        # Добавляем соцсети в метаданные (если есть)
        if website:
            metadata["external_url"] = website
        if twitter:
            metadata["twitter"] = twitter
        if telegram:
            metadata["telegram"] = telegram
        if discord:
            metadata["discord"] = discord
        
        import json as json_lib
        metadata_json = json_lib.dumps(metadata)
        metadata_bytes = metadata_json.encode()
        
        if PINATA_JWT_TOKEN:
            form_data = aiohttp.FormData()
            form_data.add_field(
                "file",
                io.BytesIO(metadata_json.encode()),
                filename="metadata.json",
                content_type="application/json"
            )
            form_data.add_field("network", "public")  # Публичный доступ без пароля
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://uploads.pinata.cloud/v3/files",
                    headers={"Authorization": f"Bearer {PINATA_JWT_TOKEN}"},
                    data=form_data
                ) as response:
                    if response.status != 200:
                        text = await response.text()
                        logger.error(f"Pinata upload failed: {response.status} {text}")
                        raise HTTPException(status_code=500, detail="IPFS upload failed")
                    
                    result = await response.json()
                    cid = result.get("data", {}).get("cid")
                    if not cid:
                        raise HTTPException(status_code=500, detail="No CID returned from Pinata")
                    
                    # Заменяем Pinata gateway на более надежный ipfs.io
                    uri = f"https://ipfs.io/ipfs/{cid}"
                    logger.info(f"Metadata uploaded to IPFS (public access), gateway: {uri}")
                    return {"success": True, "uri": uri, "cid": cid}
        else:
            raise HTTPException(
                status_code=503,
                detail="IPFS upload not configured. Set PINATA_JWT_TOKEN."
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Metadata upload error: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.get("/health")
def health():
    return {
        "status": "ok",
        "rpc": safe_rpc_url(RPC_URL),
        "charge_to": CHARGE_TO,
        "fixed_charge_sol": FIXED_CHARGE_SOL,
    }


@router.get("/api/config")
def get_config():
    return {
        "network": "devnet" if "devnet" in RPC_URL.lower() else "mainnet",
        "use_proxy": True,
        "charge_to": CHARGE_TO,
        "fixed_charge_sol": FIXED_CHARGE_SOL,
        "revoke_charge_sol": REVOKE_CHARGE_SOL,
    }


@router.post("/api/send-transaction")
async def send_transaction(request: Request):
    MAX_TX_SIZE = 1232
    
    try:
        body = await request.json()
        signed_tx_b64 = body.get("signed_tx")
        
        if not signed_tx_b64:
            raise HTTPException(status_code=400, detail="signed_tx required")
        
        try:
            signed_tx_bytes = base64.b64decode(signed_tx_b64)
        except Exception as e:
            logger.warning(f"Failed to decode base64 transaction: {type(e).__name__}: {e}")
            raise HTTPException(status_code=400, detail="Invalid base64 transaction")
        
        if len(signed_tx_bytes) > MAX_TX_SIZE:
            client_ip_hash = hash_ip(request.client.host if request.client else None)
            logger.warning(
                f"Transaction too large: size={len(signed_tx_bytes)} bytes (limit={MAX_TX_SIZE}), "
                f"client_hash={client_ip_hash}"
            )
            raise HTTPException(status_code=400, detail="Transaction too large")
        
        try:
            tx = Transaction.deserialize(signed_tx_bytes)
            if not tx.signatures or all(sig == bytes(64) for sig in tx.signatures):
                logger.warning("Transaction is not signed")
                raise HTTPException(status_code=400, detail="Transaction is not signed")
        except Exception as e:
            logger.warning(f"Invalid transaction format: {type(e).__name__}: {e}")
            raise HTTPException(status_code=400, detail="Invalid transaction format")
        
        ALLOWED_PROGRAMS = {
            "11111111111111111111111111111111",
            "ComputeBudget111111111111111111111111111111",
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
            "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
        }
        
        for ix in tx.instructions:
            program_id_str = str(ix.program_id)
            if program_id_str not in ALLOWED_PROGRAMS:
                client_ip_hash = hash_ip(request.client.host if request.client else None)
                logger.warning(
                    f"Transaction contains disallowed program: {program_id_str}, "
                    f"client_hash={client_ip_hash}"
                )
                raise HTTPException(status_code=400, detail="Transaction contains disallowed instructions")
        
        conn = Client(RPC_URL)
        
        try:
            result = conn.send_raw_transaction(signed_tx_bytes)
        except Exception as e:
            logger.error(f"RPC send_raw_transaction failed: {type(e).__name__}: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")
        
        signature = None
        if hasattr(result, 'value') and result.value:
            signature = result.value
        elif hasattr(result, 'result') and result.result:
            signature = result.result
        elif isinstance(result, str):
            signature = result
        else:
            try:
                if hasattr(result, 'to_json'):
                    import json
                    json_data = json.loads(result.to_json())
                    signature = json_data.get('result', json_data.get('value'))
            except Exception:
                pass
        
        if not signature:
            logger.error(f"Failed to extract signature from RPC response: {type(result)}")
            raise HTTPException(status_code=500, detail="Internal server error")
        
        signature_str = str(signature)
        logger.info(f"Transaction sent via proxy: signature={signature_str[:16]}...")
        
        return {
            "success": True,
            "signature": signature_str
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending transaction via proxy: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


# DEPRECATED: /api/proceed removed - use Token Service directly from frontend
# Frontend now calls:
#   1. POST /api/upload-metadata (Python API) - upload metadata to IPFS
#   2. POST /api/create-token (Token Service) - create unsigned transaction
#   3. Sign transaction in wallet
#   4. POST /api/send-transaction (Token Service) - send signed transaction to RPC


@router.post("/api/listing")
async def api_listing(req: ListingReq):
    logger.info(
        f"post /api/listing: wallet={safe_wallet_log(req.wallet) if req.wallet else 'None'}, "
        f"wallet_hash={hash_wallet(req.wallet) if req.wallet else 'none'}, "
        f"amount={req.amount}"
    )
    try:
        wallet = req.wallet
        amount = req.amount
        mint_address = None
        token_amount = None

        if req.payload and isinstance(req.payload, dict): # вроде тот метод
            wallet = wallet or req.payload.get("wallet")
            mint_address = req.payload.get("mint")
            token_amount_str = req.payload.get("tokenAmount")
            if token_amount_str:
                try:
                    token_amount = float(token_amount_str)
                except Exception as e:
                    logger.warning(f"Failed to parse tokenAmount: {token_amount_str}, error: {type(e).__name__}: {e}")
            
            if amount is None:
                sa = req.payload.get("solAmount")
                if sa is not None:
                    try:
                        amount = float(sa)
                    except Exception as e:
                        logger.warning(f"Failed to parse solAmount from payload: {sa}, error: {type(e).__name__}: {e}")

        # валидация wallet
        if not wallet:
            logger.warning("Missing wallet")
            raise HTTPException(status_code=400, detail="Invalid request")
        
        try:
            PublicKey(wallet)
        except Exception as e:
            logger.warning(
                f"Invalid wallet address: wallet={safe_wallet_log(wallet)}, "
                f"wallet_hash={hash_wallet(wallet)}, "
                f"error_type={type(e).__name__}"
            )
            raise HTTPException(status_code=400, detail="Invalid request")

        # если есть mint и tokenAmount - делаем листинг токена
        if mint_address and token_amount and token_amount > 0:
            try:
                PublicKey(mint_address)
            except Exception as e:
                logger.warning(f"Invalid mint address: {mint_address[:8]}..., error: {type(e).__name__}: {e}")
                raise HTTPException(status_code=400, detail="Invalid mint address")

            conn = Client(RPC_URL)
            
            # получаем decimals и use_token_2022 из mint
            mint_info = await get_mint_info(conn, mint_address)
            if not mint_info.get("success"):
                error_msg = mint_info.get("message", "Failed to get mint info")
                logger.error(f"get_mint_info failed: mint={mint_address[:8]}..., error={error_msg}")
                raise HTTPException(
                    status_code=400, 
                    detail=f"Mint account not found. {error_msg} Make sure you sent and confirmed the token creation transaction first."
                )
            
            decimals = mint_info.get("decimals")
            use_token_2022 = mint_info.get("use_token_2022", False)
            
            logger.info(
                f"Listing token: mint={mint_address[:8]}..., "
                f"token_amount={token_amount}, decimals={decimals}, token_2022={use_token_2022}"
            )
            
            # создаём транзакцию минта
            mint_res = await mint_tokens_transaction(
                connection=conn,
                wallet=wallet,
                mint_address=mint_address,
                amount=token_amount,
                decimals=decimals,
                priority_fee=req.priority_fee,
                use_token_2022=use_token_2022,
            )
            
            if not mint_res or not mint_res.get("success"):
                error_msg = mint_res.get("message", "mint_tokens_transaction failed")
                logger.error(f"mint_tokens_transaction failed: {error_msg}")
                raise HTTPException(status_code=500, detail="Internal server error")
            
            tx: Transaction = mint_res["transaction"]
            
            # mint_tokens_transaction уже установил, для свежести
            ensure_transaction_fields(conn, tx, wallet)
            if amount and amount > 0:
                if not CHARGE_TO:
                    logger.error("CHARGE_TO configuration is empty")
                    raise HTTPException(status_code=500, detail="Internal server error")
                
                try:
                    PublicKey(CHARGE_TO)
                except Exception as e:
                    logger.error(f"Invalid CHARGE_TO configuration: '{CHARGE_TO}', error: {type(e).__name__}: {e}")
                    raise HTTPException(status_code=500, detail="Internal server error")
                
                lamports = int(float(amount) * 1_000_000_000)
                tx.add(
                    transfer(
                        TransferParams(
                            from_pubkey=PublicKey(wallet),
                            to_pubkey=PublicKey(CHARGE_TO),
                            lamports=lamports,
                        )
                    )
                )
            
            assert tx.fee_payer is not None, "fee_payer is not set"
            assert tx.recent_blockhash, "recent_blockhash is empty"
            
            b64 = serialize_transaction_b64(tx)
            return {"success": True, "tx": b64, "updatedTx": [b64]}
        
        # fallback: старый вариант - только SOL transfer
        if not amount or amount <= 0:
            logger.warning(f"Missing required fields: wallet={wallet is not None}, amount={amount}, mint={mint_address is not None}")
            raise HTTPException(status_code=400, detail="Invalid request")

        if not CHARGE_TO:
            logger.error("CHARGE_TO configuration is empty")
            raise HTTPException(status_code=500, detail="Internal server error")

        try:
            PublicKey(CHARGE_TO)
        except Exception as e:
            logger.error(f"Invalid CHARGE_TO configuration: '{CHARGE_TO}', error: {type(e).__name__}: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")

        conn = Client(RPC_URL)
        tx = Transaction()

        ensure_transaction_fields(conn, tx, wallet)

        lamports = int(float(amount) * 1_000_000_000)
        tx.add(
            transfer(
                TransferParams(
                    from_pubkey=PublicKey(wallet),
                    to_pubkey=PublicKey(CHARGE_TO),
                    lamports=lamports,
                )
            )
        )

        assert tx.fee_payer is not None, "fee_payer is not set"
        assert tx.recent_blockhash, "recent_blockhash is empty"

        b64 = serialize_transaction_b64(tx)
        return {"success": True, "tx": b64, "updatedTx": [b64]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Unexpected error in /api/listing: error_type={type(e).__name__}, "
            f"wallet_hash={hash_wallet(wallet) if wallet else 'none'}",
            exc_info=True
        )
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/api/revoke-all")
async def revoke_all(request: Request):
    try:
        body = await request.json()
        wallet = body.get("wallet")
        mint_address = body.get("mint_address")
        revoke_mint = body.get("revoke_mint", False)
        revoke_freeze = body.get("revoke_freeze", False)
        revoke_update = body.get("revoke_update", False)
        priority_fee = int(body.get("priority_fee", 250000))

        if not wallet or not mint_address:
            raise HTTPException(status_code=400, detail="wallet and mint_address required")

        if not any([revoke_mint, revoke_freeze, revoke_update]):
            raise HTTPException(status_code=400, detail="At least one revoke required")

        revoke_count = sum([revoke_mint, revoke_freeze, revoke_update])
        revoke_cost = revoke_count * REVOKE_CHARGE_SOL
        logger.info(
            f"post /api/revoke-all: wallet={safe_wallet_log(wallet) if wallet else 'None'}, "
            f"wallet_hash={hash_wallet(wallet) if wallet else 'none'}, "
            f"mint={mint_address[:8] if mint_address else 'None'}..., "
            f"revokes=[mint={revoke_mint}, freeze={revoke_freeze}, update={revoke_update}], "
            f"count={revoke_count}, expected_cost={revoke_cost:.4f} SOL"
        )

        conn = Client(RPC_URL)
        logger.info(f"checking mint account: mint={mint_address}")
        mint_info = await get_mint_info(conn, mint_address)
        logger.info(f"get_mint_info result: success={mint_info.get('success')}, message={mint_info.get('message')}, mint={mint_address[:8]}...")
        if not mint_info.get("success"):
            error_msg = mint_info.get("message", "Mint not found")
            logger.warning(f"Mint not found: mint={mint_address}, message={error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        transactions = []
        token_service_url = os.getenv("TOKEN_SERVICE_URL", "http://localhost:3001")

        if revoke_mint or revoke_freeze:
            try:
                logger.info(f"Calling Token Service for revoke: mint={revoke_mint}, freeze={revoke_freeze}")
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{token_service_url}/api/revoke-authority",
                        json={
                            "wallet": wallet,
                            "mint_address": mint_address,
                            "revoke_mint": revoke_mint,
                            "revoke_freeze": revoke_freeze,
                            "priority_fee": priority_fee,
                            "charge_to": CHARGE_TO,
                        },
                        timeout=aiohttp.ClientTimeout(total=30)
                    ) as resp:
                        if resp.status != 200:
                            error_text = await resp.text()
                            logger.error(f"Token Service revoke-authority failed: {resp.status}, {error_text}")
                            raise HTTPException(status_code=500, detail=f"Token Service error: {error_text}")
                        
                        data = await resp.json()
                        if not data.get("success"):
                            error_msg = data.get("error", "Token Service returned error")
                            logger.error(f"Token Service revoke-authority error: {error_msg}")
                            raise HTTPException(status_code=500, detail=error_msg)
                        
                        # Добавляем транзакции от Token Service
                        service_transactions = data.get("transactions", [])
                        logger.info(
                            f"Token Service returned {len(service_transactions)} transactions for "
                            f"revoke_mint={revoke_mint}, revoke_freeze={revoke_freeze}"
                        )
                        transactions.extend(service_transactions)
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error calling Token Service for revoke: {type(e).__name__}: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Error calling Token Service: {str(e)}")

        # Revoke update authority через Token Service (Metaplex)
        if revoke_update:
            try:
                logger.info(f"Calling Token Service for revoke-update-authority")
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{token_service_url}/api/revoke-update-authority",
                        json={
                            "mint": mint_address,
                            "payer": wallet,
                            "charge_to": CHARGE_TO
                        },
                        timeout=aiohttp.ClientTimeout(total=30)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            if data.get("success") and data.get("transaction"):
                                transactions.append(data["transaction"])
                                logger.info("Added revoke-update-authority transaction")
                        else:
                            error_text = await resp.text()
                            logger.error(f"Token Service revoke-update-authority failed: {resp.status}, {error_text}")
            except Exception as e:
                logger.error(f"Error calling Token Service for revoke-update-authority: {type(e).__name__}: {e}", exc_info=True)
                # Не прерываем выполнение - revoke update не критичен

        logger.info(
            f"revoke-all completed: mint={mint_address[:8] if mint_address else 'None'}..., "
            f"transactions_created={len(transactions)}"
        )
        return {"success": True, "transactions": transactions}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in revoke-all: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def setup_routes(limiter):
    limiter.limit("3/minute")(send_transaction)