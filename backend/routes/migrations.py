import json
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from database import get_db
from models import ProposeRequest, MigrationStatus
from services.ton_api import get_jetton_info
from services.snapshot import take_snapshot
from services.lp_estimator import estimate_extraction
from services.conversion import compute_base_ratio
from config import DEPOSIT_WINDOW_DAYS, LATE_CLAIM_WINDOW_DAYS, THRESHOLD_PERCENT, is_valid_ton_address
from services.nft import check_groyper_nft_holder

router = APIRouter(prefix="/api/migrations", tags=["migrations"])


@router.get("/check-nft/{wallet_address}")
async def check_nft_ownership(wallet_address: str):
    """Check if a wallet holds a Groyper NFT (fee waiver eligibility)."""
    result = await check_groyper_nft_holder(wallet_address)
    return {
        "wallet_address": wallet_address,
        "holds_groyper_nft": result["holds_nft"],
        "nft_count": result["nft_count"],
        "fee_waived": result["holds_nft"],
    }


@router.post("/propose")
async def propose_migration(req: ProposeRequest):
    # Validate NFT fee waiver if claimed
    if req.proposal_fee_type == "NFT_WAIVER":
        nft_check = await check_groyper_nft_holder(req.proposer_wallet)
        if not nft_check["holds_nft"]:
            raise HTTPException(
                400,
                "Wallet does not hold a Groyper NFT. Fee waiver not eligible.",
            )

    info = await get_jetton_info(req.old_token_address)
    if not info:
        raise HTTPException(400, "Could not fetch jetton info. Check the address.")

    # Reject tokens already deployed from Groypad
    description = (info.get("description") or "").lower()
    if "deployed from groypad" in description:
        raise HTTPException(
            400,
            "This token was deployed from Groypad and is not eligible for migration.",
        )

    migration_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc)
    deposit_deadline = now + timedelta(days=DEPOSIT_WINDOW_DAYS)

    db = await get_db()
    try:
        snapshot_result = await take_snapshot(db, migration_id, req.old_token_address)
        circulating = snapshot_result["circulating_supply"]
        threshold = circulating * THRESHOLD_PERCENT
        base_ratio = compute_base_ratio(info["total_supply"] / (10 ** info["decimals"]))

        lp_est = await estimate_extraction(
            req.old_token_address,
            circulating,
            circulating * THRESHOLD_PERCENT,
        )

        socials_json = json.dumps(req.socials.model_dump(exclude_none=True)) if req.socials else None

        # Validate creator fee wallet if provided
        creator_fee_wallet = None
        if req.creator_fee_wallet:
            if not is_valid_ton_address(req.creator_fee_wallet):
                raise HTTPException(400, f"Invalid creator fee wallet address: {req.creator_fee_wallet}")
            creator_fee_wallet = req.creator_fee_wallet

        await db.execute(
            """INSERT INTO migrations
            (id, old_token_address, old_token_name, old_token_symbol, old_token_decimals,
             old_token_total_supply, new_token_name, new_token_symbol, new_token_description,
             new_token_image, new_token_socials, creator_fee_wallet,
             status, proposer_wallet, proposal_fee_tx, proposal_fee_type,
             snapshot_time, deposit_deadline, circulating_supply, threshold_amount, base_ratio,
             lp_estimation_ton, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                migration_id,
                req.old_token_address,
                info["name"],
                info["symbol"],
                info["decimals"],
                info["total_supply"],
                req.new_token_name or info["name"],
                req.new_token_symbol or info["symbol"],
                req.new_token_description,
                req.new_token_image,
                socials_json,
                creator_fee_wallet,
                MigrationStatus.DEPOSITING.value,
                req.proposer_wallet,
                req.proposal_fee_tx,
                req.proposal_fee_type,
                now.isoformat(),
                deposit_deadline.isoformat(),
                circulating,
                threshold,
                base_ratio,
                lp_est["estimated_extraction_ton"],
                now.isoformat(),
                now.isoformat(),
            ),
        )
        await db.commit()

        return {
            "migration_id": migration_id,
            "old_token": {
                "name": info["name"],
                "symbol": info["symbol"],
                "total_supply": info["total_supply"],
            },
            "circulating_supply": circulating,
            "threshold_amount": threshold,
            "base_ratio": base_ratio,
            "deposit_deadline": deposit_deadline.isoformat(),
            "holder_count": snapshot_result["holder_count"],
            "lp_estimation": lp_est,
        }
    finally:
        await db.close()


@router.get("/{migration_id}")
async def get_migration(migration_id: str):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM migrations WHERE id = ?", (migration_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Migration not found")

        total_deposited = row["total_deposited"] or 0
        threshold = row["threshold_amount"] or 1
        progress = min((total_deposited / threshold) * 100, 100) if threshold > 0 else 0

        holder_cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM snapshots WHERE migration_id = ?", (migration_id,)
        )
        holder_count = (await holder_cursor.fetchone())["cnt"]

        depositor_cursor = await db.execute(
            "SELECT COUNT(DISTINCT wallet_address) as cnt FROM deposits WHERE migration_id = ?",
            (migration_id,),
        )
        depositor_count = (await depositor_cursor.fetchone())["cnt"]

        return {
            "id": row["id"],
            "old_token": {
                "address": row["old_token_address"],
                "name": row["old_token_name"],
                "symbol": row["old_token_symbol"],
                "total_supply": row["old_token_total_supply"],
            },
            "new_token": {
                "address": row["new_token_address"],
                "name": row["new_token_name"],
                "symbol": row["new_token_symbol"],
                "description": row["new_token_description"],
                "image": row["new_token_image"],
                "socials": json.loads(row["new_token_socials"]) if row["new_token_socials"] else None,
            },
            "status": row["status"],
            "proposer_wallet": row["proposer_wallet"],
            "circulating_supply": row["circulating_supply"],
            "threshold_amount": row["threshold_amount"],
            "total_deposited": total_deposited,
            "total_topup_ton": row["total_topup_ton"],
            "progress_percent": round(progress, 2),
            "base_ratio": row["base_ratio"],
            "deposit_deadline": row["deposit_deadline"],
            "late_claim_deadline": row["late_claim_deadline"],
            "lp_estimation_ton": row["lp_estimation_ton"],
            "extracted_ton": row["extracted_ton"],
            "dev_buy_ton": row["dev_buy_ton"],
            "agent_supply": row["agent_supply"],
            "creator_reward_wallet": row["creator_reward_wallet"],
            "creator_fee_wallet": row["creator_fee_wallet"],
            "holder_count": holder_count,
            "depositor_count": depositor_count,
            "created_at": row["created_at"],
        }
    finally:
        await db.close()


@router.get("/")
async def list_migrations(status: str = None, limit: int = 50, offset: int = 0):
    db = await get_db()
    try:
        if status:
            cursor = await db.execute(
                "SELECT * FROM migrations WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (status, limit, offset),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM migrations ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        rows = await cursor.fetchall()

        migrations = []
        for row in rows:
            total = row["total_deposited"] or 0
            threshold = row["threshold_amount"] or 1
            progress = min((total / threshold) * 100, 100) if threshold > 0 else 0
            migrations.append({
                "id": row["id"],
                "old_token_symbol": row["old_token_symbol"],
                "old_token_name": row["old_token_name"],
                "status": row["status"],
                "progress_percent": round(progress, 2),
                "total_deposited": total,
                "threshold_amount": row["threshold_amount"],
                "deposit_deadline": row["deposit_deadline"],
                "lp_estimation_ton": row["lp_estimation_ton"],
                "created_at": row["created_at"],
            })

        count_cursor = await db.execute("SELECT COUNT(*) as cnt FROM migrations")
        total_count = (await count_cursor.fetchone())["cnt"]

        return {"migrations": migrations, "total": total_count}
    finally:
        await db.close()


@router.post("/{migration_id}/status")
async def update_migration_status(migration_id: str, new_status: str):
    valid = [s.value for s in MigrationStatus]
    if new_status not in valid:
        raise HTTPException(400, f"Invalid status. Must be one of: {valid}")

    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()

        if new_status == MigrationStatus.LATE_CLAIMS.value:
            late_deadline = datetime.now(timezone.utc) + timedelta(days=LATE_CLAIM_WINDOW_DAYS)
            await db.execute(
                "UPDATE migrations SET status = ?, late_claim_deadline = ?, updated_at = ? WHERE id = ?",
                (new_status, late_deadline.isoformat(), now, migration_id),
            )
        else:
            await db.execute(
                "UPDATE migrations SET status = ?, updated_at = ? WHERE id = ?",
                (new_status, now, migration_id),
            )
        await db.commit()
        return {"status": new_status}
    finally:
        await db.close()
