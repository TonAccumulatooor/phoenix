import aiosqlite
from datetime import datetime, timezone
from services.snapshot import get_snapshot_balance
from services.conversion import classify_deposit


async def process_deposit(
    db: aiosqlite.Connection,
    migration_id: str,
    wallet_address: str,
    amount: float,
    tx_hash: str,
) -> dict:
    """Process an incoming OLDMEME deposit into the vault."""
    snapshot_balance = await get_snapshot_balance(db, migration_id, wallet_address)
    tiers = classify_deposit(amount, snapshot_balance)

    await db.execute(
        """INSERT INTO deposits
        (migration_id, wallet_address, amount, tier1_amount, tier1plus_amount, tier2_amount, tx_hash, deposited_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            migration_id,
            wallet_address,
            amount,
            tiers["tier1_amount"],
            tiers["tier1plus_amount"],
            tiers["tier2_amount"],
            tx_hash,
            datetime.now(timezone.utc).isoformat(),
        ),
    )

    await db.execute(
        "UPDATE migrations SET total_deposited = total_deposited + ?, updated_at = ? WHERE id = ?",
        (amount, datetime.now(timezone.utc).isoformat(), migration_id),
    )
    await db.commit()

    return {
        "wallet_address": wallet_address,
        "amount": amount,
        "tier1_amount": tiers["tier1_amount"],
        "tier1plus_amount": tiers["tier1plus_amount"],
        "tier2_amount": tiers["tier2_amount"],
        "snapshot_balance": snapshot_balance,
    }


async def process_topup(
    db: aiosqlite.Connection,
    migration_id: str,
    wallet_address: str,
    ton_amount: float,
    tx_hash: str,
) -> dict:
    """Process an incoming TON top-up contribution."""
    await db.execute(
        "INSERT INTO topups (migration_id, wallet_address, ton_amount, tx_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        (migration_id, wallet_address, ton_amount, tx_hash, datetime.now(timezone.utc).isoformat()),
    )

    await db.execute(
        "UPDATE migrations SET total_topup_ton = total_topup_ton + ?, updated_at = ? WHERE id = ?",
        (ton_amount, datetime.now(timezone.utc).isoformat(), migration_id),
    )
    await db.commit()

    return {
        "wallet_address": wallet_address,
        "ton_amount": ton_amount,
    }


async def check_threshold(
    db: aiosqlite.Connection,
    migration_id: str,
) -> dict:
    """Check if the migration has reached the 51% deposit threshold."""
    cursor = await db.execute(
        "SELECT total_deposited, threshold_amount, circulating_supply, status FROM migrations WHERE id = ?",
        (migration_id,),
    )
    row = await cursor.fetchone()
    if not row:
        return {"qualified": False, "error": "Migration not found"}

    total = row["total_deposited"]
    threshold = row["threshold_amount"]
    circulating = row["circulating_supply"]

    progress = (total / threshold * 100) if threshold > 0 else 0
    qualified = total >= threshold

    return {
        "qualified": qualified,
        "total_deposited": total,
        "threshold_amount": threshold,
        "circulating_supply": circulating,
        "progress_percent": round(min(progress, 100), 2),
        "remaining": max(0, threshold - total),
        "status": row["status"],
    }


async def get_deposit_summary(
    db: aiosqlite.Connection,
    migration_id: str,
    wallet_address: str,
) -> dict:
    """Get total deposits for a specific wallet in a migration."""
    cursor = await db.execute(
        """SELECT
            COALESCE(SUM(amount), 0) as total_amount,
            COALESCE(SUM(tier1_amount), 0) as total_tier1,
            COALESCE(SUM(tier1plus_amount), 0) as total_tier1plus,
            COALESCE(SUM(tier2_amount), 0) as total_tier2,
            COUNT(*) as deposit_count
        FROM deposits WHERE migration_id = ? AND wallet_address = ?""",
        (migration_id, wallet_address),
    )
    row = await cursor.fetchone()

    topup_cursor = await db.execute(
        "SELECT COALESCE(SUM(ton_amount), 0) as total_topup FROM topups WHERE migration_id = ? AND wallet_address = ?",
        (migration_id, wallet_address),
    )
    topup_row = await topup_cursor.fetchone()

    return {
        "wallet_address": wallet_address,
        "total_deposited": row["total_amount"],
        "tier1_total": row["total_tier1"],
        "tier1plus_total": row["total_tier1plus"],
        "tier2_total": row["total_tier2"],
        "deposit_count": row["deposit_count"],
        "topup_ton": topup_row["total_topup"],
        "has_topup": topup_row["total_topup"] > 0,
    }
