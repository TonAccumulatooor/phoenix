export interface Migration {
  id: string;
  old_token: {
    address: string;
    name: string | null;
    symbol: string | null;
    total_supply: number;
  };
  new_token: {
    address: string | null;
    name: string | null;
    symbol: string | null;
  };
  status: MigrationStatus;
  proposer_wallet: string;
  circulating_supply: number | null;
  threshold_amount: number | null;
  total_deposited: number;
  total_topup_ton: number;
  progress_percent: number;
  base_ratio: number | null;
  deposit_deadline: string;
  late_claim_deadline: string | null;
  qualified_at: string | null;
  lp_estimation_ton: number | null;
  extracted_ton: number | null;
  dev_buy_ton: number | null;
  agent_supply: number | null;
  creator_reward_wallet: string | null;
  holder_count: number;
  depositor_count: number;
  created_at: string;
}

export type MigrationStatus =
  | 'proposed'
  | 'depositing'
  | 'qualified'
  | 'selling'
  | 'launching'
  | 'distributing'
  | 'late_claims'
  | 'voting'
  | 'closed'
  | 'failed';

export interface MigrationListItem {
  id: string;
  old_token_symbol: string | null;
  old_token_name: string | null;
  status: MigrationStatus;
  progress_percent: number;
  total_deposited: number;
  threshold_amount: number | null;
  deposit_deadline: string;
  lp_estimation_ton: number | null;
  created_at: string;
}

export interface WalletAllocation {
  wallet_address: string;
  snapshot_balance: number;
  is_og: boolean;
  deposited: number;
  tier1_amount: number;
  tier1plus_amount: number;
  tier2_amount: number;
  topup_ton: number;
  has_topup: boolean;
  base_ratio: number;
  newmeme_from_tier1: number;
  newmeme_from_tier1plus: number;
  newmeme_from_tier2: number;
  newmeme_subtotal: number;
  topup_bonus: number;
  phx_boost: number;
  phx_boost_pct: number;
  phx_balance: number;
  newmeme_total: number;
}

export interface LPEstimation {
  estimated_extraction_ton: number;
  slippage_estimate_percent: number;
  dev_buy_assessment: string;
  recommended_topup_ton: number;
  token_price_ton: number;
  pool_ton_reserve: number;
  pool_token_reserve: number;
  dex: string | null;
}

export interface DevBuyEstimate {
  ton_input: number;
  effective_ton: number;
  tokens_acquired: number;
  supply_percent: number;
  fee_ton: number;
  graduates: boolean;
  graduation_progress_percent: number;
}

export interface PreviewResult {
  token: {
    name: string;
    symbol: string;
    total_supply: number;
    holders: number;
    image: string | null;
  };
  circulating_supply: number;
  circulating_percent: number;
  excluded_addresses: {
    address: string;
    balance: number;
    percent: number;
    reason: string;
    name: string | null;
  }[];
  threshold_amount: number;
  base_ratio: number;
  lp_estimation: LPEstimation;
  agent_supply: number;
  dev_buy_estimate: DevBuyEstimate;
  new_token_supply: number;
  examples: {
    tier1_holder_1000: number;
    tier1plus_holder_1000: number;
    tier2_holder_1000: number;
    tier3_late_1000: number;
  };
}

export interface VoteResult {
  candidate_wallet: string;
  total_weight: number;
  vote_count: number;
  percent: number;
}

export interface PlatformStats {
  total_migrations: number;
  active_migrations: number;
  successful_migrations: number;
  total_tokens_deposited: number;
  wallets_served: number;
  total_ton_extracted: number;
}
