import asyncio
import httpx
from fastapi import APIRouter, HTTPException
from database import get_db
from config import TON_API_BASE, TON_API_KEY
from services.conversion import (
    compute_base_ratio,
    classify_deposit,
    calculate_allocation,
    calculate_late_claim_allocation,
    estimate_agent_supply,
    calculate_all_distributions,
)
from services.lp_estimator import estimate_extraction
from services.groypad_curve import estimate_dev_buy
from services.ton_api import get_jetton_info, estimate_circulating_supply, get_pool_reserves, get_phx_balance
from config import FULL_DEV_BUY_TON, NEW_TOKEN_SUPPLY, THRESHOLD_PERCENT

router = APIRouter(prefix="/api/calculator", tags=["calculator"])


@router.get("/preview/{token_address}")
async def preview_migration(token_address: str):
    """Preview what a migration would look like for a given token before proposing."""
    info = await get_jetton_info(token_address)
    if not info:
        raise HTTPException(400, "Could not fetch jetton info")

    # Reject tokens already deployed from Groypad
    description = (info.get("description") or "").lower()
    if "deployed from groypad" in description:
        raise HTTPException(
            400,
            "This token was deployed from Groypad and is not eligible for migration.",
        )

    decimals = info["decimals"]
    total_supply = info["total_supply"] / (10 ** decimals)
    base_ratio = compute_base_ratio(total_supply)

    # Run circulating supply and pool reserves in parallel
    circ_data, pool_data = await asyncio.gather(
        estimate_circulating_supply(token_address, info=info),
        get_pool_reserves(token_address),
    )
    circulating = circ_data.get("circulating_supply", total_supply * 0.7)
    threshold_amount = circulating * THRESHOLD_PERCENT

    lp_est = await estimate_extraction(
        token_address, circulating, threshold_amount, pool_data=pool_data
    )

    extracted_ton = lp_est["estimated_extraction_ton"]
    agent_supply = estimate_agent_supply(extracted_ton)
    dev_buy = estimate_dev_buy(extracted_ton)

    return {
        "token": {
            "name": info["name"],
            "symbol": info["symbol"],
            "total_supply": total_supply,
            "holders": info["holders_count"],
            "image": info.get("image"),
        },
        "circulating_supply": circulating,
        "circulating_percent": circ_data.get("circulating_percent", 70),
        "excluded_addresses": circ_data.get("excluded_addresses", []),
        "threshold_amount": threshold_amount,
        "base_ratio": base_ratio,
        "lp_estimation": lp_est,
        "agent_supply": agent_supply,
        "dev_buy_estimate": dev_buy,
        "new_token_supply": NEW_TOKEN_SUPPLY,
        "examples": {
            "tier1_holder_1000": 1000 * base_ratio * 1.0,
            "tier1plus_holder_1000": 1000 * base_ratio * 0.75,
            "tier2_holder_1000": 1000 * base_ratio * 0.75,
            "tier3_late_1000": 1000 * base_ratio * 0.5,
        },
    }


@router.get("/allocation/{migration_id}/{wallet_address}")
async def calculate_wallet_allocation(migration_id: str, wallet_address: str):
    """Calculate exact allocation for a wallet in a specific migration."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM migrations WHERE id = ?", (migration_id,))
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")

        snap_cursor = await db.execute(
            "SELECT balance FROM snapshots WHERE migration_id = ? AND wallet_address = ?",
            (migration_id, wallet_address),
        )
        snap = await snap_cursor.fetchone()
        snapshot_balance = snap["balance"] if snap else 0

        dep_cursor = await db.execute(
            """SELECT COALESCE(SUM(amount), 0) as total,
                      COALESCE(SUM(tier1_amount), 0) as t1,
                      COALESCE(SUM(tier1plus_amount), 0) as t1p,
                      COALESCE(SUM(tier2_amount), 0) as t2
            FROM deposits WHERE migration_id = ? AND wallet_address = ?""",
            (migration_id, wallet_address),
        )
        dep = await dep_cursor.fetchone()

        topup_cursor = await db.execute(
            "SELECT COALESCE(SUM(ton_amount), 0) as total FROM topups WHERE migration_id = ? AND wallet_address = ?",
            (migration_id, wallet_address),
        )
        topup = await topup_cursor.fetchone()
        has_topup = topup["total"] > 0

        base_ratio = migration["base_ratio"]
        phx_bal = await get_phx_balance(wallet_address)
        alloc = calculate_allocation(dep["t1"], dep["t1p"], dep["t2"], base_ratio, has_topup, phx_balance=phx_bal)

        return {
            "wallet_address": wallet_address,
            "snapshot_balance": snapshot_balance,
            "is_og": snapshot_balance > 0,
            "deposited": dep["total"],
            "tier1_amount": dep["t1"],
            "tier1plus_amount": dep["t1p"],
            "tier2_amount": dep["t2"],
            "topup_ton": topup["total"],
            "has_topup": has_topup,
            "base_ratio": base_ratio,
            **alloc,
        }
    finally:
        await db.close()


@router.get("/distributions/{migration_id}")
async def preview_distributions(migration_id: str):
    """Preview all distributions for a migration (before executing)."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM migrations WHERE id = ?", (migration_id,))
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")

        agent_supply = migration["agent_supply"]
        if not agent_supply:
            agent_supply = estimate_agent_supply(
                migration["extracted_ton"] or migration["lp_estimation_ton"] or 0
            )

        result = await calculate_all_distributions(
            db, migration_id, migration["base_ratio"], agent_supply
        )

        return {
            "migration_id": migration_id,
            "base_ratio": migration["base_ratio"],
            "agent_supply": agent_supply,
            **result,
        }
    finally:
        await db.close()


@router.get("/jetton-wallet/{jetton_master}/{owner_wallet}")
async def get_jetton_wallet_address(jetton_master: str, owner_wallet: str):
    """Return the jetton wallet address for a given owner — needed to send jetton transfers."""
    headers = {"Accept": "application/json"}
    if TON_API_KEY:
        headers["Authorization"] = f"Bearer {TON_API_KEY}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{TON_API_BASE}/jettons/{jetton_master}/wallets",
            params={"owner_address": owner_wallet, "limit": 1},
            headers=headers,
        )
    if resp.status_code != 200:
        raise HTTPException(400, "Could not fetch jetton wallet address")
    data = resp.json()
    wallets = data.get("addresses", [])
    if not wallets:
        raise HTTPException(404, "No jetton wallet found for this owner")
    return {"jetton_wallet_address": wallets[0].get("address", "")}
