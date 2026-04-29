const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

async function uploadFile(path: string, file: File): Promise<{ url: string; filename: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Upload failed');
  }
  return res.json();
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  uploadImage: (file: File) => uploadFile('/upload/image', file),

  stats: () => request<{
    total_migrations: number;
    active_migrations: number;
    successful_migrations: number;
    total_tokens_deposited: number;
  }>('/stats'),

  previewMigration: (tokenAddress: string) =>
    request(`/calculator/preview/${tokenAddress}`),

  proposeMigration: (data: {
    old_token_address: string;
    proposer_wallet: string;
    proposal_fee_tx: string;
    proposal_fee_type: string;
    new_token_name: string;
    new_token_symbol: string;
    new_token_description?: string;
    new_token_image?: string;
    socials?: {
      telegram?: string;
      twitter?: string;
      website?: string;
    };
    creator_fee_wallet?: string;
  }) => request('/migrations/propose', { method: 'POST', body: JSON.stringify(data) }),

  getMigration: (id: string) => request(`/migrations/${id}`),

  listMigrations: (params?: { status?: string; limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.offset) search.set('offset', String(params.offset));
    const qs = search.toString();
    return request(`/migrations/${qs ? `?${qs}` : ''}`);
  },

  submitDeposit: (data: {
    migration_id: string;
    wallet_address: string;
    amount: number;
    tx_hash: string;
  }) => request('/deposits/', { method: 'POST', body: JSON.stringify(data) }),

  submitTopup: (data: {
    migration_id: string;
    wallet_address: string;
    ton_amount: number;
    tx_hash: string;
  }) => request('/deposits/topup', { method: 'POST', body: JSON.stringify(data) }),

  submitLateClaim: (data: {
    migration_id: string;
    wallet_address: string;
    amount: number;
    tx_hash: string;
  }) => request('/deposits/late-claim', { method: 'POST', body: JSON.stringify(data) }),

  getWalletDeposits: (migrationId: string, wallet: string) =>
    request(`/deposits/${migrationId}/wallet/${wallet}`),

  getAllDeposits: (migrationId: string) =>
    request(`/deposits/${migrationId}/all`),

  getWalletAllocation: (migrationId: string, wallet: string) =>
    request(`/calculator/allocation/${migrationId}/${wallet}`),

  getDistributions: (migrationId: string) =>
    request(`/calculator/distributions/${migrationId}`),

  castVote: (data: {
    migration_id: string;
    voter_wallet: string;
    candidate_wallet: string;
  }) => request('/votes/', { method: 'POST', body: JSON.stringify(data) }),

  getVoteResults: (migrationId: string) =>
    request(`/votes/${migrationId}/results`),

  getJettonWalletAddress: (jettonMaster: string, ownerWallet: string) =>
    request<{ jetton_wallet_address: string }>(
      `/calculator/jetton-wallet/${jettonMaster}/${ownerWallet}`
    ),

  getJettonBalance: (jettonMaster: string, ownerWallet: string) =>
    request<{ balance: number }>(
      `/calculator/jetton-balance/${jettonMaster}/${ownerWallet}`
    ),

  checkNftOwnership: (wallet: string) =>
    request<{
      wallet_address: string;
      holds_groyper_nft: boolean;
      nft_count: number;
      fee_waived: boolean;
    }>(`/migrations/check-nft/${wallet}`),
};
