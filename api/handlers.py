# api/handlers.py
import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from slowapi.errors import RateLimitExceeded

from utils.security_funcs import hash_ip

logger = logging.getLogger("uvicorn.error")


def setup_exception_handlers(app):
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        logger.warning(
            f"Validation error on {request.method} {request.url.path}: "
            f"field_count={len(exc.errors())}, "
            f"client_hash={hash_ip(request.client.host if request.client else None)}"
        )
        return JSONResponse(
            status_code=400,
            content={"detail": "Invalid request"}
        )

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
        client_ip_hash = hash_ip(request.client.host if request.client else None)
        logger.warning(
            f"Rate limit exceeded: {request.method} {request.url.path}, "
            f"client_hash={client_ip_hash}"
        )
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests"},
            headers={"Retry-After": "60"}
        )

