# schemas.py
# Pydantic models for API requests

from typing import Optional, Any, Dict
from pydantic import BaseModel


# DEPRECATED: ProceedReq removed - frontend now uses Token Service directly


class ListingReq(BaseModel):
    wallet: Optional[str] = None
    amount: Optional[float] = None     # solAmount
    priority_fee: int = 250_000
    payload: Optional[Dict[str, Any]] = None

