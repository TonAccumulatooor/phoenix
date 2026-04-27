import sys
import asyncio
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from pathlib import Path as _Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from database import init_db
from config import CORS_ORIGINS
from routes.migrations import router as migrations_router
from routes.deposits import router as deposits_router
from routes.calculator import router as calculator_router
from routes.votes import router as votes_router
from routes.uploads import router as uploads_router
from routes.agent import router as agent_router
from services.vault_monitor import run_vault_monitor

_UPLOAD_DIR = _Path(__file__).parent / "uploads"
_UPLOAD_DIR.mkdir(exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    monitor_task = asyncio.create_task(run_vault_monitor())
    yield
    monitor_task.cancel()
    try:
        await monitor_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Phoenix",
    description="Token Rebirth Platform for TON",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(migrations_router)
app.include_router(deposits_router)
app.include_router(calculator_router)
app.include_router(votes_router)
app.include_router(uploads_router)
app.include_router(agent_router)
app.mount("/api/uploads", StaticFiles(directory=str(_UPLOAD_DIR)), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "alive", "name": "Phoenix", "tagline": "Rise from the ashes"}


@app.get("/api/stats")
async def platform_stats():
    from database import get_db
    db = await get_db()
    try:
        total = await db.execute("SELECT COUNT(*) as cnt FROM migrations")
        total_count = (await total.fetchone())["cnt"]

        active = await db.execute(
            "SELECT COUNT(*) as cnt FROM migrations WHERE status NOT IN ('closed', 'failed')"
        )
        active_count = (await active.fetchone())["cnt"]

        successful = await db.execute(
            "SELECT COUNT(*) as cnt FROM migrations WHERE status = 'closed'"
        )
        success_count = (await successful.fetchone())["cnt"]

        total_deposited = await db.execute(
            "SELECT COALESCE(SUM(total_deposited), 0) as total FROM migrations"
        )
        deposited = (await total_deposited.fetchone())["total"]

        # Unique wallets that have deposited across all migrations
        wallets = await db.execute(
            "SELECT COUNT(DISTINCT wallet_address) as cnt FROM deposits"
        )
        wallets_served = (await wallets.fetchone())["cnt"]

        # Total TON extracted across all completed migrations
        ton_extracted = await db.execute(
            "SELECT COALESCE(SUM(extracted_ton), 0) as total FROM migrations WHERE extracted_ton IS NOT NULL"
        )
        total_ton_extracted = (await ton_extracted.fetchone())["total"]

        return {
            "total_migrations": total_count,
            "active_migrations": active_count,
            "successful_migrations": success_count,
            "total_tokens_deposited": deposited,
            "wallets_served": wallets_served,
            "total_ton_extracted": total_ton_extracted,
        }
    finally:
        await db.close()
