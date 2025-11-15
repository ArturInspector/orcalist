# main.py - point of enter
import os

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",
        "https://tokenstart.app",
        "https://www.tokenstart.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
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
