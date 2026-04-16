# main.py - point of enter
import os
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from slowapi import Limiter
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_ipaddr

from api.handlers import setup_exception_handlers
from api.routes import router, setup_routes

app = FastAPI()

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https:; "
            "connect-src 'self' https://*.helius-rpc.com https://api.devnet.solana.com https://api.mainnet-beta.solana.com https://gateway.pinata.cloud https://ipfs.io; "
            "frame-ancestors 'none';"
        )
        return response

app.add_middleware(SecurityHeadersMiddleware)

limiter = Limiter(key_func=get_ipaddr)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

# CORS configuration
# Можно задать через переменную окружения CORS_ORIGINS (через запятую)
# Или использовать дефолтные значения
cors_origins_env = os.getenv("CORS_ORIGINS", "").strip()
if cors_origins_env:
    # Разбираем список origins из переменной окружения
    allow_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
else:
    # Дефолтные origins
    allow_origins = [
        "https://tokenstart.pro",
        "https://www.tokenstart.pro",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

setup_exception_handlers(app)

setup_routes(limiter)

app.include_router(router)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "soltoken-frontend")
if os.path.isdir(FRONTEND_DIR):
    from fastapi.responses import FileResponse
    from fastapi import HTTPException

    # Named pages — each resolves to its own HTML file
    _PAGE_MAP = {
        "":        "index.html",
        "app":     "app.html",
        "terms":   "terms.html",
        "privacy": "privacy.html",
    }

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Strip trailing slash and look up in page map first
        key = full_path.rstrip("/")
        if key in _PAGE_MAP:
            html_file = os.path.join(FRONTEND_DIR, _PAGE_MAP[key])
            if os.path.isfile(html_file):
                return FileResponse(html_file)

        # Serve any other static asset (css, js, img, fonts, …)
        asset_path = os.path.join(FRONTEND_DIR, full_path)
        if os.path.isfile(asset_path):
            return FileResponse(asset_path)

        raise HTTPException(status_code=404)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)