import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { StatCard } from '../components/StatCard';
import { api } from '../lib/api';
import { formatNumber } from '../lib/utils';
import {
  Flame,
  Shield,
  Zap,
  Users,
  ArrowRight,
  Vote,
  BarChart3,
  Coins,
  TrendingUp,
  RefreshCw,
  Award,
  ChevronDown,
} from 'lucide-react';

const STEPS = [
  {
    num: '01',
    title: 'Propose Migration',
    desc: 'Anyone submits an old token address with a small fee in PHX. Phoenix snapshots all holders and estimates LP extraction.',
    icon: <Flame size={24} />,
  },
  {
    num: '02',
    title: 'Community Deposits',
    desc: 'Holders deposit their old tokens into the vault. Once 51% of circulating supply is collected, the migration qualifies. Migrations that fail after 14 days will have old tokens returned to holders.',
    icon: <Users size={24} />,
  },
  {
    num: '03',
    title: 'Phoenix Agent Launches',
    desc: 'Old tokens are sold into LP to extract TON. Phoenix Agent uses that TON to launch the new token on Groypad.',
    icon: <Zap size={24} />,
  },
  {
    num: '04',
    title: 'Token Rebirth',
    desc: 'New tokens are distributed proportionally to depositors. LP pair is seeded on DeDust. The project\'s new token now receives 1.05% creator rewards from Groypad.',
    icon: <Coins size={24} />,
  },
];

const FEATURES = [
  {
    icon: <Shield size={28} />,
    title: 'No Leader Required',
    desc: '51% vault threshold is the vote. No single person can force or block a migration.',
  },
  {
    icon: <BarChart3 size={28} />,
    title: 'Transparent Estimates',
    desc: 'Real-time LP extraction estimates, conversion calculators, and pro-rata scaling — all visible before you deposit.',
  },
  {
    icon: <Vote size={28} />,
    title: 'Community Governance',
    desc: 'Holder-weighted voting determines who receives the 1.05% Groypad creator rewards.',
  },
  {
    icon: <Flame size={28} />,
    title: 'Fair Tier System',
    desc: 'OG holders get full conversion. Post-announcement buyers and late claimers receive reduced rates.',
  },
];

export function Landing() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
  }, []);

  return (
    <div className="relative">
      {/* Hero — asymmetric, full-bleed */}
      <section className="relative min-h-[92vh] flex items-center overflow-hidden">
        {/* Video background */}
        <video
          src="/phoenix_rising6.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ opacity: 0.35 }}
        />

        {/* Dark overlay — heavier on left so text stays readable, fades right */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(to right, rgba(7,7,10,0.96) 0%, rgba(7,7,10,0.82) 40%, rgba(7,7,10,0.45) 70%, rgba(7,7,10,0.15) 100%), linear-gradient(to bottom, rgba(7,7,10,0.3) 0%, transparent 20%, transparent 80%, rgba(7,7,10,0.6) 100%)',
          }}
        />

        <div className="max-w-7xl mx-auto px-6 w-full relative z-10">
          <div className="max-w-2xl">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7 }}
              className="flex items-center gap-3 mb-6"
            >
              <div className="h-px flex-1 max-w-[60px] bg-gradient-to-r from-ember-500/60 to-transparent" />
              <span className="text-ember-400 text-sm font-mono font-medium tracking-widest uppercase">Token Rebirth</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-5xl sm:text-6xl lg:text-7xl font-display font-extrabold leading-[1.05] mb-7 tracking-tight"
            >
              Rise from
              <br />
              the{' '}
              <span className="phoenix-gradient-text">Ashes</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
              className="text-lg text-ash-300 mb-10 leading-relaxed max-w-lg"
            >
              The trusted migration platform for any TON token.
              Fresh launch on Groypad — no leader required, no trust needed.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-wrap gap-4"
            >
              <span className="phoenix-button flex items-center gap-2 text-lg opacity-50 cursor-not-allowed pointer-events-none">
                Propose Migration <ArrowRight size={20} />
              </span>
              <Link to="/migrations" className="phoenix-button-outline flex items-center gap-2">
                View Active Migrations
              </Link>
            </motion.div>

            {/* Value props — horizontal strip, not grid */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-wrap gap-6 mt-14 pt-8 border-t border-ash-800/40"
            >
              <div className="flex items-center gap-3">
                <RefreshCw size={16} className="text-ember-500" />
                <span className="text-sm text-ash-300">Fresh Start</span>
              </div>
              <div className="flex items-center gap-3">
                <Award size={16} className="text-ember-500" />
                <span className="text-sm text-ash-300">1.05% Creator Rewards</span>
              </div>
              <div className="flex items-center gap-3">
                <TrendingUp size={16} className="text-ember-500" />
                <span className="text-sm text-ash-300">Any TON Token</span>
              </div>
            </motion.div>
          </div>

        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ delay: 1.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <ChevronDown size={24} className="text-ash-500 animate-bounce" />
        </motion.div>
      </section>

      {/* Stats — flush bar */}
      <section className="relative z-10 border-y border-ash-800/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-ash-800/30">
            <StatCard icon={<Flame size={20} />} label="Migrations" value={stats?.total_migrations ?? 0} subtitle="and counting" delay={0.1} />
            <StatCard icon={<Users size={20} />} label="Wallets Served" value={stats?.wallets_served ?? 0} delay={0.2} />
            <StatCard icon={<Coins size={20} />} label="Tokens Reborn" value={stats?.successful_migrations ?? 0} delay={0.3} />
            <StatCard icon={<BarChart3 size={20} />} label="TON Extracted" value={stats?.total_ton_extracted ? formatNumber(Math.round(stats.total_ton_extracted)) : 0} delay={0.4} />
          </div>
        </div>
      </section>

      {/* How It Works — staggered timeline, not grid */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="flex items-center gap-4 mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-display font-extrabold tracking-tight">
            How It <span className="phoenix-gradient-text">Works</span>
          </h2>
          <div className="h-px flex-1 bg-gradient-to-r from-ember-500/20 to-transparent" />
        </motion.div>

        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-6 md:left-8 top-0 bottom-0 w-px bg-gradient-to-b from-ember-500/30 via-ember-600/15 to-transparent" />

          <div className="space-y-8">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative pl-16 md:pl-20"
              >
                {/* Timeline node */}
                <div className="absolute left-3 md:left-5 top-6 w-6 h-6 rounded-full bg-ash-950 border-2 border-ember-500/40 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-ember-500" />
                </div>

                <div className="phoenix-card p-6 group">
                  <div className="flex items-start gap-5">
                    <div className="text-ember-500 mt-0.5 shrink-0 group-hover:scale-110 transition-transform">{step.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-xs font-mono text-ember-600/60">{step.num}</span>
                        <h3 className="text-lg font-display font-bold text-white">{step.title}</h3>
                      </div>
                      <p className="text-sm text-ash-400 leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Tier Explainer — redesigned */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="flex items-center gap-4 mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-display font-extrabold tracking-tight">
            Fair <span className="phoenix-gradient-text">Conversion</span> Tiers
          </h2>
          <div className="h-px flex-1 bg-gradient-to-r from-ember-500/20 to-transparent" />
        </motion.div>

        <div className="max-w-4xl">
          <div className="grid gap-3">
            {[
              { tier: 'Tier 1', who: 'OG holder, deposited on time', rate: '1.0x', color: 'emerald', glow: 'rgba(16,185,129,0.06)' },
              { tier: 'Tier 1+', who: 'OG holder, tokens bought after snapshot (only excess applies)', rate: '0.75x', color: 'amber', glow: 'rgba(245,158,11,0.06)' },
              { tier: 'Tier 2', who: 'Non-OG, deposited on time', rate: '0.75x', color: 'orange', glow: 'rgba(249,115,22,0.06)' },
              { tier: 'Tier 3', who: 'Anyone, late claim window', rate: '0.5x', color: 'ash', glow: 'rgba(142,142,154,0.04)' },
            ].map((row, i) => (
              <motion.div
                key={row.tier}
                initial={{ opacity: 0, x: -15 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="phoenix-card p-5 flex items-center justify-between gap-4 hover:shadow-lg transition-all"
                style={{ boxShadow: `inset 3px 0 0 ${row.glow}` }}
              >
                <div className="flex items-center gap-4 flex-1">
                  <span className={`text-${row.color}-400 font-display font-bold text-sm w-16`}>{row.tier}</span>
                  <span className="text-ash-300 text-sm">{row.who}</span>
                </div>
                <span className="font-mono font-bold text-white text-lg">{row.rate}</span>
              </motion.div>
            ))}
          </div>
          <p className="text-xs text-ash-500 mt-4 ml-1">
            TON top-up contributors receive an additional 10% bonus on their allocation.
          </p>
          <p className="text-xs text-ash-500 mt-2 ml-1">
            PHX holders get a bonus: 5M-9.99M PHX = +5% NEWTOKEN, 10M+ PHX = +10% NEWTOKEN.
          </p>
        </div>
      </section>

      {/* Features — offset 2-column with large accent */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="grid lg:grid-cols-[280px_1fr] gap-12 items-start">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="lg:sticky lg:top-24"
          >
            <h2 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-4">
              Why <span className="phoenix-gradient-text">Phoenix</span>
            </h2>
            <p className="text-ash-400 text-sm leading-relaxed">
              Built for communities that refuse to die. Every mechanism is designed to be trustless and transparent.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-4">
            {FEATURES.map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="phoenix-card-glow p-6 group"
              >
                <div className="text-ember-500 mb-4 group-hover:scale-110 transition-transform origin-left">{feat.icon}</div>
                <h3 className="text-base font-display font-bold text-white mb-2">{feat.title}</h3>
                <p className="text-sm text-ash-400 leading-relaxed">{feat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div
          className="phoenix-card-glow p-12 md:p-16 relative overflow-hidden"
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse 60% 80% at 80% 50%, rgba(255,69,0,0.08) 0%, transparent 60%)',
            }}
          />
          <div className="relative z-10 max-w-xl">
            <h2 className="text-3xl md:text-4xl font-display font-extrabold mb-4 tracking-tight">
              Ready to <span className="phoenix-gradient-text">Revive</span> Your Community?
            </h2>
            <p className="text-ash-400 mb-8 leading-relaxed">
              It only takes one proposal. If the community agrees, the migration happens automatically.
            </p>
            <Link to="/propose" className="phoenix-button inline-flex items-center gap-2">
              Propose a Migration <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
