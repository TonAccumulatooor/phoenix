"""
Groyper NFT Service
===================
Queries TonAPI for Groyper NFT ownership. Used for:
  - Proposal fee waiver (holders skip the $25 PHX fee)
  - Post-launch airdrop snapshots (0.5% of NEWTOKEN supply to NFT holders)

Collection: EQAmTVtgzf14BiZSvDFQgA3vY7Isey8sHB3nAtZQS-2Vs2hw
Fixed supply: 271 NFTs
"""

import httpx
from config import TON_API_BASE, TON_API_KEY

GROYPER_NFT_COLLECTION = "EQAmTVtgzf14BiZSvDFQgA3vY7Isey8sHB3nAtZQS-2Vs2hw"
GROYPER_NFT_SUPPLY = 271
AIRDROP_PER_NFT = 18_450  # 5,000,000 / 271 ≈ 18,450.18 → floored to whole tokens


def _headers() -> dict:
    h = {"Accept": "application/json"}
    if TON_API_KEY:
        h["Authorization"] = f"Bearer {TON_API_KEY}"
    return h


async def check_groyper_nft_holder(wallet_address: str) -> dict:
    """
    Check if a wallet holds any Groyper NFTs.
    Returns {"holds_nft": bool, "nft_count": int}
    """
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{TON_API_BASE}/accounts/{wallet_address}/nfts",
            params={"collection": GROYPER_NFT_COLLECTION, "limit": 1000},
            headers=_headers(),
        )
        if resp.status_code != 200:
            return {"holds_nft": False, "nft_count": 0, "error": f"API returned {resp.status_code}"}

        data = resp.json()
        items = data.get("nft_items", [])
        return {"holds_nft": len(items) > 0, "nft_count": len(items)}


async def snapshot_groyper_nft_holders() -> list[dict]:
    """
    Get all current Groyper NFT holders with their NFT counts.
    Used for the post-launch airdrop (0.5% of NEWTOKEN supply).

    Returns list of {"wallet_address": str, "nft_count": int, "airdrop_amount": float}
    """
    async with httpx.AsyncClient(timeout=60) as client:
        # Fetch all NFT items in the collection
        items = []
        offset = 0
        limit = 1000

        while True:
            resp = await client.get(
                f"{TON_API_BASE}/nfts/collections/{GROYPER_NFT_COLLECTION}/items",
                params={"limit": limit, "offset": offset},
                headers=_headers(),
            )
            if resp.status_code != 200:
                break

            data = resp.json()
            batch = data.get("nft_items", [])
            if not batch:
                break

            items.extend(batch)
            offset += limit
            if len(batch) < limit:
                break

    # Count NFTs per owner wallet
    owner_counts: dict[str, int] = {}
    for item in items:
        owner = item.get("owner", {})
        addr = owner.get("address", "")
        if addr:
            owner_counts[addr] = owner_counts.get(addr, 0) + 1

    # Build airdrop list
    holders = []
    for wallet, count in sorted(owner_counts.items(), key=lambda x: -x[1]):
        holders.append({
            "wallet_address": wallet,
            "nft_count": count,
            "airdrop_amount": count * AIRDROP_PER_NFT,
        })

    return holders
