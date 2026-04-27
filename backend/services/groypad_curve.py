import math
from config import (
    GROYPAD_GRADUATION_TON,
    GROYPAD_MAX_CURVE_SUPPLY,
    GROYPAD_TRADE_FEE,
    GROYPAD_TOTAL_SUPPLY,
)


def estimate_dev_buy(ton_amount: float) -> dict:
    """
    Estimate how many NEWTOKEN the dev buy acquires on Groypad's linear bonding curve.

    Groypad uses price(s) = α + β·s. For a first buy from supply=0 with α≈0,
    cost scales quadratically with tokens: cost ∝ S². Inverting gives S ∝ √cost.

    Calibrated to: 1050 TON (graduation) buys 760M tokens (76% of 1B supply).
    """
    effective_ton = ton_amount * (1 - GROYPAD_TRADE_FEE)

    if effective_ton <= 0:
        return {
            "ton_input": ton_amount,
            "effective_ton": 0,
            "tokens_acquired": 0,
            "supply_percent": 0,
            "fee_ton": ton_amount * GROYPAD_TRADE_FEE,
            "graduates": False,
            "graduation_progress_percent": 0,
        }

    capped = min(effective_ton, GROYPAD_GRADUATION_TON)
    tokens = GROYPAD_MAX_CURVE_SUPPLY * math.sqrt(capped / GROYPAD_GRADUATION_TON)
    supply_pct = (tokens / GROYPAD_TOTAL_SUPPLY) * 100
    grad_progress = min(100, (ton_amount / GROYPAD_GRADUATION_TON) * 100)

    return {
        "ton_input": round(ton_amount, 2),
        "effective_ton": round(effective_ton, 2),
        "tokens_acquired": round(tokens, 0),
        "supply_percent": round(supply_pct, 2),
        "fee_ton": round(ton_amount * GROYPAD_TRADE_FEE, 2),
        "graduates": ton_amount >= GROYPAD_GRADUATION_TON,
        "graduation_progress_percent": round(grad_progress, 1),
    }
