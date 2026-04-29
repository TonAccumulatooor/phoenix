import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { api } from '../lib/api';
import { useTonTransactions } from '../hooks/useTonTransactions';
import { ProgressBar } from '../components/ProgressBar';
import {
  formatNumber,
  formatDate,
  timeRemaining,
  statusLabel,
  statusColor,
} from '../lib/utils';
import {
  Users,
  Coins,
  AlertTriangle,
  ArrowDown,
  Loader2,
  CheckCircle,
  Send,
  Zap,
} from 'lucide-react';
import type { Migration, WalletAllocation } from '../types';

export function MigrationDashboard() {
  const { id } = useParams<{ id: string }>();
  const walletAddress = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const { sendJettonDeposit, sendTonTopup } = useTonTransactions();

  const [migration, setMigration] = useState<Migration | null>(null);
  const [allocation, setAllocation] = useState<WalletAllocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState('');
  const [topupAmount, setTopupAmount] = useState('');
  const [walletTokenBalance, setWalletTokenBalance] = useState<number | null>(null);
  const [txStatus, setTxStatus] = useState<{ type: 'deposit' | 'topup'; state: 'sending' | 'success' | 'error'; msg?: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    loadMigration();
  }, [id]);

  useEffect(() => {
    if (!id || !walletAddress) return;
    loadAllocation();
  }, [id, walletAddress]);

  useEffect(() => {
    if (!migration || !walletAddress) return;
    api.getJettonBalance(migration.old_token.address, walletAddress)
      .then(({ balance }) => setWalletTokenBalance(balance))
      .catch(() => setWalletTokenBalance(null));
  }, [migration?.old_token?.address, walletAddress]);

  async function loadMigration() {
    try {
      const data: any = await api.getMigration(id!);
      setMigration(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadAllocation() {
    try {
      const data: any = await api.getWalletAllocation(id!, walletAddress);
      setAllocation(data);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeposit() {
    if (!migration || !walletAddress || !depositAmount) return;
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;

    setTxStatus({ type: 'deposit', state: 'sending' });
    try {
      // Fetch the user's jetton wallet address for this token
      const { jetton_wallet_address } = await api.getJettonWalletAddress(
        migration.old_token.address,
        walletAddress,
      );
      const result = await sendJettonDeposit(
        jetton_wallet_address,
        amount,
        9, // decimals — migration could expose this; default 9
        migration.id,
      );
      if (result.success) {
        setTxStatus({ type: 'deposit', state: 'success' });
        setDepositAmount('');
        setTimeout(() => { loadMigration(); loadAllocation(); }, 3000);
      } else {
        setTxStatus({ type: 'deposit', state: 'error', msg: result.error });
      }
    } catch (e: any) {
      setTxStatus({ type: 'deposit', state: 'error', msg: e.message });
    }
  }

  async function handleTopup() {
    if (!migration || !walletAddress || !topupAmount) return;
    const amount = parseFloat(topupAmount);
    if (isNaN(amount) || amount <= 0) return;

    setTxStatus({ type: 'topup', state: 'sending' });
    const result = await sendTonTopup(amount, migration.id);
    if (result.success) {
      setTxStatus({ type: 'topup', state: 'success' });
      setTopupAmount('');
      setTimeout(() => { loadMigration(); loadAllocation(); }, 3000);
    } else {
      setTxStatus({ type: 'topup', state: 'error', msg: result.error });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-ember-500" />
      </div>
    );
  }

  if (!migration) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <AlertTriangle size={48} className="text-pyre mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-white">Migration Not Found</h2>
      </div>
    );
  }

  const isDepositing = migration.status === 'depositing';
  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-white">
                {migration.old_token.symbol || 'Unknown'}
              </h1>
              <span className="text-ash-500">→</span>
              <span className="text-xl font-bold phoenix-gradient-text">
                {migration.new_token.symbol || 'NEW' + migration.old_token.symbol}
              </span>
            </div>
            <p className="text-ash-400">
              {migration.old_token.name}
            </p>
          </div>
          <div
            className={`text-sm font-semibold px-4 py-2 rounded-full border ${statusColor(
              migration.status
            )} ${
              migration.status === 'closed'
                ? 'border-emerald-500/30 bg-emerald-500/10'
                : 'border-ember-500/30 bg-ember-500/10'
            }`}
          >
            {statusLabel(migration.status)}
          </div>
        </div>

        {/* Progress */}
        <div className="phoenix-card-glow p-6 mb-6">
          <ProgressBar
            percent={migration.progress_percent}
            label="Vault Deposit Progress — 51% required"
            size="lg"
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div>
              <div className="text-xs text-ash-500">Deposited</div>
              <div className="font-mono text-white">
                {formatNumber(migration.total_deposited)}
              </div>
            </div>
            <div>
              <div className="text-xs text-ash-500">Threshold</div>
              <div className="font-mono text-white">
                {formatNumber(migration.threshold_amount || 0)}
              </div>
            </div>
            <div>
              <div className="text-xs text-ash-500">Circulating</div>
              <div className="font-mono text-white">
                {formatNumber(migration.circulating_supply || 0)}
              </div>
            </div>
            <div>
              <div className="text-xs text-ash-500">Time Remaining</div>
              <div className="font-mono text-white">
                {timeRemaining(migration.deposit_deadline)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Migration Details */}
          <div className="phoenix-card p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Coins size={18} className="text-ember-500" />
              Migration Details
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-ash-400">Base Ratio</span>
                <span className="font-mono text-white">
                  1:{parseFloat((migration.base_ratio ?? 0).toFixed(6))}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ash-400">Old Supply</span>
                <span className="font-mono text-white">
                  {Math.round(migration.old_token.total_supply).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ash-400">New Supply</span>
                <span className="font-mono text-white">1,000,000,000</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ash-400">Est. LP Extraction</span>
                <span className="font-mono text-white">
                  {migration.lp_estimation_ton
                    ? `~${formatNumber(migration.lp_estimation_ton)} TON`
                    : 'Pending'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ash-400">Community Top-ups</span>
                <span className="font-mono text-white">
                  {migration.total_topup_ton} TON
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ash-400">Holders Snapshotted</span>
                <span className="font-mono text-white">{migration.holder_count}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ash-400">Depositors</span>
                <span className="font-mono text-white">{migration.depositor_count}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ash-400">Proposed</span>
                <span className="text-ash-300">{formatDate(migration.created_at)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ash-400">Deadline</span>
                <span className="text-ash-300">{formatDate(migration.deposit_deadline)}</span>
              </div>
            </div>
          </div>

          {/* Your Allocation / Deposit */}
          <div className="phoenix-card-glow p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Users size={18} className="text-ember-500" />
              Your Position
            </h2>

            {!walletAddress ? (
              <div className="text-center py-8">
                <p className="text-ash-400 mb-4">Connect your wallet to see your allocation</p>
              </div>
            ) : allocation ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-ash-400">Snapshot Balance</span>
                  <span className="font-mono text-white">
                    {formatNumber(allocation.snapshot_balance)}{' '}
                    <span className={allocation.is_og ? 'text-emerald-400' : 'text-ash-500'}>
                      {allocation.is_og ? '(OG)' : '(Non-OG)'}
                    </span>
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-ash-400">Deposited</span>
                  <span className="font-mono text-white">
                    {formatNumber(allocation.deposited)}
                  </span>
                </div>
                {allocation.tier1_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-400">Tier 1 (1.0x)</span>
                    <span className="font-mono text-white">
                      {formatNumber(allocation.newmeme_from_tier1)}
                    </span>
                  </div>
                )}
                {allocation.tier1plus_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-400">Tier 1+ (0.75x)</span>
                    <span className="font-mono text-white">
                      {formatNumber(allocation.newmeme_from_tier1plus)}
                    </span>
                  </div>
                )}
                {allocation.tier2_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-orange-400">Tier 2 (0.75x)</span>
                    <span className="font-mono text-white">
                      {formatNumber(allocation.newmeme_from_tier2)}
                    </span>
                  </div>
                )}
                {allocation.has_topup && (
                  <div className="flex justify-between text-sm">
                    <span className="text-blue-400">Top-up Bonus (+10%)</span>
                    <span className="font-mono text-white">
                      {formatNumber(allocation.topup_bonus)}
                    </span>
                  </div>
                )}
                {allocation.phx_boost > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-400">PHX Holder Boost (+{Math.round(allocation.phx_boost_pct * 100)}%)</span>
                    <span className="font-mono text-white">
                      {formatNumber(allocation.phx_boost)}
                    </span>
                  </div>
                )}
                <div className="border-t border-ash-700/50 pt-3 flex justify-between">
                  <span className="text-white font-semibold">Total New {migration.old_token.symbol}</span>
                  <span className="font-mono text-lg font-bold phoenix-gradient-text">
                    {formatNumber(allocation.newmeme_total)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-ash-500 text-sm">No deposits found for your wallet</p>
            )}

            {/* Deposit Action */}
            {isDepositing && (
              <div className="mt-6 pt-6 border-t border-ash-700/50">
                {!walletAddress ? (
                  <button
                    onClick={() => tonConnectUI.openModal()}
                    className="phoenix-button w-full text-sm"
                  >
                    Connect Wallet to Deposit
                  </button>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm text-ash-400 mb-3">
                      <ArrowDown size={14} />
                      Deposit {migration.old_token.symbol} into the vault
                    </div>
                    {walletTokenBalance !== null && walletTokenBalance > 0 && (
                      <div className="text-xs text-ash-500 mb-1">
                        Wallet balance: {formatNumber(walletTokenBalance)} {migration.old_token.symbol}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type="number"
                          value={depositAmount}
                          onChange={(e) => setDepositAmount(e.target.value)}
                          placeholder={`${migration.old_token.symbol} amount`}
                          className="phoenix-input text-sm w-full pr-14"
                          min="0"
                        />
                        {walletTokenBalance !== null && walletTokenBalance > 0 && (
                          <button
                            type="button"
                            onClick={() => setDepositAmount(String(walletTokenBalance))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-ember-400 hover:text-ember-300 transition-colors"
                          >
                            MAX
                          </button>
                        )}
                      </div>
                      <button
                        onClick={handleDeposit}
                        disabled={txStatus?.type === 'deposit' && txStatus.state === 'sending'}
                        className="phoenix-button text-sm px-4 flex items-center gap-2 disabled:opacity-50"
                      >
                        {txStatus?.type === 'deposit' && txStatus.state === 'sending' ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Send size={14} />
                        )}
                        Deposit
                      </button>
                    </div>
                    {txStatus?.type === 'deposit' && txStatus.state === 'success' && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-emerald-400">
                        <CheckCircle size={14} /> Transaction sent — updating shortly
                      </div>
                    )}
                    {txStatus?.type === 'deposit' && txStatus.state === 'error' && txStatus.msg !== 'Cancelled' && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-pyre">
                        <AlertTriangle size={14} /> {txStatus.msg}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Top-up Action */}
            {(isDepositing || migration.status === 'qualified') && walletAddress && (
              <div className="mt-4 pt-4 border-t border-ash-700/50">
                <p className="text-xs text-ash-500 mb-2">
                  Contribute TON to boost the dev buy (+10% bonus on your allocation)
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                    placeholder="TON amount"
                    className="phoenix-input text-sm flex-1"
                    min="0"
                  />
                  <button
                    onClick={handleTopup}
                    disabled={txStatus?.type === 'topup' && txStatus.state === 'sending'}
                    className="phoenix-button text-sm px-4 flex items-center gap-2 disabled:opacity-50"
                  >
                    {txStatus?.type === 'topup' && txStatus.state === 'sending' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Zap size={14} />
                    )}
                    Top Up
                  </button>
                </div>
                {txStatus?.type === 'topup' && txStatus.state === 'success' && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-emerald-400">
                    <CheckCircle size={14} /> Top-up sent — thank you!
                  </div>
                )}
                {txStatus?.type === 'topup' && txStatus.state === 'error' && txStatus.msg !== 'Cancelled' && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-pyre">
                    <AlertTriangle size={14} /> {txStatus.msg}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
