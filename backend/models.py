from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class MigrationStatus(str, Enum):
    PROPOSED = "proposed"
    DEPOSITING = "depositing"
    QUALIFIED = "qualified"
    SELLING = "selling"
    LAUNCHING = "launching"
    DISTRIBUTING = "distributing"
    LATE_CLAIMS = "late_claims"
    VOTING = "voting"
    CLOSED = "closed"
    FAILED = "failed"


class Tier(str, Enum):
    TIER1 = "tier1"
    TIER1_PLUS = "tier1plus"
    TIER2 = "tier2"
    TIER3 = "tier3"


class SocialLinks(BaseModel):
    telegram: Optional[str] = None
    twitter: Optional[str] = None
    website: Optional[str] = None


class ProposeRequest(BaseModel):
    old_token_address: str
    proposer_wallet: str
    proposal_fee_tx: str
    proposal_fee_type: str = Field(pattern="^(TON|PHOENIX|PHX|NFT_WAIVER)$")
    new_token_name: Optional[str] = None
    new_token_symbol: Optional[str] = None
    new_token_description: Optional[str] = None
    new_token_image: Optional[str] = None
    socials: Optional[SocialLinks] = None
    creator_fee_wallet: Optional[str] = None


class DepositRecord(BaseModel):
    migration_id: str
    wallet_address: str
    amount: float
    tx_hash: str


class TopupRecord(BaseModel):
    migration_id: str
    wallet_address: str
    ton_amount: float
    tx_hash: str


class LateClaimRecord(BaseModel):
    migration_id: str
    wallet_address: str
    amount: float
    tx_hash: str


class VoteRequest(BaseModel):
    migration_id: str
    voter_wallet: str
    candidate_wallet: str


class MigrationSummary(BaseModel):
    id: str
    old_token_name: Optional[str]
    old_token_symbol: Optional[str]
    old_token_address: str
    new_token_address: Optional[str]
    new_token_symbol: Optional[str]
    status: str
    circulating_supply: Optional[float]
    threshold_amount: Optional[float]
    total_deposited: float
    deposit_deadline: str
    late_claim_deadline: Optional[str]
    lp_estimation_ton: Optional[float]
    base_ratio: Optional[float]
    progress_percent: float
    created_at: str


class HolderAllocation(BaseModel):
    wallet_address: str
    snapshot_balance: Optional[float]
    deposit_amount: float
    tier1_amount: float
    tier1plus_amount: float
    tier2_amount: float
    base_ratio: float
    newmeme_from_tier1: float
    newmeme_from_tier1plus: float
    newmeme_from_tier2: float
    topup_bonus_percent: float
    newmeme_subtotal: float
    newmeme_total: float
    pro_rata_scale: float
    phoenix_airdrop: float


class LPEstimation(BaseModel):
    old_token_address: str
    pool_ton_balance: float
    pool_token_balance: float
    estimated_extraction_ton: float
    slippage_estimate_percent: float
    dev_buy_assessment: str
    recommended_topup_ton: float


class VoteResult(BaseModel):
    candidate_wallet: str
    total_weight: float
    vote_count: int
    percent: float
