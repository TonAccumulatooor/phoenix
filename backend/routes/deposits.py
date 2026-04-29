import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import get_db
from models import DepositRecord, TopupRecord, LateClaimRecord, MigrationStatus
from config import VAULT_WALLET_ADDRESS
from services.vault import process_deposit, process_topup, check_threshold, get_deposit_summary
from services.conversion import (
    calculate_allocation,
    calculate_late_claim_allocation,
    compute_base_ratio,
)
from services.snapshot import get_snapshot_balance
from services.ton_api import verify_jetton_transfer, get_phx_balance
from config import normalize_address

logger = logging.getLogger("deposits")

router = APIRouter(prefix="/api/deposits", tags=["deposits"])


@router.post("/")
async def submit_deposit(record: DepositRecord):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT status, deposit_deadline FROM migrations WHERE id = ?",
            (record.migration_id,),
        )
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")
        if migration["status"] != MigrationStatus.DEPOSITING.value:
            raise HTTPException(400, "Migration is not accepting deposits")

        deadline = datetime.fromisoformat(migration["deposit_deadline"])
        if datetime.now(timezone.utc) > deadline:
            raise HTTPException(400, "Deposit window has closed")

        # Check for duplicate tx_hash
        if record.tx_hash and record.tx_hash != "pending_verification":
            dup_cursor = await db.execute(
                "SELECT id FROM deposits WHERE migration_id = ? AND tx_hash = ?",
                (record.migration_id, record.tx_hash),
            )
            if await dup_cursor.fetchone():
                raise HTTPException(409, "This transaction has already been recorded")

        # Verify TX on-chain if tx_hash provided and vault address configured
        tx_verified = None
        if record.tx_hash and record.tx_hash != "pending_verification" and VAULT_WALLET_ADDRESS:
            # Look up the old token address for this migration
            mig_cursor = await db.execute(
                "SELECT old_token_address, old_token_decimals FROM migrations WHERE id = ?",
                (record.migration_id,),
            )
            mig_row = await mig_cursor.fetchone()
            if mig_row:
                verification = await verify_jetton_transfer(
                    event_id=record.tx_hash,
                    expected_recipient=VAULT_WALLET_ADDRESS,
                    expected_jetton=mig_row["old_token_address"],
                    expected_min_amount=record.amount,
                    expected_decimals=mig_row["old_token_decimals"] or 9,
                )
                tx_verified = verification["verified"]
                if not tx_verified:
                    logger.warning(
                        f"TX verification failed for deposit {record.tx_hash}: {verification['reason']}"
                    )
                    raise HTTPException(
                        400,
                        f"Transaction verification failed: {verification['reason']}",
                    )

        result = await process_deposit(
            db, record.migration_id, record.wallet_address, record.amount, record.tx_hash
        )

        threshold = await check_threshold(db, record.migration_id)

        return {
            "deposit": result,
            "threshold_status": threshold,
            "tx_verified": tx_verified,
        }
    finally:
        await db.close()


@router.post("/topup")
async def submit_topup(record: TopupRecord):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT status FROM migrations WHERE id = ?",
            (record.migration_id,),
        )
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")
        if migration["status"] not in (
            MigrationStatus.DEPOSITING.value,
            MigrationStatus.QUALIFIED.value,
        ):
            raise HTTPException(400, "Migration is not accepting top-ups")

        result = await process_topup(
            db, record.migration_id, record.wallet_address, record.ton_amount, record.tx_hash
        )
        return {"topup": result}
    finally:
        await db.close()


@router.post("/late-claim")
async def submit_late_claim(record: LateClaimRecord):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT status, late_claim_deadline, base_ratio FROM migrations WHERE id = ?",
            (record.migration_id,),
        )
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")
        if migration["status"] != MigrationStatus.LATE_CLAIMS.value:
            raise HTTPException(400, "Migration is not in late claim phase")

        if migration["late_claim_deadline"]:
            deadline = datetime.fromisoformat(migration["late_claim_deadline"])
            if datetime.now(timezone.utc) > deadline:
                raise HTTPException(400, "Late claim window has closed")

        base_ratio = migration["base_ratio"]
        allocation = calculate_late_claim_allocation(record.amount, base_ratio)

        await db.execute(
            """INSERT INTO late_claims
            (migration_id, wallet_address, amount, newmeme_allocated, tx_hash_deposit, claimed_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                record.migration_id,
                record.wallet_address,
                record.amount,
                allocation,
                record.tx_hash,
                datetime.now(timezone.utc).isoformat(),
                "pending",
            ),
        )
        await db.commit()

        return {
            "wallet_address": record.wallet_address,
            "deposit_amount": record.amount,
            "newmeme_allocation": allocation,
            "tier": "tier3",
            "multiplier": 0.5,
        }
    finally:
        await db.close()


@router.get("/{migration_id}/wallet/{wallet_address}")
async def get_wallet_deposits(migration_id: str, wallet_address: str):
    raw_addr = normalize_address(wallet_address)
    db = await get_db()
    try:
        summary = await get_deposit_summary(db, migration_id, raw_addr)
        snapshot_bal = await get_snapshot_balance(db, migration_id, raw_addr)

        cursor = await db.execute(
            "SELECT base_ratio FROM migrations WHERE id = ?", (migration_id,)
        )
        migration = await cursor.fetchone()
        if not migration:
            raise HTTPException(404, "Migration not found")

        base_ratio = migration["base_ratio"]
        phx_bal = await get_phx_balance(wallet_address)
        alloc = calculate_allocation(
            summary["tier1_total"],
            summary["tier1plus_total"],
            summary["tier2_total"],
            base_ratio,
            summary["has_topup"],
            phx_balance=phx_bal,
        )

        return {
            **summary,
            "snapshot_balance": snapshot_bal,
            "is_og_holder": snapshot_bal > 0,
            "base_ratio": base_ratio,
            "allocation": alloc,
        }
    finally:
        await db.close()


@router.get("/{migration_id}/all")
async def get_all_deposits(migration_id: str):
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT wallet_address,
                SUM(amount) as total_amount,
                SUM(tier1_amount) as tier1,
                SUM(tier1plus_amount) as tier1plus,
                SUM(tier2_amount) as tier2
            FROM deposits
            WHERE migration_id = ?
            GROUP BY wallet_address
            ORDER BY total_amount DESC""",
            (migration_id,),
        )
        rows = await cursor.fetchall()
        return {
            "deposits": [
                {
                    "wallet_address": r["wallet_address"],
                    "total_amount": r["total_amount"],
                    "tier1": r["tier1"],
                    "tier1plus": r["tier1plus"],
                    "tier2": r["tier2"],
                }
                for r in rows
            ],
            "total_depositors": len(rows),
        }
    finally:
        await db.close()
