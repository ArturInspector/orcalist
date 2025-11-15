# schemas.py
from typing import Optional, Any, Dict
from pydantic import BaseModel


class ProceedReq(BaseModel):
    wallet: str
    decimals: int = 9
    name: Optional[str] = "Cool Name"
    symbol: Optional[str] = "CLSMBL"
    description: Optional[str] = "Cool description"
    metadata_uri: Optional[str] = ""   # IPFS-лого с фронта
    priority_fee: int = 250_000
    use_token_2022: bool = True


class ListingReq(BaseModel):
    wallet: Optional[str] = None
    amount: Optional[float] = None     # solAmount
    priority_fee: int = 250_000
    payload: Optional[Dict[str, Any]] = None

