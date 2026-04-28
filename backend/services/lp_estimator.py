from services.ton_api import estimate_pool_liquidity
from config import FULL_DEV_BUY_TON


async def estimate_extraction(
    jetton_address: str,
    circulating_supply: float,
    deposited_amount: float,
    pool_data: dict | None = None,
) -> dict:
    """
    Estimate TON extraction using actual DEX pool reserves and constant product formula.
    All reserve values are in raw units (with decimals). deposited_amount is in human-readable units.
    """
    if pool_data is not None:
        # Use pre-fetched pool data
        has_liquidity = pool_data.get("has_liquidity", False)
        liquidity = pool_data
    else:
        liquidity = await estimate_pool_liquidity(jetton_address)
        has_liquidity = liquidity.get("has_liquidity", False)

    if not has_liquidity:
        return {
            "estimated_extraction_ton": 0,
            "slippage_estimate_percent": 100,
            "dev_buy_assessment": "no_liquidity",
            "recommended_topup_ton": FULL_DEV_BUY_TON,
            "token_price_ton": 0,
            "pool_ton_reserve": 0,
            "pool_token_reserve": 0,
            "dex": None,
        }

    ton_reserve_raw = liquidity["ton_reserve"]
    token_reserve_raw = liquidity["token_reserve"]
    token_decimals = liquidity.get("token_decimals", 9)
    trade_fee = liquidity.get("trade_fee", 0)
    dex = liquidity.get("dex")

    ton_reserve = ton_reserve_raw / 1e9
    token_reserve = token_reserve_raw / (10 ** token_decimals)

    spot_price = ton_reserve / token_reserve if token_reserve > 0 else 0
    naive_value = deposited_amount * spot_price

    # x * y = k with fee applied to input
    effective_deposit = deposited_amount * (1 - trade_fee)
    k = ton_reserve * token_reserve
    new_token_balance = token_reserve + effective_deposit
    new_ton_balance = k / new_token_balance
    ton_extracted = ton_reserve - new_ton_balance

    if ton_extracted < 0:
        ton_extracted = 0

    slippage = 0
    if naive_value > 0:
        slippage = ((naive_value - ton_extracted) / naive_value) * 100

    if ton_extracted >= FULL_DEV_BUY_TON:
        assessment = "full_launch"
        recommended_topup = 0
    elif ton_extracted >= FULL_DEV_BUY_TON * 0.5:
        assessment = "flexible_launch"
        recommended_topup = FULL_DEV_BUY_TON - ton_extracted
    elif ton_extracted >= 200:
        assessment = "minimum_viable"
        recommended_topup = FULL_DEV_BUY_TON - ton_extracted
    else:
        assessment = "unlikely"
        recommended_topup = FULL_DEV_BUY_TON - ton_extracted

    return {
        "estimated_extraction_ton": round(ton_extracted, 2),
        "slippage_estimate_percent": round(slippage, 1),
        "dev_buy_assessment": assessment,
        "recommended_topup_ton": round(max(0, recommended_topup), 2),
        "token_price_ton": spot_price,
        "pool_ton_reserve": round(ton_reserve, 4),
        "pool_token_reserve": round(token_reserve, 2),
        "dex": dex,
        "trade_fee": trade_fee,
    }
