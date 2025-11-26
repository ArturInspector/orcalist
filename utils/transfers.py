from utils.compat import recent_blockhash
import os
import struct
from typing import Dict, Any

from solana.rpc.api import Client
from solders.system_program import TransferParams, transfer
from solana.transaction import Transaction, TransactionInstruction
from solana.publickey import PublicKey as SolanaPublicKey

from solders.pubkey import Pubkey as PublicKey
from utils.compat import recent_blockhash

# ComputeBudget Program ID
COMPUTE_BUDGET_PROGRAM_ID = SolanaPublicKey("ComputeBudget111111111111111111111111111111")

def add_priority_fee(transaction: Transaction, micro_lamports: int) -> None:
    """
    Добавляет priority fee через ComputeBudget SetComputeUnitPrice инструкцию.
    micro_lamports - цена за compute unit в микро-лампортах (1 lamport = 1,000,000 micro-lamports)
    """
    if micro_lamports <= 0:
        return
    
    # SetComputeUnitPrice instruction:
    # discriminator = 3 (u8)
    # micro_lamports = u64 (little-endian)
    data = struct.pack("<BQ", 3, micro_lamports)
    
    instruction = TransactionInstruction(
        program_id=COMPUTE_BUDGET_PROGRAM_ID,
        data=data,
        keys=[]  # SetComputeUnitPrice не требует аккаунтов
    )
    
    # Добавляем priority fee инструкцию в начало
    # Если instructions - tuple, конвертируем в list
    if isinstance(transaction.instructions, tuple):
        transaction.instructions = list(transaction.instructions)
    # Если это list, используем insert для добавления в начало
    if isinstance(transaction.instructions, list):
        transaction.instructions.insert(0, instruction)
    else:
        # Fallback: используем add() если instructions не list и не tuple
        transaction.add(instruction)


def _read_env_pubkey(var_name: str) -> PublicKey:
    v = os.getenv(var_name, "").strip()
    if not v:
        raise ValueError(f"ENV {var_name} is required")
    return PublicKey.from_string(v)


async def create_sol_transfer_transaction(
    connection: Client,
    wallet: str,
    amount: float,
    priority_fee: int = 250000,
) -> Dict[str, Any]:
    try:
        if amount <= 0:
            return {"success": False, "message": "amount must be > 0"}

        wallet_pubkey = PublicKey.from_string(wallet)

        first_wallet = _read_env_pubkey("WALLET_FIRST")
        second_wallet = _read_env_pubkey("WALLET_SECOND")

        try:
            percentage = float(os.getenv("PERCENTAGE", "50"))
        except Exception:
            percentage = 50.0

        if not (0 <= percentage <= 100):
            return {"success": False, "message": "PERCENTAGE must be between 0 and 100"}

        lamport_amount = int(amount * 10**9)
        if lamport_amount <= 0:
            return {"success": False, "message": "amount too small"}

        first_amount = int((lamport_amount * percentage) / 100.0)
        second_amount = lamport_amount - first_amount

        tx = Transaction()
        tx.fee_payer = wallet_pubkey

        add_priority_fee(tx, priority_fee)

        if first_amount > 0:
            tx.add(
                transfer(
                    TransferParams(
                        from_pubkey=wallet_pubkey,
                        to_pubkey=first_wallet,
                        lamports=first_amount,
                    )
                )
            )

        if second_amount > 0:
            tx.add(
                transfer(
                    TransferParams(
                        from_pubkey=wallet_pubkey,
                        to_pubkey=second_wallet,
                        lamports=second_amount,
                    )
                )
            )

        tx.recent_blockhash = recent_blockhash(connection)
        return {"success": True, "transaction": tx}
    except Exception as e:
        return {"success": False, "message": f"Error creating SOL transfer: {e}"}
