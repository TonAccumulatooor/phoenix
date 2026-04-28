import httpx
import asyncio
from typing import Optional
from config import TON_API_BASE, TON_API_KEY, KNOWN_BURN_ADDRESSES, PHOENIX_TOKEN_ADDRESS


def _headers() -> dict:
    h = {"Accept": "application/json"}
    if TON_API_KEY:
        h["Authorization"] = f"Bearer {TON_API_KEY}"
    return h


async def get_jetton_info(jetton_address: str) -> Optional[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{TON_API_BASE}/jettons/{jetton_address}",
            headers=_headers(),
            timeout=30,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        metadata = data.get("metadata", {})
        return {
            "address": jetton_address,
            "name": metadata.get("name", "Unknown"),
            "symbol": metadata.get("symbol", "???"),
            "decimals": int(metadata.get("decimals", 9)),
            "description": metadata.get("description", ""),
            "total_supply": float(data.get("total_supply", 0)),
            "holders_count": data.get("holders_count", 0),
            "image": metadata.get("image") or (data.get("preview") if isinstance(data.get("preview"), str) else None),
        }


async def get_phx_balance(wallet_address: str) -> float:
    """Get PHX token balance for a wallet (human-readable, not raw)."""
    if not PHOENIX_TOKEN_ADDRESS:
        return 0
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{TON_API_BASE}/accounts/{wallet_address}/jettons/{PHOENIX_TOKEN_ADDRESS}",
            headers=_headers(),
        )
    if resp.status_code != 200:
        return 0
    data = resp.json()
    raw = int(data.get("balance", 0))
    decimals = int(data.get("jetton", {}).get("decimals", 9))
    return raw / (10 ** decimals)


async def get_phx_balances(wallet_addresses: list[str]) -> dict[str, float]:
    """Get PHX balances for multiple wallets. Returns {wallet: balance}."""
    results = {}
    for wallet in wallet_addresses:
        results[wallet] = await get_phx_balance(wallet)
        await asyncio.sleep(0.1)  # rate limit
    return results


async def get_jetton_holders(
    jetton_address: str, limit: int = 1000
) -> list[dict]:
    holders = []
    offset = 0
    async with httpx.AsyncClient() as client:
        while True:
            resp = await client.get(
                f"{TON_API_BASE}/jettons/{jetton_address}/holders",
                params={"limit": limit, "offset": offset},
                headers=_headers(),
                timeout=60,
            )
            if resp.status_code != 200:
                break
            data = resp.json()
            addresses = data.get("addresses", [])
            if not addresses:
                break
            for h in addresses:
                owner = h.get("owner", {})
                holders.append({
                    "wallet_address": owner.get("address", ""),
                    "balance": float(h.get("balance", 0)),
                    "is_wallet": owner.get("is_wallet", True),
                    "name": owner.get("name"),
                })
            offset += limit
            if len(addresses) < limit:
                break
            await asyncio.sleep(0.15)  # TonAPI paid key handles faster
    return holders


async def estimate_circulating_supply(jetton_address: str, info: dict | None = None) -> dict:
    """
    Calculate real circulating supply by fetching holders and excluding
    burn addresses, LP pools, and other contracts using tonapi's is_wallet field.
    """
    if not info:
        info = await get_jetton_info(jetton_address)
    if not info:
        return {"error": "Could not fetch jetton info"}

    holders = await get_jetton_holders(jetton_address)
    decimals = info["decimals"]
    divisor = 10 ** decimals
    total_supply = info["total_supply"] / divisor

    excluded = []
    excluded_balance = 0
    holder_count = 0

    for h in holders:
        addr = h["wallet_address"]
        balance = h["balance"] / divisor
        name = h.get("name")
        is_wallet = h.get("is_wallet", True)

        reason = None
        if addr in KNOWN_BURN_ADDRESSES or _is_zero_address(addr):
            reason = "burn"
        elif name and "burn" in name.lower():
            reason = "burn"
        elif not is_wallet:
            reason = "contract/lp"

        if reason:
            excluded.append({
                "address": addr,
                "balance": balance,
                "percent": (balance / total_supply * 100) if total_supply > 0 else 0,
                "reason": reason,
                "name": name,
            })
            excluded_balance += balance
        else:
            holder_count += 1

    circulating = total_supply - excluded_balance
    circ_percent = (circulating / total_supply * 100) if total_supply > 0 else 0

    return {
        "total_supply": total_supply,
        "circulating_supply": circulating,
        "circulating_percent": round(circ_percent, 2),
        "excluded_balance": excluded_balance,
        "excluded_addresses": [
            e for e in sorted(excluded, key=lambda x: x["balance"], reverse=True)
            if e["percent"] >= 0.01
        ],
        "holder_count": holder_count,
    }


def _is_zero_address(address: str) -> bool:
    raw = address.replace("0:", "").replace("-", "").replace("_", "")
    return all(c == "0" or c == "A" for c in raw)


def classify_address(address: str) -> Optional[str]:
    if address in KNOWN_BURN_ADDRESSES:
        return "burn"
    return None


async def get_account_info(address: str) -> Optional[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{TON_API_BASE}/accounts/{address}",
            headers=_headers(),
            timeout=30,
        )
        if resp.status_code != 200:
            return None
        return resp.json()


async def check_is_contract(address: str) -> bool:
    info = await get_account_info(address)
    if not info:
        return False
    return info.get("status", "") == "active" and bool(info.get("code"))


async def get_jetton_admin(jetton_address: str) -> Optional[str]:
    info = await get_jetton_info(jetton_address)
    if not info:
        return None
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{TON_API_BASE}/jettons/{jetton_address}",
            headers=_headers(),
            timeout=30,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        admin = data.get("admin", {})
        return admin.get("address")


async def verify_jetton_transfer(
    event_id: str,
    expected_recipient: str,
    expected_jetton: str,
    expected_min_amount: float,
    expected_decimals: int = 9,
) -> dict:
    """
    Verify a jetton transfer TX actually happened on-chain.
    Returns {"verified": True/False, "reason": str, ...}
    """
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            resp = await client.get(
                f"{TON_API_BASE}/events/{event_id}",
                headers=_headers(),
            )
        except Exception as e:
            return {"verified": False, "reason": f"API request failed: {e}"}

    if resp.status_code == 404:
        return {"verified": False, "reason": "Transaction not found on-chain"}
    if resp.status_code != 200:
        return {"verified": False, "reason": f"API returned status {resp.status_code}"}

    event = resp.json()
    for action in event.get("actions", []):
        if action.get("type") != "JettonTransfer":
            continue
        if action.get("status") != "ok":
            continue

        details = action.get("JettonTransfer", {})
        recipient = details.get("recipient", {}).get("address", "")
        jetton_addr = details.get("jetton", {}).get("address", "")
        raw_amount = int(details.get("amount", 0))
        amount = raw_amount / (10 ** expected_decimals)

        if recipient.lower() != expected_recipient.lower():
            continue
        if jetton_addr.lower() != expected_jetton.lower():
            continue
        if amount < expected_min_amount * 0.99:  # 1% tolerance for rounding
            continue

        return {
            "verified": True,
            "reason": "ok",
            "sender": details.get("sender", {}).get("address", ""),
            "amount": amount,
            "jetton": jetton_addr,
        }

    return {"verified": False, "reason": "No matching JettonTransfer action in this transaction"}


STONFI_TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"
DEDUST_API = "https://api.dedust.io/v2"
STONFI_API = "https://api.ston.fi/v1"


async def get_pool_reserves(jetton_address: str) -> dict:
    """
    Query actual LP pool reserves from DeDust and STON.fi.
    Returns the best (deepest) pool found across both DEXs.
    """
    pools = []

    async with httpx.AsyncClient(timeout=30) as client:
        dedust, stonfi = await asyncio.gather(
            _fetch_dedust_pool(client, jetton_address),
            _fetch_stonfi_pool(client, jetton_address),
            return_exceptions=True,
        )

    if isinstance(dedust, dict):
        pools.append(dedust)
    if isinstance(stonfi, dict):
        pools.append(stonfi)

    if not pools:
        return {
            "has_liquidity": False,
            "ton_reserve": 0,
            "token_reserve": 0,
            "token_decimals": 9,
            "dex": None,
        }

    best = max(pools, key=lambda p: p["ton_reserve"])
    return best


async def _fetch_dedust_pool(client: httpx.AsyncClient, jetton_address: str) -> Optional[dict]:
    # Use TonAPI to find the specific DeDust pool instead of downloading all pools
    resp = await client.get(
        f"{TON_API_BASE}/jettons/{jetton_address}",
        headers=_headers(),
        timeout=15,
    )
    if resp.status_code != 200:
        return None

    # Fallback: query DeDust API for specific asset pools
    try:
        resp = await client.get(
            f"https://api.dedust.io/v3/pools",
            params={"jetton": jetton_address},
            timeout=15,
        )
        if resp.status_code != 200:
            # Try v2 all pools as last resort but with timeout
            resp = await client.get(f"{DEDUST_API}/pools", timeout=15)
            if resp.status_code != 200:
                return None
    except Exception:
        return None

    for pool in resp.json():
        if pool.get("type") != "volatile":
            continue
        assets = pool.get("assets", [])
        if len(assets) != 2:
            continue

        has_ton = assets[0].get("type") == "native"
        jetton_match = (
            assets[1].get("type") == "jetton"
            and assets[1].get("address", "").lower() == jetton_address.lower()
        )
        if not has_ton or not jetton_match:
            continue

        reserves = pool.get("reserves", [])
        if len(reserves) < 2:
            continue

        ton_reserve = int(reserves[0])
        token_reserve = int(reserves[1])
        if ton_reserve <= 0 or token_reserve <= 0:
            continue

        token_decimals = 9
        meta = assets[1].get("metadata")
        if meta and "decimals" in meta:
            token_decimals = int(meta["decimals"])

        return {
            "has_liquidity": True,
            "ton_reserve": ton_reserve,
            "token_reserve": token_reserve,
            "token_decimals": token_decimals,
            "dex": "dedust",
            "pool_address": pool.get("address", ""),
            "trade_fee": float(pool.get("tradeFee", 0.25)) / 100,
        }
    return None


async def _fetch_stonfi_pool(client: httpx.AsyncClient, jetton_address: str) -> Optional[dict]:
    resp = await client.get(f"{STONFI_API}/pools")
    if resp.status_code != 200:
        return None

    data = resp.json()
    pool_list = data.get("pool_list", [])

    for pool in pool_list:
        t0 = pool.get("token0_address", "")
        t1 = pool.get("token1_address", "")

        if t0.lower() == jetton_address.lower() and t1 == STONFI_TON_ADDRESS:
            token_reserve = int(pool.get("reserve0", 0))
            ton_reserve = int(pool.get("reserve1", 0))
        elif t1.lower() == jetton_address.lower() and t0 == STONFI_TON_ADDRESS:
            ton_reserve = int(pool.get("reserve0", 0))
            token_reserve = int(pool.get("reserve1", 0))
        else:
            continue

        if ton_reserve <= 0 or token_reserve <= 0:
            continue

        lp_fee_bps = int(pool.get("lp_fee", 30))
        protocol_fee_bps = int(pool.get("protocol_fee", 0))
        total_fee = (lp_fee_bps + protocol_fee_bps) / 10000

        return {
            "has_liquidity": True,
            "ton_reserve": ton_reserve,
            "token_reserve": token_reserve,
            "token_decimals": 9,
            "dex": "stonfi",
            "pool_address": pool.get("address", ""),
            "trade_fee": total_fee,
        }
    return None


async def estimate_pool_liquidity(jetton_address: str) -> dict:
    """Get pool reserves and derive spot price for backward compatibility."""
    pool = await get_pool_reserves(jetton_address)

    if not pool["has_liquidity"]:
        return {
            "token_price_in_ton": 0,
            "has_liquidity": False,
            "ton_reserve": 0,
            "token_reserve": 0,
            "token_decimals": 9,
            "dex": None,
            "trade_fee": 0,
        }

    ton_r = pool["ton_reserve"]
    token_r = pool["token_reserve"]
    spot_price = ton_r / token_r if token_r > 0 else 0

    return {
        "token_price_in_ton": spot_price,
        "has_liquidity": True,
        "ton_reserve": ton_r,
        "token_reserve": token_r,
        "token_decimals": pool.get("token_decimals", 9),
        "dex": pool.get("dex"),
        "pool_address": pool.get("pool_address", ""),
        "trade_fee": pool.get("trade_fee", 0),
    }
