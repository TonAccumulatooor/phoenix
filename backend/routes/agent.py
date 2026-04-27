"""
Phoenix Agent Coordination Endpoints
=====================================
These routes are called by Phoenix Agent to record pipeline results:
  - Extracted TON after DEX sale
  - New token address after Groypad deploy
  - Distribution execution
  - Creator reward wallet assignment
  - Mark distributions as completed
  - Build + host TEP-64 metadata JSON
"""

import json
import uuid
from pathlib import Path
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Header, Depends

from database import get_db
from models import MigrationStatus
from config import AGENT_WALLET_ADDRESS, AGENT_API_KEY, is_valid_ton_address, GROYPER_AIRDROP_PER_NFT
from services.conversion import calculate_all_distributions
from services.nft import snapshot_groyper_nft_holders

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

router = APIRouter(
    prefix="/api/migrations",
    tags=["agent"],
    dependencies=[Depends(verify_agent_key)],
)


async def verify_agent_key(x_agent_key: str = Header(...)):
    """Require a valid agent API key on all agent endpoints."""
    if not AGENT_API_KEY:
        raise HTTPException(503, "Agent API key not configured on server")
    if x_agent_key != AGENT_API_KEY:
        raise HTTPException(403, "Invalid agent API key")
    return x_agent_key


# --- Request models ---

class RecordExtractionRequest(BaseModel):
    extracted_ton: float = Field(gt=0, description="Actual TON received from DEX sale")
    dev_buy_ton: float = Field(ge=0, description="TON allocated for Groypad dev buy")


class RecordDeployRequest(BaseModel):
    new_token_address: str = Field(description="Deployed Groypad meme token address")
    agent_supply: float = Field(gt=0, description="Actual tokens acquired from bonding curve")
    dev_buy_ton: Optional[float] = Field(default=None, description="Override dev_buy_ton if not set")


# --- #1: Record extracted TON ---

@router.post("/{migration_id}/extracted-ton")
async def record_extracted_ton(migration_id: str, req: RecordExtractionRequest):
    """Record actual TON extracted from selling deposited tokens on DEX."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT status FROM migrations WHERE id = ?", (migration_id,)
        )
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")
        if migration["status"] not in (
            MigrationStatus.QUALIFIED.value,
            MigrationStatus.SELLING.value,
        ):
            raise HTTPException(400, f"Cannot record extraction in status '{migration['status']}'. Must be 'qualified' or 'selling'.")

        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            """UPDATE migrations
               SET extracted_ton = ?, dev_buy_ton = ?, status = ?, updated_at = ?
               WHERE id = ?""",
            (req.extracted_ton, req.dev_buy_ton, MigrationStatus.LAUNCHING.value, now, migration_id),
        )
        await db.commit()

        return {
            "migration_id": migration_id,
            "extracted_ton": req.extracted_ton,
            "dev_buy_ton": req.dev_buy_ton,
            "status": MigrationStatus.LAUNCHING.value,
        }
    finally:
        await db.close()


# --- #2: Record new token address after Groypad deploy ---

@router.post("/{migration_id}/deployed-token")
async def record_deployed_token(migration_id: str, req: RecordDeployRequest):
    """Record the new token address and agent supply after Groypad deployment."""
    if not is_valid_ton_address(req.new_token_address):
        raise HTTPException(400, f"Invalid TON address format: {req.new_token_address}")

    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT status, dev_buy_ton FROM migrations WHERE id = ?", (migration_id,)
        )
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")
        if migration["status"] not in (
            MigrationStatus.LAUNCHING.value,
            MigrationStatus.SELLING.value,
        ):
            raise HTTPException(400, f"Cannot record deployment in status '{migration['status']}'. Must be 'launching' or 'selling'.")

        now = datetime.now(timezone.utc).isoformat()
        dev_buy = req.dev_buy_ton if req.dev_buy_ton is not None else migration["dev_buy_ton"]
        await db.execute(
            """UPDATE migrations
               SET new_token_address = ?, agent_supply = ?, dev_buy_ton = ?,
                   status = ?, updated_at = ?
               WHERE id = ?""",
            (
                req.new_token_address, req.agent_supply, dev_buy,
                MigrationStatus.DISTRIBUTING.value, now, migration_id,
            ),
        )
        await db.commit()

        return {
            "migration_id": migration_id,
            "new_token_address": req.new_token_address,
            "agent_supply": req.agent_supply,
            "status": MigrationStatus.DISTRIBUTING.value,
        }
    finally:
        await db.close()


# --- #3: Execute distributions ---

@router.post("/{migration_id}/execute-distributions")
async def execute_distributions(migration_id: str):
    """
    Calculate and persist distribution records for all depositors.
    Requires agent_supply to be set (from record_deployed_token).
    """
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM migrations WHERE id = ?", (migration_id,))
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")
        if migration["status"] != MigrationStatus.DISTRIBUTING.value:
            raise HTTPException(400, f"Cannot execute distributions in status '{migration['status']}'. Must be 'distributing'.")

        agent_supply = migration["agent_supply"]
        if not agent_supply or agent_supply <= 0:
            raise HTTPException(
                400,
                "agent_supply is not set or is zero. Record the deployed token first via POST /deployed-token.",
            )

        base_ratio = migration["base_ratio"]
        if not base_ratio or base_ratio <= 0:
            raise HTTPException(400, "base_ratio is invalid for this migration.")

        # Check for existing distributions (idempotency)
        existing = await db.execute(
            "SELECT COUNT(*) as cnt FROM distributions WHERE migration_id = ?",
            (migration_id,),
        )
        if (await existing.fetchone())["cnt"] > 0:
            raise HTTPException(409, "Distributions already executed for this migration. Use GET to retrieve them.")

        result = await calculate_all_distributions(db, migration_id, base_ratio, agent_supply)

        now = datetime.now(timezone.utc).isoformat()
        created_count = 0
        for alloc in result["allocations"]:
            # Determine primary tier for the record
            if alloc.get("newmeme_from_tier1", 0) > 0:
                tier = "tier1"
            elif alloc.get("newmeme_from_tier1plus", 0) > 0:
                tier = "tier1plus"
            else:
                tier = "tier2"

            await db.execute(
                """INSERT INTO distributions
                   (migration_id, wallet_address, tier, deposit_amount,
                    newmeme_base, newmeme_topup_bonus, newmeme_total,
                    phoenix_airdrop, pro_rata_scale, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    migration_id,
                    alloc["wallet_address"],
                    tier,
                    alloc["deposit_amount"],
                    alloc["newmeme_subtotal"],
                    alloc.get("topup_bonus", 0),
                    alloc["newmeme_final"],
                    0,  # phoenix_airdrop — set later
                    alloc["pro_rata_scale"],
                    "pending",
                ),
            )
            created_count += 1

        # Set creator_reward_wallet to agent wallet by default (#4)
        await db.execute(
            "UPDATE migrations SET creator_reward_wallet = ?, updated_at = ? WHERE id = ?",
            (AGENT_WALLET_ADDRESS, now, migration_id),
        )
        await db.commit()

        return {
            "migration_id": migration_id,
            "distributions_created": created_count,
            "agent_supply": agent_supply,
            "distributable": result["distributable"],
            "total_demand": result["total_demand"],
            "pro_rata_scale": result["pro_rata_scale"],
            "late_claim_reserve": result["late_claim_reserve"],
            "lp_seed_reserve": result["lp_seed_reserve"],
            "nft_airdrop_reserve": result["nft_airdrop_reserve"],
            "treasury_reserve": result["treasury_reserve"],
            "creator_reward_wallet": AGENT_WALLET_ADDRESS,
        }
    finally:
        await db.close()


# --- #4: Set creator reward wallet (override default) ---

class SetCreatorRewardRequest(BaseModel):
    wallet: str = Field(description="TON wallet address for creator fees")


@router.post("/{migration_id}/creator-reward")
async def set_creator_reward(migration_id: str, req: SetCreatorRewardRequest):
    """Set the creator reward wallet for a migration (defaults to agent wallet)."""
    if not is_valid_ton_address(req.wallet):
        raise HTTPException(400, f"Invalid TON address format: {req.wallet}")

    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id FROM migrations WHERE id = ?", (migration_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(404, "Migration not found")

        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE migrations SET creator_reward_wallet = ?, updated_at = ? WHERE id = ?",
            (req.wallet, now, migration_id),
        )
        await db.commit()
        return {"migration_id": migration_id, "creator_reward_wallet": req.wallet}
    finally:
        await db.close()


# --- #9: Get executed distributions ---

@router.get("/{migration_id}/distributions-executed")
async def get_executed_distributions(migration_id: str):
    """Retrieve all executed distribution records for a migration."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id FROM migrations WHERE id = ?", (migration_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(404, "Migration not found")

        dist_cursor = await db.execute(
            """SELECT wallet_address, tier, deposit_amount, newmeme_base,
                      newmeme_topup_bonus, newmeme_total, phoenix_airdrop,
                      pro_rata_scale, tx_hash, distributed_at, status
               FROM distributions
               WHERE migration_id = ?
               ORDER BY newmeme_total DESC""",
            (migration_id,),
        )
        rows = await dist_cursor.fetchall()

        distributions = [
            {
                "wallet_address": r["wallet_address"],
                "tier": r["tier"],
                "deposit_amount": r["deposit_amount"],
                "newmeme_base": r["newmeme_base"],
                "newmeme_topup_bonus": r["newmeme_topup_bonus"],
                "newmeme_total": r["newmeme_total"],
                "phoenix_airdrop": r["phoenix_airdrop"],
                "pro_rata_scale": r["pro_rata_scale"],
                "tx_hash": r["tx_hash"],
                "distributed_at": r["distributed_at"],
                "status": r["status"],
            }
            for r in rows
        ]

        pending = sum(1 for d in distributions if d["status"] == "pending")
        completed = sum(1 for d in distributions if d["status"] == "completed")

        return {
            "migration_id": migration_id,
            "total_distributions": len(distributions),
            "pending": pending,
            "completed": completed,
            "distributions": distributions,
        }
    finally:
        await db.close()


# --- Mark distributions as completed ---

class MarkDistributionRequest(BaseModel):
    wallet_address: str
    tx_hash: str


class MarkDistributionBatchRequest(BaseModel):
    distributions: List[MarkDistributionRequest]


@router.post("/{migration_id}/distributions-mark-sent")
async def mark_distributions_sent(migration_id: str, req: MarkDistributionBatchRequest):
    """Mark distributions as completed with their on-chain tx_hash."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id FROM migrations WHERE id = ?", (migration_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(404, "Migration not found")

        now = datetime.now(timezone.utc).isoformat()
        updated = 0
        not_found = []

        for d in req.distributions:
            result = await db.execute(
                """UPDATE distributions
                   SET status = 'completed', tx_hash = ?, distributed_at = ?
                   WHERE migration_id = ? AND wallet_address = ? AND status = 'pending'""",
                (d.tx_hash, now, migration_id, d.wallet_address),
            )
            if result.rowcount > 0:
                updated += 1
            else:
                not_found.append(d.wallet_address)

        await db.commit()

        # Check if all distributions are completed — if so, transition to late_claims
        pending_cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM distributions WHERE migration_id = ? AND status = 'pending'",
            (migration_id,),
        )
        remaining = (await pending_cursor.fetchone())["cnt"]

        if remaining == 0 and updated > 0:
            from config import LATE_CLAIM_WINDOW_DAYS
            from datetime import timedelta
            late_deadline = datetime.now(timezone.utc) + timedelta(days=LATE_CLAIM_WINDOW_DAYS)
            await db.execute(
                "UPDATE migrations SET status = ?, late_claim_deadline = ?, updated_at = ? WHERE id = ?",
                (MigrationStatus.LATE_CLAIMS.value, late_deadline.isoformat(), now, migration_id),
            )
            await db.commit()

        return {
            "migration_id": migration_id,
            "marked_completed": updated,
            "not_found_or_already_completed": not_found,
            "remaining_pending": remaining,
            "all_distributed": remaining == 0,
        }
    finally:
        await db.close()


# --- Build + host TEP-64 metadata JSON ---

class BuildMetadataRequest(BaseModel):
    name: str
    symbol: str
    description: Optional[str] = ""
    image: Optional[str] = ""
    decimals: Optional[int] = 9
    socials: Optional[dict] = None


@router.post("/{migration_id}/build-metadata")
async def build_metadata(migration_id: str, req: Optional[BuildMetadataRequest] = None):
    """
    Build a TEP-64 metadata JSON file from the migration's stored metadata
    (or from the request body as override). Saves to /uploads/ and returns
    the URL that Phoenix Agent passes to the Groypad deploy tool.
    """
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM migrations WHERE id = ?", (migration_id,)
        )
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")

        # Use request body if provided, otherwise fall back to stored metadata
        if req:
            name = req.name
            symbol = req.symbol
            description = req.description or ""
            image = req.image or ""
            decimals = req.decimals or 9
            socials = req.socials
        else:
            name = migration["new_token_name"] or migration["old_token_name"] or "Unknown"
            symbol = migration["new_token_symbol"] or migration["old_token_symbol"] or "???"
            description = migration["new_token_description"] or ""
            image = migration["new_token_image"] or ""
            decimals = 9
            socials = json.loads(migration["new_token_socials"]) if migration["new_token_socials"] else None

        metadata = {
            "name": name,
            "symbol": symbol,
            "description": description,
            "decimals": str(decimals),
            "image": image,
        }

        # Add social links if provided
        if socials:
            links = []
            if socials.get("telegram"):
                links.append(socials["telegram"])
            if socials.get("twitter"):
                links.append(socials["twitter"])
            if socials.get("website"):
                links.append(socials["website"])
            if links:
                metadata["social_links"] = links

        # Write to uploads directory
        filename = f"metadata_{migration_id}_{uuid.uuid4().hex[:8]}.json"
        filepath = UPLOAD_DIR / filename
        filepath.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        metadata_url = f"/api/uploads/{filename}"

        return {
            "migration_id": migration_id,
            "metadata_url": metadata_url,
            "metadata": metadata,
            "filename": filename,
        }
    finally:
        await db.close()


# --- NFT Airdrop: Snapshot + Execute ---

@router.post("/{migration_id}/nft-airdrop-snapshot")
async def take_nft_airdrop_snapshot(migration_id: str):
    """
    Snapshot current Groyper NFT holders and persist airdrop records.
    Called by Phoenix Agent after successful NEWTOKEN launch.
    Each NFT earns its holder 18,450 NEWTOKEN (5M / 271 NFTs).
    """
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, status FROM migrations WHERE id = ?", (migration_id,)
        )
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")

        # Check for existing snapshot (idempotency)
        existing = await db.execute(
            "SELECT COUNT(*) as cnt FROM nft_airdrops WHERE migration_id = ?",
            (migration_id,),
        )
        if (await existing.fetchone())["cnt"] > 0:
            raise HTTPException(409, "NFT airdrop snapshot already taken for this migration.")

        # Snapshot NFT holders from TonAPI
        holders = await snapshot_groyper_nft_holders()
        if not holders:
            raise HTTPException(400, "Could not fetch NFT holders or collection is empty.")

        now = datetime.now(timezone.utc).isoformat()
        created = 0
        total_airdrop = 0

        for h in holders:
            airdrop_amount = h["nft_count"] * GROYPER_AIRDROP_PER_NFT
            await db.execute(
                """INSERT INTO nft_airdrops
                   (migration_id, wallet_address, nft_count, airdrop_amount, status)
                   VALUES (?, ?, ?, ?, ?)""",
                (migration_id, h["wallet_address"], h["nft_count"], airdrop_amount, "pending"),
            )
            created += 1
            total_airdrop += airdrop_amount

        await db.commit()

        return {
            "migration_id": migration_id,
            "nft_holders": created,
            "total_nfts": sum(h["nft_count"] for h in holders),
            "total_airdrop_tokens": total_airdrop,
            "per_nft_amount": GROYPER_AIRDROP_PER_NFT,
        }
    finally:
        await db.close()


@router.get("/{migration_id}/nft-airdrops")
async def get_nft_airdrops(migration_id: str):
    """Get all NFT airdrop records for a migration."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT wallet_address, nft_count, airdrop_amount, tx_hash, distributed_at, status "
            "FROM nft_airdrops WHERE migration_id = ? ORDER BY airdrop_amount DESC",
            (migration_id,),
        )
        rows = await cursor.fetchall()

        airdrops = [
            {
                "wallet_address": r["wallet_address"],
                "nft_count": r["nft_count"],
                "airdrop_amount": r["airdrop_amount"],
                "tx_hash": r["tx_hash"],
                "distributed_at": r["distributed_at"],
                "status": r["status"],
            }
            for r in rows
        ]

        pending = sum(1 for a in airdrops if a["status"] == "pending")
        completed = sum(1 for a in airdrops if a["status"] == "completed")

        return {
            "migration_id": migration_id,
            "total_holders": len(airdrops),
            "pending": pending,
            "completed": completed,
            "airdrops": airdrops,
        }
    finally:
        await db.close()


class MarkAirdropRequest(BaseModel):
    wallet_address: str
    tx_hash: str


class MarkAirdropBatchRequest(BaseModel):
    airdrops: List[MarkAirdropRequest]


@router.post("/{migration_id}/nft-airdrops-mark-sent")
async def mark_nft_airdrops_sent(migration_id: str, req: MarkAirdropBatchRequest):
    """Mark NFT airdrops as completed with their on-chain tx_hash."""
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        updated = 0

        for a in req.airdrops:
            result = await db.execute(
                """UPDATE nft_airdrops
                   SET status = 'completed', tx_hash = ?, distributed_at = ?
                   WHERE migration_id = ? AND wallet_address = ? AND status = 'pending'""",
                (a.tx_hash, now, migration_id, a.wallet_address),
            )
            if result.rowcount > 0:
                updated += 1

        await db.commit()
        return {"migration_id": migration_id, "marked_completed": updated}
    finally:
        await db.close()
