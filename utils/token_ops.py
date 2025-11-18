# utils/token_ops.py
import os
from typing import Dict, Any
import logging

from solana.rpc.api import Client
from solana.publickey import PublicKey
from solana.transaction import Transaction
from solana.system_program import (
    CreateAccountWithSeedParams,
    create_account_with_seed,
)
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token._layouts import MINT_LAYOUT
from spl.token.instructions import (
    initialize_mint,
    InitializeMintParams,
)

from utils.compat import recent_blockhash
from utils.metadata import (
    find_metadata_account,
    create_metadata_instruction_v3,
    create_token_2022_metadata_instruction,
)

logger = logging.getLogger("uvicorn.error")

TOKEN_2022_PROGRAM_ID = PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")


def _rent_exempt(connection: Client, size: int) -> int:
    """Возвращает кол-во лампортов для rent-exempt, независимо от формы ответа."""
    resp = connection.get_minimum_balance_for_rent_exemption(size)
    val = getattr(resp, "value", None)
    if val is None:
        if isinstance(resp, int):
            val = resp
        elif isinstance(resp, dict):
            val = resp.get("result")
    if val is None:
        raise RuntimeError("cannot fetch rent exempt")
    return int(val)


async def create_token_transaction(
    connection: Client,
    wallet: str,
    decimals: int = 9,
    name: str = "",
    symbol: str = "",
    description: str = "",
    metadata_uri: str = "",
    priority_fee: int = 250000,
    use_token_2022: bool = True,
) -> Dict[str, Any]:
    try:
        logger.info(f"create_token_transaction called: wallet={wallet[:8]}..., decimals={decimals}, name={name}, symbol={symbol}, metadata_uri={metadata_uri[:50] if metadata_uri else 'empty'}, use_token_2022={use_token_2022}")
        
        wallet_pk = PublicKey(wallet)
        program_id = TOKEN_2022_PROGRAM_ID if use_token_2022 else TOKEN_PROGRAM_ID
        logger.info(f"Using token program: {program_id} (use_token_2022={use_token_2022})")
        
        seed = (symbol or "mint")[:16] or "mint"
        mint_pk = PublicKey.create_with_seed(wallet_pk, seed, program_id)
        logger.info(f"Generated mint: {mint_pk}, seed={seed}")

        # Для Token-2022 с метаданными нужно больше места
        # Base mint size + Metadata extension (1 + 32 + 4 + 35 + 4 + 11 + 4 + 200 = ~291 bytes)
        mint_size = MINT_LAYOUT.sizeof()
        if use_token_2022 and (metadata_uri or name or symbol):
            # Metadata extension size: type(1) + update_authority(32) + name(4+35) + symbol(4+11) + uri(4+200) = ~291
            metadata_extension_size = 291
            mint_size += metadata_extension_size
            logger.info(f"Token-2022 with metadata: adding {metadata_extension_size} bytes for metadata extension")
        
        lamports = _rent_exempt(connection, mint_size)
        logger.info(f"Mint account size={mint_size}, rent_exempt={lamports} lamports")

        tx = Transaction()
        tx.fee_payer = wallet_pk
        logger.info(f"Transaction created, fee_payer={wallet_pk}")

        logger.info("Adding create_account_with_seed instruction")
        tx.add(
            create_account_with_seed(
                CreateAccountWithSeedParams(
                    from_pubkey=wallet_pk,
                    base_pubkey=wallet_pk,
                    seed=seed,
                    new_account_pubkey=mint_pk,
                    lamports=lamports,
                    space=mint_size,
                    program_id=program_id,
                )
            )
        )
        logger.info(f"Instruction 0 added: create_account_with_seed, instructions_count={len(tx.instructions)}")

        logger.info("Adding initialize_mint instruction")
        tx.add(
            initialize_mint(
                InitializeMintParams(
                    program_id=program_id,
                    mint=mint_pk,
                    decimals=int(decimals),
                    mint_authority=wallet_pk,
                    freeze_authority=wallet_pk,
                )
            )
        )
        logger.info(f"Instruction 1 added: initialize_mint, instructions_count={len(tx.instructions)}")

        if not use_token_2022 and (metadata_uri or name or symbol):
            try:
                logger.info("Preparing Metaplex metadata instruction for SPL Token")
                metadata_account = find_metadata_account(mint_pk)
                logger.info(f"Metadata account: {metadata_account}")
                
                logger.info(f"Calling create_metadata_instruction_v3 with: name={name or symbol or 'Token'}, symbol={symbol or 'TKN'}, uri={metadata_uri or ''}, token_program={program_id}")
                metadata_ix = create_metadata_instruction_v3(
                    metadata_account=metadata_account,
                    mint=mint_pk,
                    mint_authority=wallet_pk,
                    payer=wallet_pk,
                    update_authority=wallet_pk,
                    name=name or symbol or "Token",
                    symbol=symbol or "TKN",
                    uri=metadata_uri or "",
                    is_mutable=True,
                    token_program=program_id,
                )
                
                tx.add(metadata_ix)
                logger.info(f"Instruction 2 added: create_metadata, instructions_count={len(tx.instructions)}")
                logger.info(f"Metadata instruction program_id={metadata_ix.program_id}, data_len={len(metadata_ix.data)}, keys_count={len(metadata_ix.keys)}")
            except Exception as e:
                logger.error(f"Failed to add metadata instruction: {type(e).__name__}: {e}", exc_info=True)
                raise
        elif use_token_2022 and (metadata_uri or name or symbol):
            try:
                logger.info("Preparing Token-2022 metadata extension instruction")
                metadata_ix = create_token_2022_metadata_instruction(
                    mint=mint_pk,
                    update_authority=wallet_pk,
                    mint_authority=wallet_pk,
                    payer=wallet_pk,
                    name=name or symbol or "Token",
                    symbol=symbol or "TKN",
                    uri=metadata_uri or "",
                    token_program=program_id,
                )
                
                tx.add(metadata_ix)
                logger.info(f"Instruction 2 added: Token-2022 metadata, instructions_count={len(tx.instructions)}")
                logger.info(f"Token-2022 metadata instruction program_id={metadata_ix.program_id}, data_len={len(metadata_ix.data)}, keys_count={len(metadata_ix.keys)}")
            except Exception as e:
                logger.error(f"Failed to add Token-2022 metadata instruction: {type(e).__name__}: {e}", exc_info=True)
                raise

        tx.recent_blockhash = recent_blockhash(connection)
        logger.info(f"Transaction prepared: instructions_count={len(tx.instructions)}, recent_blockhash={tx.recent_blockhash[:16] if tx.recent_blockhash else 'None'}...")
        
        for i, ix in enumerate(tx.instructions):
            logger.info(f"Final instruction[{i}]: program_id={ix.program_id}, data_len={len(ix.data)}, keys_count={len(ix.keys)}")

        return {
            "success": True,
            "transaction": tx,
            "mint": str(mint_pk),
            "seed": seed,
        }

    except Exception as e:
        logger.error(f"Error in create_token_transaction: {type(e).__name__}: {e}", exc_info=True)
        return {"success": False, "message": f"Error creating token: {e}"}
