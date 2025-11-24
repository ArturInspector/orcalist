# utils/simulation.py
import logging
from typing import Dict, Any, Optional
from solana.rpc.api import Client
from solana.transaction import Transaction

logger = logging.getLogger("uvicorn.error")

def simulate_transaction(connection: Client, tx: Transaction):
    try:
        sim_result = connection.simulate_transaction(tx)
        
        if not sim_result:
            logger.warning("simulate_transaction returned None")
            return None
        
        sim_value = None
        if hasattr(sim_result, 'value'):
            sim_value = sim_result.value
        elif hasattr(sim_result, 'result'):
            sim_value = sim_result.result
        elif isinstance(sim_result, dict):
            sim_value = sim_result.get('value') or sim_result.get('result')
        

        if not sim_value:
            logger.warning(f"Could not extract simulation value from result: {type(sim_result)}")
            return None
        
        result = {
            "err": None,
            "units_consumed": None,
            "logs": [],
        }
        
        if hasattr(sim_value, 'err'):
            err = sim_value.err
            if err:
                result["err"] = str(err)
        elif isinstance(sim_value, dict):
            result["err"] = sim_value.get("err")
        
        if hasattr(sim_value, 'units_consumed'):
            result["units_consumed"] = sim_value.units_consumed
        elif isinstance(sim_value, dict):
            result["units_consumed"] = sim_value.get("units_consumed")
        
        if hasattr(sim_value, 'logs'):
            logs = sim_value.logs
            if logs:
                result["logs"] = list(logs)[:20]
        elif isinstance(sim_value, dict):
            logs = sim_value.get("logs", [])
            if logs:
                result["logs"] = list(logs)[:20]
        
        return result
        
    except Exception as e:
        logger.warning(f"Transaction simulation failed: {type(e).__name__}: {e}")
        return None


def log_simulation_result(sim_result: Optional[Dict[str, Any]], tx: Transaction):
    if not sim_result:
        logger.warning("No simulation result to log")
        return
    
    logger.info(f"Transaction simulation: instructions_count={len(tx.instructions)}")
    
    if sim_result.get("err"):
        logger.error(f"Simulation error: {sim_result['err']}")
    else:
        logger.info("Simulation successful")
    
    if sim_result.get("units_consumed"):
        logger.info(f"Compute units consumed: {sim_result['units_consumed']}")
    
    if sim_result.get("logs"):
        logger.info(f"Simulation logs ({len(sim_result['logs'])} lines):")
        for i, log_line in enumerate(sim_result["logs"][:10]):
            logger.info(f"  [{i}] {log_line}")
        if len(sim_result["logs"]) > 10:
            logger.info(f"  ... and {len(sim_result['logs']) - 10} more log lines")

