import logging
import aiosqlite
from datetime import datetime, timezone
from services.ton_api import (
    get_jetton_holders,
    get_jetton_info,
    classify_address,
    check_is_contract,
)
from config import KNOWN_BURN_ADDRESSES

logger = logging.getLogger("snapshot")


async def take_snapshot(
    db: aiosqlite.Connection,
    migration_id: str,
    jetton_address: str,
) -> dict:
    """
    Snapshot all holders for a migration. Uses a savepoint so that if the
    TON API fails mid-call, partial data is rolled back cleanly.
    """
    # Fetch all data from TON API BEFORE writing anything to DB
    try:
        holders = await get_jetton_holders(jetton_address)
        info = await get_jetton_info(jetton_address)
    except Exception as e:
        logger.error(f"TON API failed during snapshot for {jetton_address}: {e}")
        raise RuntimeError(f"Failed to fetch holder data from TON API: {e}") from e

    if not info:
        raise RuntimeError(f"Could not fetch jetton info for {jetton_address}")
    if not holders:
        raise RuntimeError(f"No holders found for {jetton_address}")

    total_supply = info["total_supply"]
    decimals = info["decimals"]
    divisor = 10 ** decimals

    # Classify all holders before writing (API calls happen here)
    excluded_entries = []
    valid_holders = []
    excluded_balance = 0

    for h in holders:
        addr = h["wallet_address"]
        raw_balance = h["balance"]
        balance = raw_balance / divisor
        is_wallet = h.get("is_wallet", True)
        name = h.get("name")

        burn_reason = classify_address(addr)
        if burn_reason:
            excluded_entries.append((addr, burn_reason, balance))
            excluded_balance += balance
            continue

        if name and "burn" in name.lower():
            excluded_entries.append((addr, "burn", balance))
            excluded_balance += balance
            continue

        # Use is_wallet from TonAPI holders endpoint (covers LPs, DEX contracts, etc.)
        if not is_wallet:
            excluded_entries.append((addr, "contract/lp", balance))
            excluded_balance += balance
            continue

        valid_holders.append({"wallet_address": addr, "balance": balance})

    # All API work done — now write to DB atomically via savepoint
    await db.execute("SAVEPOINT snapshot_sp")
    try:
        for addr, reason, balance in excluded_entries:
            await db.execute(
                "INSERT INTO excluded_addresses (migration_id, address, reason, balance) VALUES (?, ?, ?, ?)",
                (migration_id, addr, reason, balance),
            )

        for h in valid_holders:
            await db.execute(
                "INSERT OR REPLACE INTO snapshots (migration_id, wallet_address, balance) VALUES (?, ?, ?)",
                (migration_id, h["wallet_address"], h["balance"]),
            )

        await db.execute("RELEASE SAVEPOINT snapshot_sp")
    except Exception as e:
        await db.execute("ROLLBACK TO SAVEPOINT snapshot_sp")
        logger.error(f"DB write failed during snapshot for migration {migration_id}: {e}")
        raise RuntimeError(f"Snapshot write failed, rolled back: {e}") from e

    total_supply_normalized = total_supply / divisor
    circulating = total_supply_normalized - excluded_balance

    await db.commit()

    return {
        "total_supply": total_supply_normalized,
        "excluded_balance": excluded_balance,
        "circulating_supply": circulating,
        "holder_count": len(valid_holders),
        "snapshot_time": datetime.now(timezone.utc).isoformat(),
    }


async def get_snapshot_balance(
    db: aiosqlite.Connection,
    migration_id: str,
    wallet_address: str,
) -> float:
    cursor = await db.execute(
        "SELECT balance FROM snapshots WHERE migration_id = ? AND wallet_address = ?",
        (migration_id, wallet_address),
    )
    row = await cursor.fetchone()
    return row["balance"] if row else 0.0


async def get_all_snapshot_holders(
    db: aiosqlite.Connection,
    migration_id: str,
) -> list[dict]:
    cursor = await db.execute(
        "SELECT wallet_address, balance FROM snapshots WHERE migration_id = ? ORDER BY balance DESC",
        (migration_id,),
    )
    rows = await cursor.fetchall()
    return [{"wallet_address": r["wallet_address"], "balance": r["balance"]} for r in rows]
