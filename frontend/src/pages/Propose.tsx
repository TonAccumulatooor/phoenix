import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { api } from '../lib/api';
import { formatNumber, assessmentLabel, shortenAddress } from '../lib/utils';
import {
  Search,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ArrowRight,
  Rocket,
  TrendingUp,
  SlidersHorizontal,
  Flame,
  Lock,
  Target,
  Feather,
  Image,
  Globe,
  MessageCircle,
  Upload,
  Link,
  Crown,
} from 'lucide-react';

const GROYPAD_GRADUATION_TON = 1050;
const GROYPAD_MAX_CURVE_SUPPLY = 760_000_000;
const GROYPAD_TOTAL_SUPPLY = 1_000_000_000;
const GROYPAD_TRADE_FEE = 0.03;

function calcLpExtraction(
  depositAmount: number,
  poolTonReserve: number,
  poolTokenReserve: number,
  tradeFee: number,
) {
  if (poolTonReserve <= 0 || poolTokenReserve <= 0) {
    return { tonExtracted: 0, slippage: 100, naiveValue: 0 };
  }
  const spotPrice = poolTonReserve / poolTokenReserve;
  const naiveValue = depositAmount * spotPrice;
  const effectiveDeposit = depositAmount * (1 - tradeFee);
  const k = poolTonReserve * poolTokenReserve;
  const newTokenBalance = poolTokenReserve + effectiveDeposit;
  const newTonBalance = k / newTokenBalance;
  const tonExtracted = Math.max(0, poolTonReserve - newTonBalance);
  const slippage = naiveValue > 0 ? ((naiveValue - tonExtracted) / naiveValue) * 100 : 0;
  return { tonExtracted, slippage, naiveValue };
}

function calcDevBuy(tonAmount: number) {
  const effectiveTon = tonAmount * (1 - GROYPAD_TRADE_FEE);
  if (effectiveTon <= 0) {
    return { tokensAcquired: 0, supplyPercent: 0, effectiveTon: 0, feeTon: 0, graduates: false, gradProgress: 0 };
  }
  const capped = Math.min(effectiveTon, GROYPAD_GRADUATION_TON);
  const tokens = GROYPAD_MAX_CURVE_SUPPLY * Math.sqrt(capped / GROYPAD_GRADUATION_TON);
  return {
    tokensAcquired: tokens,
    supplyPercent: (tokens / GROYPAD_TOTAL_SUPPLY) * 100,
    effectiveTon,
    feeTon: tonAmount * GROYPAD_TRADE_FEE,
    graduates: tonAmount >= GROYPAD_GRADUATION_TON,
    gradProgress: Math.min(100, (tonAmount / GROYPAD_GRADUATION_TON) * 100),
  };
}

function getAssessment(tonExtracted: number) {
  if (tonExtracted >= GROYPAD_GRADUATION_TON) return 'full_launch';
  if (tonExtracted >= GROYPAD_GRADUATION_TON * 0.5) return 'flexible_launch';
  if (tonExtracted >= 200) return 'minimum_viable';
  if (tonExtracted > 0) return 'unlikely';
  return 'no_liquidity';
}

function calcViabilityScore(
  circulatingPercent: number,
  poolTonReserve: number,
  tonExtracted: number,
  holderCount: number,
) {
  let circScore: number;
  if (circulatingPercent >= 80) circScore = 25;
  else if (circulatingPercent >= 60) circScore = 15 + ((circulatingPercent - 60) / 20) * 10;
  else if (circulatingPercent >= 40) circScore = 8 + ((circulatingPercent - 40) / 20) * 7;
  else if (circulatingPercent >= 20) circScore = (circulatingPercent - 20) / 20 * 8;
  else circScore = 0;

  let liqScore: number;
  if (poolTonReserve <= 0) liqScore = 0;
  else if (poolTonReserve < 100) liqScore = 3;
  else if (poolTonReserve < 300) liqScore = 8;
  else if (poolTonReserve < 500) liqScore = 12;
  else if (poolTonReserve < 1050) liqScore = 16;
  else if (poolTonReserve < 3000) liqScore = 25;
  else if (poolTonReserve < 10000) liqScore = 22;
  else liqScore = 18;

  let gradScore: number;
  if (tonExtracted >= 1050) gradScore = 30;
  else if (tonExtracted > 0) gradScore = (tonExtracted / 1050) * 28;
  else gradScore = 0;

  let commScore: number;
  if (holderCount >= 1000) commScore = 20;
  else if (holderCount >= 500) commScore = 17;
  else if (holderCount >= 200) commScore = 14;
  else if (holderCount >= 100) commScore = 11;
  else if (holderCount >= 50) commScore = 8;
  else if (holderCount >= 20) commScore = 5;
  else commScore = 2;

  const total = Math.min(100, Math.round(circScore + liqScore + gradScore + commScore));

  return {
    total,
    breakdown: [
      { label: 'Circulating Supply', score: Math.round(circScore), max: 25 },
      { label: 'Pool Liquidity', score: Math.round(liqScore), max: 25 },
      { label: 'Graduation Potential', score: Math.round(gradScore), max: 30 },
      { label: 'Community Size', score: Math.round(commScore), max: 20 },
    ],
  };
}

function getGrade(score: number) {
  if (score >= 80) return { grade: 'A', label: 'Excellent Candidate', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' };
  if (score >= 65) return { grade: 'B', label: 'Strong Candidate', color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/30' };
  if (score >= 50) return { grade: 'C', label: 'Viable With Top-up', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' };
  if (score >= 35) return { grade: 'D', label: 'Challenging', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' };
  return { grade: 'F', label: 'Poor Candidate', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' };
}

function getWeakestInsight(breakdown: { label: string; score: number; max: number }[]) {
  let weakest = breakdown[0];
  let weakestPct = breakdown[0].score / breakdown[0].max;
  for (const b of breakdown) {
    const pct = b.score / b.max;
    if (pct < weakestPct) {
      weakest = b;
      weakestPct = pct;
    }
  }
  const insights: Record<string, string> = {
    'Circulating Supply': 'Most supply is locked in LP/contracts — less available for vault deposits.',
    'Pool Liquidity': 'Pool lacks sufficient TON depth — extraction will be limited.',
    'Graduation Potential': 'Extracted TON unlikely to fund full Groypad graduation without community top-up.',
    'Community Size': 'Small holder base may struggle to reach 51% deposit threshold.',
  };
  return insights[weakest.label];
}

function barColor(score: number, max: number) {
  const pct = score / max;
  if (pct >= 0.75) return 'bg-emerald-400';
  if (pct >= 0.5) return 'bg-sky-400';
  if (pct >= 0.3) return 'bg-amber-400';
  return 'bg-red-400';
}

export function Propose() {
  const navigate = useNavigate();
  const [tonConnectUI] = useTonConnectUI();
  const walletAddress = useTonAddress();
  const [tokenAddress, setTokenAddress] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanPhrase, setScanPhrase] = useState('');
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState('');
  const [depositPct, setDepositPct] = useState(51);

  // New token metadata
  const [newName, setNewName] = useState('');
  const [newSymbol, setNewSymbol] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [imageMode, setImageMode] = useState<'url' | 'upload'>('url');
  const [uploading, setUploading] = useState(false);
  const [socialTelegram, setSocialTelegram] = useState('');
  const [socialTwitter, setSocialTwitter] = useState('');
  const [socialWebsite, setSocialWebsite] = useState('');
  const [creatorFeeWallet, setCreatorFeeWallet] = useState('');

  // Groyper NFT fee waiver check
  const [nftHolder, setNftHolder] = useState<{ holds: boolean; count: number } | null>(null);
  const [, setNftChecking] = useState(false);

  // Cycle through scan phrases while loading
  useEffect(() => {
    if (!loading) { setScanPhrase(''); return; }
    const phrases = [
      'Scanning token contract...',
      'Fetching holder data...',
      'Analyzing circulating supply...',
      'Scouring DEX liquidity pools...',
      'Calculating extraction estimates...',
      'Evaluating migration viability...',
      'Crunching the numbers...',
      'Almost there...',
    ];
    let i = 0;
    setScanPhrase(phrases[0]);
    const interval = setInterval(() => {
      i = Math.min(i + 1, phrases.length - 1);
      setScanPhrase(phrases[i]);
    }, 2500);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (!walletAddress) {
      setNftHolder(null);
      return;
    }
    let cancelled = false;
    setNftChecking(true);
    api.checkNftOwnership(walletAddress)
      .then((res) => {
        if (!cancelled) setNftHolder({ holds: res.holds_groyper_nft, count: res.nft_count });
      })
      .catch(() => {
        if (!cancelled) setNftHolder(null);
      })
      .finally(() => {
        if (!cancelled) setNftChecking(false);
      });
    return () => { cancelled = true; };
  }, [walletAddress]);

  async function handlePreview() {
    if (!tokenAddress.trim()) return;
    setLoading(true);
    setError('');
    setPreview(null);
    setDepositPct(51);
    try {
      const result: any = await api.previewMigration(tokenAddress.trim());
      setPreview(result);
      // Pre-populate metadata from old token
      setNewName(result.token.name ? `${result.token.name} Reborn` : '');
      setNewSymbol(result.token.symbol || '');
      setNewDescription('');
      setNewImageUrl(result.token.image || '');
      setSocialTelegram('');
      setSocialTwitter('');
      setSocialWebsite('');
      setCreatorFeeWallet('');
    } catch (e: any) {
      setError(e.message || 'Failed to fetch token info');
    } finally {
      setLoading(false);
    }
  }

  async function handlePropose() {
    if (!walletAddress) {
      tonConnectUI.openModal();
      return;
    }
    setProposing(true);
    setError('');
    try {
      const feeWaived = nftHolder?.holds === true;
      const result: any = await api.proposeMigration({
        old_token_address: tokenAddress.trim(),
        proposer_wallet: walletAddress,
        proposal_fee_tx: feeWaived ? 'nft_waiver' : 'pending_verification',
        proposal_fee_type: feeWaived ? 'NFT_WAIVER' : 'PHX',
        new_token_name: newName.trim(),
        new_token_symbol: newSymbol.trim(),
        new_token_description: newDescription.trim(),
        new_token_image: newImageUrl.trim(),
        socials: {
          telegram: socialTelegram.trim() || undefined,
          twitter: socialTwitter.trim() || undefined,
          website: socialWebsite.trim() || undefined,
        },
        creator_fee_wallet: creatorFeeWallet.trim() || undefined,
      });
      navigate(`/migration/${result.migration_id}`);
    } catch (e: any) {
      setError(e.message || 'Failed to propose migration');
    } finally {
      setProposing(false);
    }
  }

  const liveCalc = useMemo(() => {
    if (!preview) return null;
    const circ = preview.circulating_supply;
    const depositAmount = circ * (depositPct / 100);
    const poolTon = preview.lp_estimation.pool_ton_reserve || 0;
    const poolToken = preview.lp_estimation.pool_token_reserve || 0;
    const dexFee = preview.lp_estimation.dex ? (preview.lp_estimation.trade_fee || 0) : 0;

    const lp = calcLpExtraction(depositAmount, poolTon, poolToken, dexFee);
    const devBuy = calcDevBuy(lp.tonExtracted);
    const assessment = getAssessment(lp.tonExtracted);
    const topupNeeded = Math.max(0, GROYPAD_GRADUATION_TON - lp.tonExtracted);

    const viability = calcViabilityScore(
      preview.circulating_percent,
      poolTon,
      lp.tonExtracted,
      preview.token.holders,
    );

    return { depositAmount, lp, devBuy, assessment, topupNeeded, viability };
  }, [preview, depositPct]);

  const assessment = liveCalc ? assessmentLabel(liveCalc.assessment) : null;
  const grade = liveCalc ? getGrade(liveCalc.viability.total) : null;

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl md:text-4xl font-bold mb-2">
          Propose a <span className="phoenix-gradient-text">Migration</span>
        </h1>
        <p className="text-ash-400 mb-10">
          Enter a jetton contract address to preview the migration and launch a proposal.
        </p>

        {/* Token Input */}
        <div className="phoenix-card p-6 mb-6">
          <label className="block text-sm font-medium text-ash-300 mb-2">
            Old Token Jetton Address
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              placeholder="EQ... or 0:..."
              className="phoenix-input flex-1 font-mono text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handlePreview()}
            />
            <button
              onClick={handlePreview}
              disabled={loading || !tokenAddress.trim()}
              className="phoenix-button flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              Preview
            </button>
          </div>
          {loading && scanPhrase && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: 'linear-gradient(135deg, #ffd700, #ff6b00)' }}
              />
              <span className="text-ash-400 transition-opacity duration-300">{scanPhrase}</span>
            </div>
          )}
          {error && (
            <div className="mt-3 flex items-center gap-2 text-pyre text-sm">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* Preview Results */}
        {preview && liveCalc && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Token Info */}
            <div className="phoenix-card-glow p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
                {preview.token.image ? (
                  <img
                    src={preview.token.image}
                    alt={preview.token.symbol}
                    className="w-8 h-8 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <CheckCircle size={20} className="text-emerald-400" />
                )}
                {preview.token.symbol} — {preview.token.name}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-ash-500 mb-1">Total Supply</div>
                  <div className="font-mono text-white">
                    {formatNumber(preview.token.total_supply)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">Circulating Supply</div>
                  <div className="font-mono text-white">
                    {formatNumber(preview.circulating_supply)}
                  </div>
                  <div className="text-xs text-ash-500">
                    {preview.circulating_percent}% of total
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">Holders</div>
                  <div className="font-mono text-white">{preview.token.holders}</div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">51% Threshold</div>
                  <div className="font-mono text-white">
                    {formatNumber(preview.threshold_amount)}
                  </div>
                </div>
              </div>

              {/* Excluded addresses breakdown */}
              {preview.excluded_addresses?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-ash-700/50">
                  <p className="text-xs text-ash-500 mb-2">Excluded from circulating supply:</p>
                  <div className="space-y-1.5">
                    {preview.excluded_addresses.map((ex: any) => (
                      <div
                        key={ex.address}
                        className="flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          {ex.reason === 'burn' ? (
                            <Flame size={12} className="text-pyre" />
                          ) : (
                            <Lock size={12} className="text-amber-400" />
                          )}
                          <span className="text-ash-400 font-mono">
                            {ex.name || shortenAddress(ex.address, 6)}
                          </span>
                          <span className="text-ash-600">
                            {ex.reason === 'burn' ? 'burned' : 'contract/LP'}
                          </span>
                        </div>
                        <span className="font-mono text-ash-300">
                          {formatNumber(ex.balance)} ({ex.percent.toFixed(2)}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Migration Viability Score */}
            {grade && (
              <div className={`phoenix-card p-6 border ${grade.border}`}>
                <div className="flex items-start gap-5">
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={`w-20 h-20 rounded-full flex items-center justify-center border-2 ${grade.border} ${grade.bg}`}
                    >
                      <span className={`text-3xl font-bold font-mono ${grade.color}`}>
                        {liveCalc.viability.total}
                      </span>
                    </div>
                    <span className={`text-xs font-bold ${grade.color}`}>
                      {grade.grade}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Target size={16} className={grade.color} />
                      <h3 className={`text-lg font-semibold ${grade.color}`}>
                        {grade.label}
                      </h3>
                    </div>
                    <p className="text-xs text-ash-500 mb-4">
                      {getWeakestInsight(liveCalc.viability.breakdown)}
                    </p>
                    <div className="space-y-2">
                      {liveCalc.viability.breakdown.map((b) => (
                        <div key={b.label} className="flex items-center gap-3">
                          <span className="text-xs text-ash-400 w-36 shrink-0">
                            {b.label}
                          </span>
                          <div className="flex-1 h-2 bg-ash-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${barColor(b.score, b.max)}`}
                              style={{ width: `${(b.score / b.max) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-ash-500 w-10 text-right">
                            {b.score}/{b.max}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Deposit Slider */}
            <div className="phoenix-card-glow p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <SlidersHorizontal size={18} className="text-ember-500" />
                  Vault Deposit Scenario
                </h3>
                <div className="text-right">
                  <span className="text-2xl font-bold font-mono phoenix-gradient-text">
                    {depositPct}%
                  </span>
                  <span className="text-xs text-ash-500 ml-1">of circulating</span>
                </div>
              </div>
              <p className="text-xs text-ash-500 mb-4">
                51% is required to qualify. More deposits = more TON extracted = more NEWTOKEN supply
                controlled.
              </p>
              <input
                type="range"
                min={51}
                max={100}
                value={depositPct}
                onChange={(e) => setDepositPct(Number(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer accent-ember-500"
                style={{
                  background: `linear-gradient(to right, var(--color-ember-500) ${((depositPct - 51) / 49) * 100}%, var(--color-ash-700) ${((depositPct - 51) / 49) * 100}%)`,
                }}
              />
              <div className="flex justify-between text-xs text-ash-500 mt-1">
                <span>51% — {formatNumber(preview.circulating_supply * 0.51)} tokens</span>
                <span>100% — {formatNumber(preview.circulating_supply)} tokens</span>
              </div>
            </div>

            {/* LP Estimation */}
            <div className="phoenix-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">LP Extraction Estimate</h3>
                {preview.lp_estimation.dex && (
                  <span className="text-xs text-ash-500 bg-ash-800 px-2 py-1 rounded">
                    via {preview.lp_estimation.dex}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                <div>
                  <div className="text-xs text-ash-500 mb-1">Pool Liquidity</div>
                  <div className="font-mono text-white">
                    {formatNumber(Math.round((preview.lp_estimation.pool_ton_reserve || 0) * 100) / 100)} TON
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">Selling</div>
                  <div className="font-mono text-white">
                    {formatNumber(liveCalc.depositAmount)} {preview.token.symbol}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">Est. Extractable TON</div>
                  <div className="font-mono text-xl text-white">
                    {formatNumber(Math.round(liveCalc.lp.tonExtracted * 100) / 100)} TON
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">Slippage Estimate</div>
                  <div className="font-mono text-white">
                    {Math.round(liveCalc.lp.slippage * 10) / 10}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">Assessment</div>
                  <div className={`font-semibold ${assessment?.color}`}>{assessment?.label}</div>
                </div>
              </div>
              {liveCalc.topupNeeded > 0 && (
                <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  <AlertTriangle size={16} />
                  Community top-up of ~{formatNumber(Math.round(liveCalc.topupNeeded * 100) / 100)}{' '}
                  TON recommended for a full 1050 TON dev buy.
                </div>
              )}
            </div>

            {/* Groypad Dev Buy Estimate */}
            <div className="phoenix-card p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Rocket size={18} className="text-ember-500" />
                Groypad Dev Buy Estimate
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-xs text-ash-500 mb-1">TON Into Curve</div>
                  <div className="font-mono text-white">
                    {formatNumber(Math.round(liveCalc.devBuy.effectiveTon * 100) / 100)} TON
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">NEWTOKEN Acquired</div>
                  <div className="font-mono text-xl font-bold phoenix-gradient-text">
                    {formatNumber(Math.round(liveCalc.devBuy.tokensAcquired))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">Supply Controlled</div>
                  <div className="font-mono text-white">
                    {Math.round(liveCalc.devBuy.supplyPercent * 100) / 100}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ash-500 mb-1">Groypad Fee (3%)</div>
                  <div className="font-mono text-ash-400">
                    {formatNumber(Math.round(liveCalc.devBuy.feeTon * 100) / 100)} TON
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 phoenix-progress-track">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, liveCalc.devBuy.gradProgress)}%`,
                      background: liveCalc.devBuy.graduates
                        ? 'linear-gradient(to right, #10b981, #34d399)'
                        : 'linear-gradient(to right, var(--color-ember-600), var(--color-ember-400))',
                    }}
                  />
                </div>
                <span className="text-xs font-mono text-ash-400 whitespace-nowrap">
                  {Math.round(liveCalc.devBuy.gradProgress * 10) / 10}% of graduation
                </span>
              </div>
              {liveCalc.devBuy.graduates ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                  <TrendingUp size={16} />
                  Full graduation! Token will launch and migrate to DEX immediately.
                </div>
              ) : (
                <p className="mt-3 text-xs text-ash-500">
                  Based on Groypad's linear bonding curve (price = α + β·s). Dev buy is the first
                  purchase at launch — early buys get significantly more tokens per TON.
                </p>
              )}
            </div>

            {/* Conversion Preview */}
            <div className="phoenix-card p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Conversion Preview</h3>
              <div className="text-sm text-ash-400 mb-4">
                Base ratio:{' '}
                <span className="font-mono text-white">
                  1 {preview.token.symbol} = {preview.base_ratio.toFixed(6)} NEWTOKEN
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-ash-800/50 rounded-lg p-3">
                  <div className="text-xs text-emerald-400 mb-1">Tier 1 (1,000 tokens)</div>
                  <div className="font-mono text-white text-sm">
                    {formatNumber(preview.examples.tier1_holder_1000)}
                  </div>
                </div>
                <div className="bg-ash-800/50 rounded-lg p-3">
                  <div className="text-xs text-amber-400 mb-1">Tier 1+ (1,000 tokens)</div>
                  <div className="font-mono text-white text-sm">
                    {formatNumber(preview.examples.tier1plus_holder_1000)}
                  </div>
                </div>
                <div className="bg-ash-800/50 rounded-lg p-3">
                  <div className="text-xs text-orange-400 mb-1">Tier 2 (1,000 tokens)</div>
                  <div className="font-mono text-white text-sm">
                    {formatNumber(preview.examples.tier2_holder_1000)}
                  </div>
                </div>
                <div className="bg-ash-800/50 rounded-lg p-3">
                  <div className="text-xs text-ash-400 mb-1">Tier 3 (1,000 tokens)</div>
                  <div className="font-mono text-white text-sm">
                    {formatNumber(preview.examples.tier3_late_1000)}
                  </div>
                </div>
              </div>
            </div>

            {/* New Token Metadata */}
            <div className="phoenix-card-glow p-6">
              <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
                <Feather size={18} className="text-ember-500" />
                New Token Details
              </h3>
              <p className="text-xs text-ash-500 mb-5">
                Configure the reborn token's metadata for Groypad launch. Name and symbol are
                pre-filled from the original token.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-ash-400 mb-1.5">Token Name *</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Phoenix Reborn"
                    className="phoenix-input text-sm"
                    maxLength={64}
                  />
                </div>
                <div>
                  <label className="block text-xs text-ash-400 mb-1.5">Token Symbol *</label>
                  <input
                    type="text"
                    value={newSymbol}
                    onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                    placeholder="e.g. PHX"
                    className="phoenix-input text-sm font-mono"
                    maxLength={12}
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs text-ash-400 mb-1.5">Description</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="A short description of the reborn token and its community..."
                  className="phoenix-input text-sm min-h-[80px] resize-y"
                  maxLength={500}
                  rows={3}
                />
                <div className="text-right text-xs text-ash-600 mt-1">
                  {newDescription.length}/500
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-xs text-ash-400 mb-2 flex items-center gap-1.5">
                  <Image size={12} /> Token Logo
                </label>
                <div className="flex gap-1 mb-3">
                  <button
                    type="button"
                    onClick={() => setImageMode('url')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      imageMode === 'url'
                        ? 'bg-ember-500/15 text-ember-400 border border-ember-500/30'
                        : 'text-ash-500 border border-ash-700/50 hover:text-ash-300'
                    }`}
                  >
                    <Link size={12} /> URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageMode('upload')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      imageMode === 'upload'
                        ? 'bg-ember-500/15 text-ember-400 border border-ember-500/30'
                        : 'text-ash-500 border border-ash-700/50 hover:text-ash-300'
                    }`}
                  >
                    <Upload size={12} /> Upload
                  </button>
                </div>

                {imageMode === 'url' ? (
                  <input
                    type="url"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    placeholder="https://... or ipfs://..."
                    className="phoenix-input text-sm font-mono"
                  />
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-xl border border-dashed border-ash-600/50 bg-ash-900/40 cursor-pointer hover:border-ember-500/30 hover:bg-ash-900/60 transition-colors">
                    {uploading ? (
                      <Loader2 size={24} className="text-ember-500 animate-spin" />
                    ) : (
                      <Upload size={24} className="text-ash-500" />
                    )}
                    <span className="text-xs text-ash-500">
                      {uploading ? 'Uploading...' : 'Click to upload (PNG, JPG, GIF, WebP — max 2 MB)'}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                      className="hidden"
                      disabled={uploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploading(true);
                        try {
                          const result = await api.uploadImage(file);
                          setNewImageUrl(result.url);
                        } catch (err: any) {
                          setError(err.message || 'Upload failed');
                        } finally {
                          setUploading(false);
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                )}

                {newImageUrl && (
                  <div className="mt-2 flex items-center gap-3">
                    <img
                      src={newImageUrl}
                      alt="preview"
                      className="w-10 h-10 rounded-full object-cover border border-ash-700"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-xs text-ash-500">Logo preview</span>
                  </div>
                )}
              </div>

              <div className="border-t border-ash-700/50 pt-4">
                <p className="text-xs text-ash-500 mb-3 flex items-center gap-1.5">
                  <Globe size={12} /> Social Links <span className="text-ash-600">(optional)</span>
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-ash-400 mb-1.5 flex items-center gap-1.5">
                      <MessageCircle size={12} /> Telegram
                    </label>
                    <input
                      type="text"
                      value={socialTelegram}
                      onChange={(e) => setSocialTelegram(e.target.value)}
                      placeholder="https://t.me/..."
                      className="phoenix-input text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ash-400 mb-1.5">𝕏 / Twitter</label>
                    <input
                      type="text"
                      value={socialTwitter}
                      onChange={(e) => setSocialTwitter(e.target.value)}
                      placeholder="https://x.com/..."
                      className="phoenix-input text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ash-400 mb-1.5 flex items-center gap-1.5">
                      <Globe size={12} /> Website
                    </label>
                    <input
                      type="text"
                      value={socialWebsite}
                      onChange={(e) => setSocialWebsite(e.target.value)}
                      placeholder="https://..."
                      className="phoenix-input text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Creator Fee Wallet */}
            <div className="phoenix-card p-6">
              <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
                <Target size={18} className="text-ember-500" />
                Creator Fee Wallet
              </h3>
              <p className="text-xs text-ash-500 mb-4">
                After launch on Groypad, the creator earns trading fees. Provide the wallet
                address where these fees should be sent. This should be a community-controlled wallet.
              </p>
              <input
                type="text"
                value={creatorFeeWallet}
                onChange={(e) => setCreatorFeeWallet(e.target.value)}
                placeholder="EQ... or UQ... (community wallet for creator fees)"
                className="phoenix-input text-sm font-mono"
              />
              {creatorFeeWallet && !/^(0:[0-9a-fA-F]{64}|[EU]Q[A-Za-z0-9_\-]{46})$/.test(creatorFeeWallet.trim()) && (
                <div className="mt-2 flex items-center gap-2 text-pyre text-xs">
                  <AlertTriangle size={14} />
                  Invalid TON address format
                </div>
              )}
            </div>

            {/* Groyper NFT Fee Waiver Banner */}
            {nftHolder?.holds && (
              <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                <Crown size={20} className="text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-400">
                    Groyper NFT Holder Detected ({nftHolder.count} NFT{nftHolder.count > 1 ? 's' : ''})
                  </p>
                  <p className="text-xs text-emerald-400/70">
                    The $25 proposal fee is waived for Groyper NFT holders. You also earn NEWTOKEN airdrops from every migration!
                  </p>
                </div>
              </div>
            )}

            {/* Propose Button */}
            <div className="phoenix-card-glow p-6 text-center">
              {nftHolder?.holds ? (
                <p className="text-sm text-emerald-400 mb-4 flex items-center justify-center gap-2">
                  <Crown size={16} />
                  Proposal fee waived — Groyper NFT holder
                </p>
              ) : (
                <p className="text-sm text-ash-400 mb-4">
                  Proposing requires a non-refundable $25 fee paid in PHX.
                  {' '}<span className="text-ember-400">Groyper NFT holders propose for free!</span>
                </p>
              )}
              <button
                onClick={handlePropose}
                disabled={true}
                className="phoenix-button inline-flex items-center gap-2 text-lg px-8 py-4 disabled:opacity-50"
              >
                {proposing ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <>
                    Propose Migration <ArrowRight size={20} />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
