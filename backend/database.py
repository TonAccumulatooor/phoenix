import aiosqlite
from config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS migrations (
    id TEXT PRIMARY KEY,
    old_token_address TEXT NOT NULL,
    old_token_name TEXT,
    old_token_symbol TEXT,
    old_token_decimals INTEGER DEFAULT 9,
    old_token_total_supply REAL NOT NULL,
    new_token_address TEXT,
    new_token_name TEXT,
    new_token_symbol TEXT,
    new_token_description TEXT,
    new_token_image TEXT,
    new_token_socials TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',
    proposer_wallet TEXT NOT NULL,
    proposal_fee_tx TEXT,
    proposal_fee_type TEXT,
    snapshot_time TEXT NOT NULL,
    deposit_deadline TEXT NOT NULL,
    late_claim_deadline TEXT,
    circulating_supply REAL,
    threshold_amount REAL,
    total_deposited REAL DEFAULT 0,
    total_topup_ton REAL DEFAULT 0,
    extracted_ton REAL,
    dev_buy_ton REAL,
    agent_supply REAL,
    base_ratio REAL,
    creator_reward_wallet TEXT,
    creator_fee_wallet TEXT,
    lp_estimation_ton REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    balance REAL NOT NULL,
    FOREIGN KEY (migration_id) REFERENCES migrations(id),
    UNIQUE(migration_id, wallet_address)
);

CREATE TABLE IF NOT EXISTS excluded_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id TEXT NOT NULL,
    address TEXT NOT NULL,
    reason TEXT NOT NULL,
    balance REAL NOT NULL,
    FOREIGN KEY (migration_id) REFERENCES migrations(id)
);

CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    amount REAL NOT NULL,
    tier1_amount REAL DEFAULT 0,
    tier1plus_amount REAL DEFAULT 0,
    tier2_amount REAL DEFAULT 0,
    tx_hash TEXT,
    deposited_at TEXT NOT NULL,
    FOREIGN KEY (migration_id) REFERENCES migrations(id)
);

CREATE TABLE IF NOT EXISTS topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    ton_amount REAL NOT NULL,
    tx_hash TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (migration_id) REFERENCES migrations(id)
);

CREATE TABLE IF NOT EXISTS distributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    tier TEXT NOT NULL,
    deposit_amount REAL NOT NULL,
    newmeme_base REAL NOT NULL,
    newmeme_topup_bonus REAL DEFAULT 0,
    newmeme_total REAL NOT NULL,
    phoenix_airdrop REAL DEFAULT 0,
    pro_rata_scale REAL DEFAULT 1.0,
    tx_hash TEXT,
    distributed_at TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (migration_id) REFERENCES migrations(id)
);

CREATE TABLE IF NOT EXISTS late_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    amount REAL NOT NULL,
    newmeme_allocated REAL NOT NULL,
    tx_hash_deposit TEXT,
    tx_hash_distribution TEXT,
    claimed_at TEXT NOT NULL,
    distributed_at TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (migration_id) REFERENCES migrations(id)
);

CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id TEXT NOT NULL,
    voter_wallet TEXT NOT NULL,
    candidate_wallet TEXT NOT NULL,
    vote_weight REAL NOT NULL,
    voted_at TEXT NOT NULL,
    FOREIGN KEY (migration_id) REFERENCES migrations(id),
    UNIQUE(migration_id, voter_wallet)
);

CREATE TABLE IF NOT EXISTS nft_airdrops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    nft_count INTEGER NOT NULL,
    airdrop_amount REAL NOT NULL,
    tx_hash TEXT,
    distributed_at TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (migration_id) REFERENCES migrations(id)
);

CREATE INDEX IF NOT EXISTS idx_nft_airdrops_migration ON nft_airdrops(migration_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_migration ON snapshots(migration_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_wallet ON snapshots(wallet_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_tx ON deposits(migration_id, tx_hash);
CREATE INDEX IF NOT EXISTS idx_deposits_migration ON deposits(migration_id);
CREATE INDEX IF NOT EXISTS idx_deposits_wallet ON deposits(wallet_address);
CREATE INDEX IF NOT EXISTS idx_distributions_migration ON distributions(migration_id);
CREATE INDEX IF NOT EXISTS idx_distributions_wallet ON distributions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_late_claims_migration ON late_claims(migration_id);
CREATE INDEX IF NOT EXISTS idx_votes_migration ON votes(migration_id);

CREATE TABLE IF NOT EXISTS monitor_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    db = await get_db()
    await db.executescript(SCHEMA)
    await db.commit()
    await db.close()
