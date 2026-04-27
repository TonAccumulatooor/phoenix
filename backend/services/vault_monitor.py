"""
Vault Wallet Monitor
====================
Polls TON API for incoming jetton transfers to the Phoenix vault wallet.
On each tick it fetches new transactions since the last seen lt (logical time),
matches them to active migrations by jetton address, and records deposits.

Runs as a background asyncio task started in FastAPI's lifespan.
"""

import asyncio
import logging
from datetime import datetime, timezone

import httpx

from config import TON_API_BASE, TON_API_KEY, VAULT_WALLET_ADDRESS
from database import get_db
from models import MigrationStatus
from services.vault import process_deposit, check_threshold

logger = logging.getLogger("vault_monitor")

POLL_INTERVAL = 15          # seconds between polls
TX_FETCH_LIMIT = 50         # transactions per page


def _headers() -> dict:
    h = {"Accept": "application/json"}
    if TON_API_KEY:
        h["Authorization"] = f"Bearer {TON_API_KEY}"
    return h


# ---------------------------------------------------------------------------
# State: last processed logical-time per vault address so we don't re-process
# Persisted to DB via monitor_state table to survive restarts.
# ---------------------------------------------------------------------------
_last_lt: dict[str, int] = {}


async def _load_last_lt(db) -> None:
    """Load persisted last_lt from DB on first poll."""
    if not VAULT_WALLET_ADDRESS or VAULT_WALLET_ADDRESS in _last_lt:
        return
    key = f"last_lt:{VAULT_WALLET_ADDRESS}"
    cursor = await db.execute("SELECT value FROM monitor_state WHERE key = ?", (key,))
    row = await cursor.fetchone()
    if row:
        _last_lt[VAULT_WALLET_ADDRESS] = int(row["value"])
        logger.info(f"Restored last_lt={_last_lt[VAULT_WALLET_ADDRESS]} from DB")


async def _save_last_lt(db, lt: int) -> None:
    """Persist last_lt to DB."""
    key = f"last_lt:{VAULT_WALLET_ADDRESS}"
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO monitor_state (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?""",
        (key, str(lt), now, str(lt), now),
    )
    await db.commit()


async def _fetch_vault_transactions(client: httpx.AsyncClient, after_lt: int) -> list[dict]:
    """Fetch account events for the vault wallet, newest first, stopping at after_lt."""
    if not VAULT_WALLET_ADDRESS:
        return []

    params: dict = {"limit": TX_FETCH_LIMIT}
    if after_lt:
        params["after_lt"] = after_lt

    try:
        resp = await client.get(
            f"{TON_API_BASE}/accounts/{VAULT_WALLET_ADDRESS}/events",
            params=params,
            headers=_headers(),
            timeout=20,
        )
        if resp.status_code != 200:
            logger.warning(f"TON API events returned {resp.status_code}")
            return []
        return resp.json().get("events", [])
    except Exception as e:
        logger.error(f"Failed to fetch vault transactions: {e}")
        return []


def _extract_jetton_transfer(event: dict) -> dict | None:
    """
    Parse a TON API event and extract jetton transfer details if this is an
    incoming JettonTransfer action to our vault.

    Returns:
        {"sender": str, "jetton_address": str, "amount": float, "lt": int, "tx_hash": str}
        or None if not a relevant incoming jetton transfer.
    """
    lt = event.get("lt", 0)
    tx_hash = event.get("event_id", "")

    for action in event.get("actions", []):
        if action.get("type") != "JettonTransfer":
            continue
        if action.get("status") != "ok":
            continue

        details = action.get("JettonTransfer", {})
        recipient = details.get("recipient", {}).get("address", "")

        # Only care about transfers TO our vault
        if recipient.lower() != VAULT_WALLET_ADDRESS.lower():
            continue

        sender = details.get("sender", {}).get("address", "")
        jetton_master = details.get("jetton", {}).get("address", "")
        raw_amount = int(details.get("amount", 0))
        decimals = int(details.get("jetton", {}).get("decimals", 9))
        amount = raw_amount / (10 ** decimals)

        if amount <= 0 or not jetton_master or not sender:
            continue

        return {
            "sender": sender,
            "jetton_address": jetton_master,
            "amount": amount,
            "lt": lt,
            "tx_hash": tx_hash,
        }

    return None


async def _get_active_migrations(db) -> list[dict]:
    """Return migrations currently in DEPOSITING or LATE_CLAIMS status."""
    cursor = await db.execute(
        """SELECT id, old_token_address, status, deposit_deadline, late_claim_deadline
           FROM migrations
           WHERE status IN (?, ?)""",
        (MigrationStatus.DEPOSITING.value, MigrationStatus.LATE_CLAIMS.value),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def _is_already_recorded(db, tx_hash: str) -> bool:
    """Guard against double-processing the same transaction."""
    cursor = await db.execute(
        "SELECT id FROM deposits WHERE tx_hash = ? LIMIT 1", (tx_hash,)
    )
    return (await cursor.fetchone()) is not None


async def _process_event(db, transfer: dict, migration: dict) -> None:
    """Record a deposit and check the 51% threshold."""
    already = await _is_already_recorded(db, transfer["tx_hash"])
    if already:
        return

    # Deadline guard
    status = migration["status"]
    deadline_key = "late_claim_deadline" if status == MigrationStatus.LATE_CLAIMS.value else "deposit_deadline"
    deadline_str = migration.get(deadline_key)
    if deadline_str:
        deadline = datetime.fromisoformat(deadline_str)
        if datetime.now(timezone.utc) > deadline:
            logger.info(
                f"Transfer {transfer['tx_hash']} received after deadline — skipping"
            )
            return

    result = await process_deposit(
        db,
        migration["id"],
        transfer["sender"],
        transfer["amount"],
        transfer["tx_hash"],
    )
    logger.info(
        f"[DEPOSIT] migration={migration['id']} wallet={transfer['sender'][:12]}… "
        f"amount={transfer['amount']} tier1={result['tier1_amount']} "
        f"tier1plus={result['tier1plus_amount']} tier2={result['tier2_amount']}"
    )

    threshold = await check_threshold(db, migration["id"])
    if threshold["qualified"] and migration["status"] == MigrationStatus.DEPOSITING.value:
        await db.execute(
            "UPDATE migrations SET status = ?, updated_at = ? WHERE id = ?",
            (
                MigrationStatus.QUALIFIED.value,
                datetime.now(timezone.utc).isoformat(),
                migration["id"],
            ),
        )
        await db.commit()
        logger.info(
            f"[QUALIFIED] migration={migration['id']} reached 51% threshold — status → qualified"
        )


async def _poll_once() -> None:
    """One poll cycle: fetch new events, match to migrations, record deposits."""
    if not VAULT_WALLET_ADDRESS:
        logger.warning("PHOENIX_VAULT_ADDRESS not set — vault monitor idle")
        return

    db = await get_db()
    try:
        # Load persisted state on first run
        await _load_last_lt(db)

        after_lt = _last_lt.get(VAULT_WALLET_ADDRESS, 0)

        async with httpx.AsyncClient() as client:
            events = await _fetch_vault_transactions(client, after_lt)

        if not events:
            return

        # Events are newest-first; track the highest lt seen this cycle
        max_lt = after_lt

        migrations = await _get_active_migrations(db)
        # Build lookup: jetton_address (lower) → migration
        jetton_map = {m["old_token_address"].lower(): m for m in migrations}

        for event in events:
            lt = event.get("lt", 0)
            if lt <= after_lt:
                continue  # already processed

            transfer = _extract_jetton_transfer(event)
            if transfer and transfer["jetton_address"].lower() in jetton_map:
                migration = jetton_map[transfer["jetton_address"].lower()]
                await _process_event(db, transfer, migration)

            if lt > max_lt:
                max_lt = lt

        # Persist to DB so we survive restarts
        if max_lt > after_lt:
            _last_lt[VAULT_WALLET_ADDRESS] = max_lt
            await _save_last_lt(db, max_lt)

    finally:
        await db.close()


_consecutive_errors = 0
MAX_CONSECUTIVE_ERRORS = 5


async def run_vault_monitor() -> None:
    """
    Long-running background task. Call from FastAPI lifespan:

        asyncio.create_task(run_vault_monitor())
    """
    global _consecutive_errors
    logger.info(f"Vault monitor started — polling every {POLL_INTERVAL}s")
    while True:
        try:
            await _poll_once()
            if _consecutive_errors > 0:
                logger.info(f"Vault monitor recovered after {_consecutive_errors} consecutive errors")
            _consecutive_errors = 0
        except Exception as e:
            _consecutive_errors += 1
            if _consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                logger.critical(
                    f"VAULT MONITOR CRITICAL: {_consecutive_errors} consecutive poll failures. "
                    f"Deposits may be missed! Last error: {e}"
                )
            else:
                logger.error(f"Vault monitor poll error ({_consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}): {e}")
        await asyncio.sleep(POLL_INTERVAL)
