import os
import re
import base64
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent
load_dotenv(BASE_DIR / ".env")

DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "phoenix.db")))

TON_API_BASE = "https://tonapi.io/v2"
TON_API_KEY = os.getenv("TON_API_KEY", "")

VAULT_WALLET_ADDRESS = os.getenv("PHOENIX_VAULT_ADDRESS", "")
VAULT_MNEMONIC = os.getenv("PHOENIX_VAULT_MNEMONIC", "")

PHOENIX_TOKEN_ADDRESS = os.getenv("PHOENIX_TOKEN_ADDRESS", "")

AGENT_WALLET_ADDRESS = os.getenv("PHOENIX_AGENT_WALLET", "UQCd7P6pHn6uCF1TXiJc91EDAVSaaVcbQZmc6uap9dHaxuR4")
AGENT_MNEMONIC = os.getenv("PHOENIX_AGENT_MNEMONIC", "")
AGENT_API_KEY = os.getenv("PHOENIX_AGENT_API_KEY", "")


# --- Validation helpers ---

# Matches both raw (0:hex64) and user-friendly (EQ/UQ base64) TON addresses
TON_ADDRESS_RE = re.compile(
    r"^(0:[0-9a-fA-F]{64}|[EU]Q[A-Za-z0-9_\-]{46})$"
)


def is_valid_ton_address(addr: str) -> bool:
    return bool(TON_ADDRESS_RE.match(addr))


def normalize_address(addr: str) -> str:
    """Convert any TON address format to raw format (0:hex64).
    If already raw, return as-is."""
    if addr.startswith("0:") or addr.startswith("-1:"):
        return addr
    try:
        # User-friendly addresses are base64url-encoded, 48 chars
        # Decode: 2 bytes flags+workchain, 32 bytes hash, 2 bytes CRC
        padded = addr.replace("-", "+").replace("_", "/")
        while len(padded) % 4:
            padded += "="
        raw_bytes = base64.b64decode(padded)
        # byte 0: flags, byte 1: workchain (signed), bytes 2-33: hash
        workchain = int.from_bytes(raw_bytes[1:2], "big", signed=True)
        addr_hash = raw_bytes[2:34].hex()
        return f"{workchain}:{addr_hash}"
    except Exception:
        return addr

DEPOSIT_WINDOW_DAYS = 14
LATE_CLAIM_WINDOW_DAYS = 30
THRESHOLD_PERCENT = 0.51

TIER1_MULTIPLIER = 1.0
TIER1_PLUS_MULTIPLIER = 0.75
TIER2_MULTIPLIER = 0.75
TIER3_MULTIPLIER = 0.5
TOPUP_BONUS_MULTIPLIER = 1.10

NEW_TOKEN_SUPPLY = 1_000_000_000
FULL_DEV_BUY_GRAM = 1500
FULL_DEV_BUY_SUPPLY_PERCENT = 0.70

PROPOSAL_FEE_USD = 25

# Treasury retention from each migration (% of NEW_TOKEN_SUPPLY)
TREASURY_RETENTION_PERCENT = 0.01       # 1% total retained
TREASURY_LP_SEED_PERCENT = 0.005        # 0.5% → seeds PHX/NEWTOKEN LP
TREASURY_NFT_AIRDROP_PERCENT = 0.005    # 0.5% → airdropped to Groyper NFT holders
TREASURY_LP_SEED_AMOUNT = int(NEW_TOKEN_SUPPLY * TREASURY_LP_SEED_PERCENT)      # 5,000,000
TREASURY_NFT_AIRDROP_AMOUNT = int(NEW_TOKEN_SUPPLY * TREASURY_NFT_AIRDROP_PERCENT)  # 5,000,000

# Groyper NFT collection
GROYPER_NFT_COLLECTION = "EQAmTVtgzf14BiZSvDFQgA3vY7Isey8sHB3nAtZQS-2Vs2hw"
GROYPER_NFT_SUPPLY = 271
GROYPER_AIRDROP_PER_NFT = 18_450        # 5,000,000 / 271 ≈ 18,450

# PHX holder boost tiers
PHX_BOOST_TIER1_MIN = 5_000_000     # 0.5% of 1B supply
PHX_BOOST_TIER1_BONUS = 0.05        # +5% NEWTOKEN
PHX_BOOST_TIER2_MIN = 10_000_000    # 1% of 1B supply
PHX_BOOST_TIER2_BONUS = 0.10        # +10% NEWTOKEN

# --- Topblast launchpad (formerly Groypad) ---
# Factory v4: EQAmkd4Pd_xgUW4b9MLrygf0SOfR2EUVa_iCtVWGnYB2hItG
TOPBLAST_GRADUATION_GRAM = 1500          # raised on the curve to graduate
TOPBLAST_MIGRATION_FEE_GRAM = 50         # charged on graduation, on top of the raise
TOPBLAST_CURVE_SUPPLY_PERCENT = 0.70     # share of supply sold on the curve
TOPBLAST_TOTAL_SUPPLY = 1_000_000_000
TOPBLAST_MAX_CURVE_SUPPLY = int(TOPBLAST_TOTAL_SUPPLY * TOPBLAST_CURVE_SUPPLY_PERCENT)  # 700M

# Trade fee is creator-selected. Topblast offers 0.25%/1%/3%; Phoenix migrations
# are restricted to the two tiers that pay meaningful creator rewards, since
# those rewards are what fund the new community's LP owner.
TOPBLAST_FEE_TIERS = {
    0.01: 0.0035,   # 1% trade fee → 0.35% creator rewards
    0.03: 0.011,    # 3% trade fee → 1.10% creator rewards
}
TOPBLAST_DEFAULT_TRADE_FEE = 0.03

# Total GRAM the agent must spend to graduate a token, fee included.
FULL_LAUNCH_COST_GRAM = TOPBLAST_GRADUATION_GRAM + TOPBLAST_MIGRATION_FEE_GRAM  # 1550

KNOWN_BURN_ADDRESSES = [
    "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADl",
]

_extra_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
] + _extra_origins
