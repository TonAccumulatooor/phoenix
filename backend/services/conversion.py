import math
import aiosqlite
from config import (
    NEW_TOKEN_SUPPLY,
    TIER1_MULTIPLIER,
    TIER1_PLUS_MULTIPLIER,
    TIER2_MULTIPLIER,
    TIER3_MULTIPLIER,
    TOPUP_BONUS_MULTIPLIER,
    FULL_DEV_BUY_TON,
    FULL_DEV_BUY_SUPPLY_PERCENT,
    GROYPAD_GRADUATION_TON,
    GROYPAD_MAX_CURVE_SUPPLY,
    GROYPAD_TRADE_FEE,
    TREASURY_LP_SEED_AMOUNT,
    TREASURY_NFT_AIRDROP_AMOUNT,
    PHX_BOOST_TIER1_MIN,
    PHX_BOOST_TIER1_BONUS,
    PHX_BOOST_TIER2_MIN,
    PHX_BOOST_TIER2_BONUS,
)


def compute_base_ratio(old_total_supply: float) -> float:
    if old_total_supply <= 0:
        return 0
    return NEW_TOKEN_SUPPLY / old_total_supply


def estimate_agent_supply(dev_buy_ton: float) -> float:
    """
    Estimate tokens acquired from Groypad's linear bonding curve.
    price(s) = α + β·s with α≈0 → cost ∝ S² → S = MAX_SUPPLY × √(TON / GRADUATION_TON)
    """
    effective_ton = dev_buy_ton * (1 - GROYPAD_TRADE_FEE)
    if effective_ton <= 0:
        return 0
    capped = min(effective_ton, GROYPAD_GRADUATION_TON)
    return GROYPAD_MAX_CURVE_SUPPLY * math.sqrt(capped / GROYPAD_GRADUATION_TON)


def classify_deposit(
    deposit_amount: float,
    snapshot_balance: float,
) -> dict:
    """Split a deposit into tier amounts based on snapshot balance."""
    if snapshot_balance <= 0:
        return {
            "tier1_amount": 0,
            "tier1plus_amount": 0,
            "tier2_amount": deposit_amount,
        }

    if deposit_amount <= snapshot_balance:
        return {
            "tier1_amount": deposit_amount,
            "tier1plus_amount": 0,
            "tier2_amount": 0,
        }

    return {
        "tier1_amount": snapshot_balance,
        "tier1plus_amount": deposit_amount - snapshot_balance,
        "tier2_amount": 0,
    }


def get_phx_boost(phx_balance: float) -> float:
    """Return PHX holder boost multiplier based on balance."""
    if phx_balance >= PHX_BOOST_TIER2_MIN:
        return PHX_BOOST_TIER2_BONUS
    if phx_balance >= PHX_BOOST_TIER1_MIN:
        return PHX_BOOST_TIER1_BONUS
    return 0.0


def calculate_allocation(
    tier1_amount: float,
    tier1plus_amount: float,
    tier2_amount: float,
    base_ratio: float,
    has_topup: bool,
    phx_balance: float = 0,
) -> dict:
    """Calculate NEWMEME allocation for a single depositor."""
    from_tier1 = tier1_amount * base_ratio * TIER1_MULTIPLIER
    from_tier1plus = tier1plus_amount * base_ratio * TIER1_PLUS_MULTIPLIER
    from_tier2 = tier2_amount * base_ratio * TIER2_MULTIPLIER

    subtotal = from_tier1 + from_tier1plus + from_tier2

    topup_bonus = 0
    if has_topup:
        topup_bonus = subtotal * (TOPUP_BONUS_MULTIPLIER - 1)

    phx_boost_pct = get_phx_boost(phx_balance)
    phx_boost = subtotal * phx_boost_pct

    total = subtotal + topup_bonus + phx_boost

    return {
        "newmeme_from_tier1": from_tier1,
        "newmeme_from_tier1plus": from_tier1plus,
        "newmeme_from_tier2": from_tier2,
        "newmeme_subtotal": subtotal,
        "topup_bonus": topup_bonus,
        "phx_boost": phx_boost,
        "phx_boost_pct": phx_boost_pct,
        "phx_balance": phx_balance,
        "newmeme_total": total,
    }


def calculate_late_claim_allocation(
    amount: float,
    base_ratio: float,
) -> float:
    return amount * base_ratio * TIER3_MULTIPLIER


async def calculate_all_distributions(
    db: aiosqlite.Connection,
    migration_id: str,
    base_ratio: float,
    agent_supply: float,
) -> dict:
    """Calculate distributions for all depositors with pro-rata scaling if needed."""
    from services.ton_api import get_phx_balances

    cursor = await db.execute(
        "SELECT wallet_address, tier1_amount, tier1plus_amount, tier2_amount FROM deposits WHERE migration_id = ?",
        (migration_id,),
    )
    deposits = await cursor.fetchall()

    topup_cursor = await db.execute(
        "SELECT DISTINCT wallet_address FROM topups WHERE migration_id = ?",
        (migration_id,),
    )
    topup_wallets = {row["wallet_address"] for row in await topup_cursor.fetchall()}

    # Fetch PHX balances for all depositors
    wallet_list = [dep["wallet_address"] for dep in deposits]
    phx_balances = await get_phx_balances(wallet_list)

    allocations = []
    total_demand = 0

    for dep in deposits:
        has_topup = dep["wallet_address"] in topup_wallets
        phx_bal = phx_balances.get(dep["wallet_address"], 0)
        alloc = calculate_allocation(
            dep["tier1_amount"],
            dep["tier1plus_amount"],
            dep["tier2_amount"],
            base_ratio,
            has_topup,
            phx_balance=phx_bal,
        )
        alloc["wallet_address"] = dep["wallet_address"]
        alloc["deposit_amount"] = dep["tier1_amount"] + dep["tier1plus_amount"] + dep["tier2_amount"]
        allocations.append(alloc)
        total_demand += alloc["newmeme_total"]

    late_claim_reserve = agent_supply * 0.10
    # Fixed treasury reserves from 1B total supply (1% total)
    lp_seed_reserve = TREASURY_LP_SEED_AMOUNT          # 5M — seeds PHX/NEWTOKEN LP
    nft_airdrop_reserve = TREASURY_NFT_AIRDROP_AMOUNT  # 5M — airdropped to Groyper NFT holders
    treasury_reserve = lp_seed_reserve + nft_airdrop_reserve  # 10M total
    distributable = agent_supply - late_claim_reserve - treasury_reserve

    pro_rata_scale = 1.0
    if total_demand > distributable and total_demand > 0:
        pro_rata_scale = distributable / total_demand

    for alloc in allocations:
        alloc["newmeme_final"] = alloc["newmeme_total"] * pro_rata_scale
        alloc["pro_rata_scale"] = pro_rata_scale

    return {
        "allocations": allocations,
        "total_demand": total_demand,
        "distributable": distributable,
        "pro_rata_scale": pro_rata_scale,
        "late_claim_reserve": late_claim_reserve,
        "lp_seed_reserve": lp_seed_reserve,
        "nft_airdrop_reserve": nft_airdrop_reserve,
        "treasury_reserve": treasury_reserve,
    }
