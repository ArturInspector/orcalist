# main.py - point of enter
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from slowapi import Limiter
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_ipaddr

from api.handlers import setup_exception_handlers
from api.routes import router, setup_routes

app = FastAPI()

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
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)