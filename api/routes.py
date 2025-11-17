# api/routes.py
import base64
import logging
from typing import Dict, Any

from fastapi import APIRouter, HTTPException, Request
from solana.rpc.api import Client
from solana.publickey import PublicKey
from solana.transaction import Transaction
from solana.system_program import TransferParams, transfer

from config import RPC_URL, CHARGE_TO, FIXED_CHARGE_SOL
from schemas import ProceedReq, ListingReq
from utils.token_ops import create_token_transaction
from utils.mint import mint_tokens_transaction, get_mint_info
from utils.transaction_helpers import (
    serialize_transaction_b64,
    ensure_transaction_fields,
    append_fixed_charge,
)
from utils.security_funcs import safe_wallet_log, hash_wallet, hash_ip, safe_rpc_url

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


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
        "use_proxy": True
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


@router.post("/api/proceed")
async def api_proceed(req: ProceedReq, request: Request):
    logger.info(
        f"POST /api/proceed: wallet={safe_wallet_log(req.wallet)}, "
        f"wallet_hash={hash_wallet(req.wallet)}, "
        f"symbol={req.symbol}, decimals={req.decimals}"
    )
    try:
        try:
            PublicKey(req.wallet)
        except Exception as e:
            logger.warning(
                f"Invalid wallet address: wallet={safe_wallet_log(req.wallet)}, "
                f"wallet_hash={hash_wallet(req.wallet)}, "
                f"length={len(req.wallet)}, error_type={type(e).__name__}"
            )
            raise HTTPException(status_code=400, detail="Invalid request")

        if CHARGE_TO:
            try:
                PublicKey(CHARGE_TO)
            except Exception as e:
                logger.error(f"Invalid CHARGE_TO configuration: '{CHARGE_TO}', error: {type(e).__name__}: {e}")
                raise HTTPException(status_code=500, detail="Internal server error")

        conn = Client(RPC_URL)

        res = await create_token_transaction(
            connection=conn,
            wallet=req.wallet,
            decimals=req.decimals,
            name=req.name or "",
            symbol=req.symbol or "",
            description=req.description or "",
            metadata_uri=req.metadata_uri or "",
            priority_fee=req.priority_fee,
            use_token_2022=req.use_token_2022,
        )
        if not res or not res.get("success"):
            error_msg = res.get("message", "create_token failed")
            logger.error(f"create_token_transaction failed: {error_msg}")
            raise HTTPException(status_code=500, detail="Internal server error")

        tx: Transaction = res["transaction"]

        ensure_transaction_fields(conn, tx, req.wallet)
        append_fixed_charge(tx, req.wallet)

        assert tx.fee_payer is not None, "fee_payer is not set"
        assert tx.recent_blockhash, "recent_blockhash is empty"

        b64 = serialize_transaction_b64(tx)
        return {
            "success": True,
            "tx": b64,
            "updatedTx": [b64],
            "mint": res.get("mint"),
            "seed": res.get("seed"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Unexpected error in /api/proceed: error_type={type(e).__name__}, "
            f"wallet_hash={hash_wallet(req.wallet)}",
            exc_info=True
        )
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/api/listing")
async def api_listing(req: ListingReq):
    logger.info(
        f"POST /api/listing: wallet={safe_wallet_log(req.wallet) if req.wallet else 'None'}, "
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


def setup_routes(limiter):
    limiter.limit("10/minute")(send_transaction)
    limiter.limit("30/minute")(api_proceed)