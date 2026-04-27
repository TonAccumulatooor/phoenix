import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Flame,
  Users,
  Zap,
  Shield,
  Coins,
  Vote,
  Clock,
  TrendingUp,
  ArrowRight,
  Crown,
  Droplets,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  Layers,
  RefreshCw,
} from 'lucide-react';

type Section =
  | 'overview'
  | 'migration-flow'
  | 'tiers'
  | 'treasury'
  | 'groyper-nft'
  | 'phoenix-agent'
  | 'groypad'
  | 'voting'
  | 'phx-token'
  | 'faq';

const NAV: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <BookOpen size={16} /> },
  { id: 'migration-flow', label: 'Migration Flow', icon: <RefreshCw size={16} /> },
  { id: 'tiers', label: 'Conversion Tiers', icon: <Layers size={16} /> },
  { id: 'treasury', label: 'Treasury & LP', icon: <Coins size={16} /> },
  { id: 'groyper-nft', label: 'Groyper NFT', icon: <Crown size={16} /> },
  { id: 'phoenix-agent', label: 'Phoenix Agent', icon: <Zap size={16} /> },
  { id: 'groypad', label: 'Groypad Launch', icon: <TrendingUp size={16} /> },
  { id: 'voting', label: 'Governance & Voting', icon: <Vote size={16} /> },
  { id: 'phx-token', label: 'PHX Token', icon: <Flame size={16} /> },
  { id: 'faq', label: 'FAQ', icon: <AlertTriangle size={16} /> },
];

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="text-ember-500">{icon}</div>
      <h2 className="text-2xl md:text-3xl font-display font-bold text-white">{title}</h2>
      <div className="h-px flex-1 bg-gradient-to-r from-ember-500/20 to-transparent" />
    </div>
  );
}

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-ash-800/40 last:border-0">
      <span className="text-sm text-ash-400">{label}</span>
      <span className="text-sm font-mono text-white">{value}</span>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-ash-800/40 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 text-left group"
      >
        <span className="text-sm font-medium text-ash-200 group-hover:text-white transition-colors pr-4">{q}</span>
        <ChevronRight
          size={16}
          className={`text-ash-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="pb-4 text-sm text-ash-400 leading-relaxed"
        >
          {a}
        </motion.div>
      )}
    </div>
  );
}

export function Docs() {
  const [active, setActive] = useState<Section>('overview');

  function scrollTo(id: Section) {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">
          <span className="phoenix-gradient-text">Documentation</span>
        </h1>
        <p className="text-ash-400 mb-12">
          Everything you need to understand how Phoenix migrations work.
        </p>

        <div className="grid lg:grid-cols-[220px_1fr] gap-10">
          {/* Sidebar nav */}
          <nav className="hidden lg:block sticky top-24 self-start space-y-0.5">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 text-left ${
                  active === item.id
                    ? 'text-ember-400 bg-ember-500/10'
                    : 'text-ash-500 hover:text-ash-200 hover:bg-ash-800/30'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="space-y-16 min-w-0">
            {/* Overview */}
            <section id="overview">
              <SectionHeading icon={<BookOpen size={24} />} title="Overview" />
              <div className="phoenix-card p-6 space-y-4 text-sm text-ash-300 leading-relaxed">
                <p>
                  Phoenix is a trustless token migration platform built on the TON blockchain. It enables any
                  community to migrate their existing token to a fresh launch on{' '}
                  <a href="https://groypfi.io/launchpad" target="_blank" rel="noopener noreferrer" className="text-ember-400 hover:underline">
                    Groypad
                  </a>{' '}
                  — no leader required, no trust needed.
                </p>
                <p>
                  The core mechanism is simple: if 51% of a token's circulating supply is deposited into the
                  Phoenix Vault within the deposit window, the migration qualifies. The Phoenix Agent then
                  automatically sells the old tokens, launches a new token on Groypad, and distributes new
                  tokens proportionally to all depositors.
                </p>
                <p>
                  Every migration is transparent: LP extraction estimates, conversion ratios, tier assignments,
                  and pro-rata scaling are all calculated and displayed in real time before anyone commits a
                  single token.
                </p>
              </div>
            </section>

            {/* Migration Flow */}
            <section id="migration-flow">
              <SectionHeading icon={<RefreshCw size={24} />} title="Migration Flow" />
              <div className="space-y-4">
                {[
                  {
                    step: '1',
                    title: 'Proposal',
                    icon: <Flame size={18} />,
                    desc: 'Anyone can propose a migration by submitting the old token\'s jetton address and paying a $25 fee in PHX (waived for Groyper NFT holders). Phoenix snapshots all current holders, estimates LP extraction, and calculates the conversion ratio.',
                  },
                  {
                    step: '2',
                    title: 'Deposit Window (14 days)',
                    icon: <Clock size={18} />,
                    desc: 'Holders deposit their old tokens into the Phoenix Vault. The migration qualifies once deposits reach 51% of the circulating supply. If the threshold is not met within 14 days, the migration fails and all tokens are returned.',
                  },
                  {
                    step: '3',
                    title: 'LP Extraction & Launch',
                    icon: <Zap size={18} />,
                    desc: 'The Phoenix Agent sells deposited tokens into existing LP pools to extract TON. That TON is used as a dev buy on Groypad to launch the new token. With a full 1,050 TON dev buy, the Agent acquires ~76% of the new token supply on the bonding curve.',
                  },
                  {
                    step: '4',
                    title: 'Distribution',
                    icon: <Users size={18} />,
                    desc: 'New tokens are distributed to depositors based on their tier and deposit amount. 1% of new token supply is retained by the Treasury (0.5% for LP seeding, 0.5% for Groyper NFT airdrops). 10% is held in reserve for late claims.',
                  },
                  {
                    step: '5',
                    title: 'Late Claim Window (30 days)',
                    icon: <Clock size={18} />,
                    desc: 'Holders who missed the deposit window can still claim at a reduced Tier 3 rate (0.5x) for 30 days. After this window closes, the migration is finalized.',
                  },
                  {
                    step: '6',
                    title: 'Creator Reward Voting',
                    icon: <Vote size={18} />,
                    desc: 'Depositors vote (weighted by deposit amount) on who receives the 1.05% Groypad creator reward fees. The proposer can also designate a community wallet for creator fees at proposal time.',
                  },
                ].map((item) => (
                  <div key={item.step} className="phoenix-card p-5 flex gap-4">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-ember-500/10 border border-ember-500/25 flex items-center justify-center text-ember-400 text-xs font-bold font-mono">
                      {item.step}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-display font-bold text-white mb-1 flex items-center gap-2">
                        {item.icon}
                        {item.title}
                      </h3>
                      <p className="text-sm text-ash-400 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Conversion Tiers */}
            <section id="tiers">
              <SectionHeading icon={<Layers size={24} />} title="Conversion Tiers" />
              <div className="phoenix-card p-6 mb-4">
                <p className="text-sm text-ash-300 leading-relaxed mb-6">
                  Phoenix uses a tiered conversion system to reward early, loyal holders while still allowing
                  everyone to participate. Your tier is determined by when you acquired your tokens relative to
                  the snapshot and when you deposited.
                </p>
                <div className="space-y-3">
                  {[
                    { tier: 'Tier 1', rate: '1.0x', who: 'Held tokens at snapshot time + deposited during window', color: 'emerald' },
                    { tier: 'Tier 1+', rate: '0.75x', who: 'OG holder — applies only to tokens bought after the snapshot (excess over snapshot balance)', color: 'amber' },
                    { tier: 'Tier 2', rate: '0.75x', who: 'Not in snapshot, deposited during window (post-announcement buyers)', color: 'orange' },
                    { tier: 'Tier 3', rate: '0.5x', who: 'Anyone who deposits during the late claim window (30 days after qualification)', color: 'ash' },
                  ].map((row) => (
                    <div key={row.tier} className="flex items-center justify-between p-4 rounded-lg bg-ash-900/50 border border-ash-800/40">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <span className={`text-${row.color}-400 font-display font-bold text-sm w-16 shrink-0`}>{row.tier}</span>
                        <span className="text-sm text-ash-400">{row.who}</span>
                      </div>
                      <span className="font-mono font-bold text-white text-lg shrink-0 ml-4">{row.rate}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-ash-500 mt-4">
                  TON top-up contributors receive an additional 10% bonus on their entire allocation.
                </p>

                <div className="mt-5 pt-5 border-t border-ash-800/40">
                  <h3 className="text-base font-display font-bold text-white mb-3 flex items-center gap-2">
                    <Flame size={16} className="text-amber-400" />
                    PHX Holder Boost
                  </h3>
                  <p className="text-sm text-ash-400 leading-relaxed mb-3">
                    Wallets holding PHX tokens at the time of distribution receive a bonus on their NEWTOKEN allocation.
                    This boost stacks with the top-up bonus.
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <div className="flex items-center gap-3">
                        <span className="text-amber-400 font-bold text-sm">Tier 1</span>
                        <span className="text-sm text-ash-400">Hold 5,000,000 - 9,999,999 PHX (0.5% - 0.99% of supply)</span>
                      </div>
                      <span className="font-mono font-bold text-amber-400 shrink-0 ml-4">+5%</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <div className="flex items-center gap-3">
                        <span className="text-amber-400 font-bold text-sm">Tier 2</span>
                        <span className="text-sm text-ash-400">Hold 10,000,000+ PHX (1%+ of supply)</span>
                      </div>
                      <span className="font-mono font-bold text-amber-400 shrink-0 ml-4">+10%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="phoenix-card p-6">
                <h3 className="text-base font-display font-bold text-white mb-3">Pro-Rata Scaling</h3>
                <p className="text-sm text-ash-400 leading-relaxed">
                  If the total NEWTOKEN owed to all depositors exceeds the distributable supply (agent's acquired supply minus reserves),
                  a pro-rata scale factor is applied equally to all allocations. This ensures fair distribution without
                  over-promising tokens. The scale factor and all individual allocations are visible on each migration's dashboard.
                </p>
              </div>
            </section>

            {/* Treasury */}
            <section id="treasury">
              <SectionHeading icon={<Coins size={24} />} title="Treasury & LP Seeding" />
              <div className="phoenix-card p-6 space-y-4">
                <p className="text-sm text-ash-300 leading-relaxed">
                  From every successful migration, the Phoenix Treasury retains 1% of the new token's total supply
                  (10,000,000 tokens from a 1B supply). This retention funds two operations:
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-ash-900/50 border border-ash-800/40">
                    <div className="flex items-center gap-2 mb-2">
                      <Droplets size={16} className="text-sky-400" />
                      <h4 className="text-sm font-bold text-white">LP Seeding (0.5%)</h4>
                    </div>
                    <p className="text-xs text-ash-400 leading-relaxed">
                      5,000,000 NEWTOKEN are paired with a USD-equivalent amount of PHX to create a PHX/NEWTOKEN
                      liquidity pool on DeDust. This gives the new token an immediate trading pair against PHX,
                      driving volume for both tokens.
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-ash-900/50 border border-ash-800/40">
                    <div className="flex items-center gap-2 mb-2">
                      <Crown size={16} className="text-emerald-400" />
                      <h4 className="text-sm font-bold text-white">NFT Airdrop (0.5%)</h4>
                    </div>
                    <p className="text-xs text-ash-400 leading-relaxed">
                      5,000,000 NEWTOKEN are airdropped to Groyper NFT holders proportionally — approximately
                      18,450 tokens per NFT. A snapshot of NFT ownership is taken after each successful launch.
                    </p>
                  </div>
                </div>
              </div>

              <div className="phoenix-card p-6 mt-4">
                <h3 className="text-base font-display font-bold text-white mb-3">Parameters</h3>
                <Param label="Treasury Retention" value="1% (10,000,000 tokens)" />
                <Param label="LP Seed Amount" value="5,000,000 NEWTOKEN + matched PHX" />
                <Param label="NFT Airdrop Amount" value="5,000,000 NEWTOKEN" />
                <Param label="LP DEX" value="DeDust" />
                <Param label="PHX Matching" value="USD-equivalent at time of seeding" />
              </div>
            </section>

            {/* Groyper NFT */}
            <section id="groyper-nft">
              <SectionHeading icon={<Crown size={24} />} title="Groyper NFT Benefits" />
              <div className="phoenix-card p-6 space-y-4">
                <p className="text-sm text-ash-300 leading-relaxed">
                  The{' '}
                  <a
                    href="https://getgems.io/collection/EQAmTVtgzf14BiZSvDFQgA3vY7Isey8sHB3nAtZQS-2Vs2hw"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ember-400 hover:underline inline-flex items-center gap-1"
                  >
                    Groyper NFT collection <ExternalLink size={12} />
                  </a>{' '}
                  (271 total supply) provides two benefits within the Phoenix ecosystem:
                </p>
                <div className="space-y-3">
                  <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <h4 className="text-sm font-bold text-emerald-400 mb-1">Free Proposals</h4>
                    <p className="text-xs text-ash-400 leading-relaxed">
                      The $25 PHX proposal fee is completely waived for wallets holding at least one Groyper NFT.
                      Ownership is verified on-chain at the time of proposal submission.
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <h4 className="text-sm font-bold text-emerald-400 mb-1">NEWTOKEN Airdrops</h4>
                    <p className="text-xs text-ash-400 leading-relaxed">
                      From every successful migration, 0.5% of the new token supply (5,000,000 tokens) is
                      airdropped proportionally to Groyper NFT holders — approximately 18,450 tokens per NFT.
                      This is passive income from every migration on the platform.
                    </p>
                  </div>
                </div>
              </div>

              <div className="phoenix-card p-6 mt-4">
                <h3 className="text-base font-display font-bold text-white mb-3">Collection Details</h3>
                <Param label="Collection Address" value="EQAmTVtg...2Vs2hw" />
                <Param label="Total Supply" value="271 NFTs" />
                <Param label="Airdrop Per NFT" value="~18,450 NEWTOKEN per migration" />
                <Param label="Fee Waiver" value="$25 proposal fee waived" />
              </div>
            </section>

            {/* Phoenix Agent */}
            <section id="phoenix-agent">
              <SectionHeading icon={<Zap size={24} />} title="Phoenix Agent" />
              <div className="phoenix-card p-6 space-y-4">
                <p className="text-sm text-ash-300 leading-relaxed">
                  The Phoenix Agent is an autonomous Teleton plugin that executes the entire migration pipeline.
                  Once a migration qualifies (51% threshold met), the Agent handles everything automatically
                  with no human intervention required.
                </p>
                <h3 className="text-base font-display font-bold text-white">Pipeline Steps</h3>
                <div className="space-y-2">
                  {[
                    { step: '1', label: 'Sell old tokens into LP to extract TON' },
                    { step: '2', label: 'Prepare metadata for new token (name, symbol, image, description)' },
                    { step: '3', label: 'Deploy new token on Groypad via dev buy' },
                    { step: '4', label: 'Discover the deployed contract address on-chain' },
                    { step: '5', label: 'Submit creator fee claim to GroypFi bot for community wallet' },
                    { step: '6', label: 'Distribute new tokens to all depositors by tier' },
                    { step: '7', label: 'Airdrop NEWTOKEN to Groyper NFT holders' },
                    { step: '8', label: 'Seed PHX/NEWTOKEN LP on DeDust' },
                  ].map((s) => (
                    <div key={s.step} className="flex items-center gap-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-ember-500/10 border border-ember-500/25 flex items-center justify-center text-ember-400 text-xs font-mono font-bold shrink-0">
                        {s.step}
                      </span>
                      <span className="text-ash-300">{s.label}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-ash-500">
                  Steps 7 and 8 are non-fatal — if they fail, the core migration (distribution) is already complete.
                  The Agent will retry these steps.
                </p>
              </div>
            </section>

            {/* Groypad */}
            <section id="groypad">
              <SectionHeading icon={<TrendingUp size={24} />} title="Groypad Launch Mechanics" />
              <div className="phoenix-card p-6 space-y-4">
                <p className="text-sm text-ash-300 leading-relaxed">
                  New tokens are launched on{' '}
                  <a href="https://groypfi.io/launchpad" target="_blank" rel="noopener noreferrer" className="text-ember-400 hover:underline inline-flex items-center gap-1">
                    Groypad <ExternalLink size={12} />
                  </a>, a TON-native token launchpad with a bonding curve mechanism. The Phoenix Agent
                  performs a "dev buy" — the first purchase on the bonding curve — using the extracted TON.
                </p>
                <p className="text-sm text-ash-300 leading-relaxed">
                  Groypad uses a square-root bonding curve. Early buyers get significantly more tokens per TON.
                  A full dev buy of 1,050 TON acquires approximately 760,000,000 tokens (76% of the 1B supply),
                  which immediately graduates the token to a DEX listing.
                </p>
                <p className="text-sm text-ash-300 leading-relaxed">
                  Tokens already deployed from Groypad (identifiable by "Deployed from Groypad" in their metadata)
                  are automatically ineligible for migration — they can't be relaunched on the same platform.
                </p>
              </div>
              <div className="phoenix-card p-6 mt-4">
                <h3 className="text-base font-display font-bold text-white mb-3">Groypad Parameters</h3>
                <Param label="Graduation Threshold" value="1,050 TON" />
                <Param label="Max Curve Supply" value="760,000,000 tokens" />
                <Param label="Total Supply" value="1,000,000,000 tokens" />
                <Param label="Trading Fee" value="3%" />
                <Param label="Creator Reward" value="1.05% of trading volume" />
              </div>
            </section>

            {/* Voting */}
            <section id="voting">
              <SectionHeading icon={<Vote size={24} />} title="Governance & Voting" />
              <div className="phoenix-card p-6 space-y-4">
                <p className="text-sm text-ash-300 leading-relaxed">
                  After a successful migration, the community votes on who should receive the 1.05% Groypad
                  creator reward fees. Voting is weighted by deposit amount — larger depositors have more influence.
                </p>
                <p className="text-sm text-ash-300 leading-relaxed">
                  The proposer can also specify a <strong className="text-white">Creator Fee Wallet</strong> at
                  proposal time. This is typically a community-controlled multisig wallet. After launch, the
                  Phoenix Agent submits this wallet to the GroypFi fee claim bot, which is reviewed and approved
                  by the Groypad team.
                </p>
                <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <Shield size={14} className="text-amber-400" />
                    <span className="text-xs font-bold text-amber-400">Trustless by Design</span>
                  </div>
                  <p className="text-xs text-ash-400 leading-relaxed">
                    The 51% vault threshold is the vote to migrate. No single person can force or block a migration.
                    Creator reward distribution is decided by community governance after the fact.
                  </p>
                </div>
              </div>
            </section>

            {/* PHX Token */}
            <section id="phx-token">
              <SectionHeading icon={<Flame size={24} />} title="PHX Token" />
              <div className="phoenix-card p-6 space-y-4">
                <p className="text-sm text-ash-300 leading-relaxed">
                  PHX is the native token of the Phoenix platform. It serves three core functions:
                </p>
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-ash-900/50 border border-ash-800/40">
                    <h4 className="text-sm font-bold text-white mb-1">Proposal Fees</h4>
                    <p className="text-xs text-ash-400">
                      The $25 proposal fee is paid in PHX, creating constant buy pressure from migration activity.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-ash-900/50 border border-ash-800/40">
                    <h4 className="text-sm font-bold text-white mb-1">LP Pair Seeding</h4>
                    <p className="text-xs text-ash-400">
                      Every migration seeds a PHX/NEWTOKEN LP pool on DeDust, expanding PHX's trading pairs and volume.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-ash-900/50 border border-ash-800/40">
                    <h4 className="text-sm font-bold text-white mb-1">Holder Boost</h4>
                    <p className="text-xs text-ash-400">
                      Wallets holding 5M+ PHX receive a 5% bonus on NEWTOKEN allocations. Holding 10M+ PHX increases
                      the bonus to 10%. Checked at the time of distribution.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-ash-900/50 border border-ash-800/40">
                    <h4 className="text-sm font-bold text-white mb-1">Platform Revenue</h4>
                    <p className="text-xs text-ash-400">
                      PHX captures value from every successful migration through fee collection and LP pair creation.
                    </p>
                  </div>
                </div>
                <div className="pt-2">
                  <Link to="/token" className="text-sm text-ember-400 hover:underline inline-flex items-center gap-1">
                    View PHX Token page <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            </section>

            {/* FAQ */}
            <section id="faq">
              <SectionHeading icon={<AlertTriangle size={24} />} title="FAQ" />
              <div className="phoenix-card p-6">
                <FaqItem
                  q="What happens if a migration doesn't reach 51%?"
                  a="If the 51% threshold is not met within the 14-day deposit window, the migration fails. All deposited tokens are returned to their owners — nothing is lost."
                />
                <FaqItem
                  q="Can I get my tokens back after depositing?"
                  a="Once deposited, tokens cannot be withdrawn during an active migration. If the migration fails (doesn't reach 51%), tokens are returned automatically. If it succeeds, you receive new tokens instead."
                />
                <FaqItem
                  q="What is the base conversion ratio?"
                  a="The base ratio is calculated as NEW_TOKEN_SUPPLY / OLD_TOKEN_TOTAL_SUPPLY (1,000,000,000 / old supply). This ratio is then multiplied by your tier multiplier (1.0x, 0.75x, or 0.5x) and potentially scaled by the pro-rata factor."
                />
                <FaqItem
                  q="Why is my allocation less than expected?"
                  a="If the Phoenix Agent acquires less than 76% of the new token supply (due to insufficient TON extraction), the distributable supply is smaller. A pro-rata scale factor is applied to all allocations to ensure fair distribution. The scale factor is visible on the migration dashboard."
                />
                <FaqItem
                  q="What tokens are eligible for migration?"
                  a="Any TON jetton with existing liquidity on DeDust or STON.fi can be proposed. Tokens that were already deployed from Groypad are automatically ineligible — they can't be relaunched on the same platform."
                />
                <FaqItem
                  q="What is the top-up bonus?"
                  a="Community members can contribute additional TON to increase the dev buy amount. Top-up contributors receive a 10% bonus on their entire NEWTOKEN allocation as a reward."
                />
                <FaqItem
                  q="How does the creator fee wallet work?"
                  a="When proposing a migration, you can specify a wallet address to receive Groypad's 1.05% creator trading fees. After launch, the Phoenix Agent submits this wallet to GroypFi's fee claim bot. The Groypad team reviews and approves the transfer."
                />
                <FaqItem
                  q="Do I need a Groyper NFT to use Phoenix?"
                  a="No. Anyone can propose and participate in migrations. The Groyper NFT simply waives the $25 proposal fee and earns you NEWTOKEN airdrops from every successful migration."
                />
              </div>
            </section>

            {/* CTA */}
            <div className="phoenix-card-glow p-8 text-center">
              <h3 className="text-xl font-display font-bold text-white mb-3">Ready to get started?</h3>
              <p className="text-sm text-ash-400 mb-6">
                Propose a migration or browse active ones to see Phoenix in action.
              </p>
              <div className="flex justify-center gap-4">
                <Link to="/propose" className="phoenix-button inline-flex items-center gap-2">
                  Propose Migration <ArrowRight size={16} />
                </Link>
                <Link to="/migrations" className="phoenix-button-outline inline-flex items-center gap-2">
                  View Migrations
                </Link>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
