import math
from config import (
    TOPBLAST_GRADUATION_GRAM,
    TOPBLAST_MIGRATION_FEE_GRAM,
    TOPBLAST_MAX_CURVE_SUPPLY,
    TOPBLAST_TOTAL_SUPPLY,
    TOPBLAST_DEFAULT_TRADE_FEE,
    TOPBLAST_FEE_TIERS,
)


def creator_reward_percent(trade_fee: float) -> float:
    """Creator reward share for a given trade fee tier."""
    return TOPBLAST_FEE_TIERS.get(trade_fee, 0.0)


def estimate_dev_buy(gram_amount: float, trade_fee: float = TOPBLAST_DEFAULT_TRADE_FEE) -> dict:
    """
    Estimate how many NEWTOKEN a dev buy acquires on Topblast's bonding curve.

    price(s) = α + β·s. For a first buy from supply=0 with α≈0, cost scales
    quadratically with tokens: cost ∝ S². Inverting gives S ∝ √cost.

    Calibrated to: 1500 GRAM raised on the curve buys 700M tokens (70% of 1B).
    The 50 GRAM migration fee is charged on graduation and does not buy tokens,
    so it is excluded from the curve math and reported separately.
    """
    effective_gram = gram_amount * (1 - trade_fee)

    if effective_gram <= 0:
        return {
            "gram_input": gram_amount,
            "effective_gram": 0,
            "tokens_acquired": 0,
            "supply_percent": 0,
            "fee_gram": gram_amount * trade_fee,
            "trade_fee": trade_fee,
            "creator_reward_percent": creator_reward_percent(trade_fee),
            "migration_fee_gram": TOPBLAST_MIGRATION_FEE_GRAM,
            "graduates": False,
            "graduation_progress_percent": 0,
        }

    capped = min(effective_gram, TOPBLAST_GRADUATION_GRAM)
    tokens = TOPBLAST_MAX_CURVE_SUPPLY * math.sqrt(capped / TOPBLAST_GRADUATION_GRAM)
    supply_pct = (tokens / TOPBLAST_TOTAL_SUPPLY) * 100
    grad_progress = min(100, (effective_gram / TOPBLAST_GRADUATION_GRAM) * 100)

    return {
        "gram_input": round(gram_amount, 2),
        "effective_gram": round(effective_gram, 2),
        "tokens_acquired": round(tokens, 0),
        "supply_percent": round(supply_pct, 2),
        "fee_gram": round(gram_amount * trade_fee, 2),
        "trade_fee": trade_fee,
        "creator_reward_percent": creator_reward_percent(trade_fee),
        "migration_fee_gram": TOPBLAST_MIGRATION_FEE_GRAM,
        "graduates": effective_gram >= TOPBLAST_GRADUATION_GRAM,
        "graduation_progress_percent": round(grad_progress, 1),
    }
