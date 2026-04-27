import { motion } from 'framer-motion';
import { PhoenixLogo } from '../components/PhoenixLogo';
import {
  TrendingUp,
  Droplets,
  Shield,
  Zap,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';

const UTILITY = [
  {
    icon: <Droplets size={24} />,
    title: 'LP Pair Seeding',
    desc: 'Every successful migration creates a PHX/NEWTOKEN liquidity pair on DeDust, driving perpetual volume.',
  },
  {
    icon: <TrendingUp size={24} />,
    title: 'Creator Rewards',
    desc: 'Phoenix receives 1.05% of all PHX trading volume on Groypad, funding platform operations.',
  },
  {
    icon: <Shield size={24} />,
    title: 'Fee Payments',
    desc: 'The $25 proposal fee is paid in PHX, creating constant buy pressure.',
  },
  {
    icon: <Zap size={24} />,
    title: 'Holder Boost',
    desc: 'Hold 5M+ PHX for a +5% NEWTOKEN bonus on every migration. Hold 10M+ for +10%. Checked at distribution.',
  },
];

export function Token() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-20"
      >
        <div className="flex justify-center mb-6 relative">
          <PhoenixLogo className="w-20 h-20" />
          <div className="absolute inset-0 w-20 h-20 mx-auto bg-ember-500/20 rounded-full blur-3xl pulse-glow" />
        </div>
        <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
          <span className="phoenix-gradient-text">PHX</span> Token
        </h1>
        <p className="text-xl text-ash-400 max-w-xl mx-auto mb-8">
          The fuel that powers every token rebirth on Phoenix.
        </p>
        <div className="flex justify-center gap-4">
          <a
            href="https://groypfi.io/swap"
            target="_blank"
            rel="noopener noreferrer"
            className="phoenix-button inline-flex items-center gap-2"
          >
            Buy on GroypFi <ExternalLink size={16} />
          </a>
          <a
            href="https://dexscreener.com"
            target="_blank"
            rel="noopener noreferrer"
            className="phoenix-button-outline inline-flex items-center gap-2"
          >
            Chart on Dexscreener <ExternalLink size={16} />
          </a>
        </div>
      </motion.div>

      {/* Flywheel */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        className="mb-20"
      >
        <h2 className="text-2xl font-display font-bold text-center mb-4">
          The <span className="phoenix-gradient-text">Flywheel</span>
        </h2>
        <p className="text-ash-400 text-center mb-8 max-w-lg mx-auto">
          Every successful migration strengthens the PHX ecosystem.
        </p>
        <div className="phoenix-card-glow p-6 md:p-8 overflow-hidden">
          <div className="flex flex-col md:flex-row items-center justify-center gap-3 text-center">
            {[
              'More Migrations',
              'More PHX/TOKEN LPs',
              'More PHX Volume',
              'More Creator Rewards',
              'More Platform Runway',
            ].map((step, i, arr) => (
              <div key={step} className="flex items-center gap-3 min-w-0">
                <div className="bg-ash-800/80 border border-ash-700/50 rounded-xl px-3 py-2.5 shrink-0">
                  <div className="text-xs md:text-sm font-medium text-white whitespace-nowrap">
                    {step}
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <ArrowRight size={14} className="text-ember-500 hidden md:block shrink-0" />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-center mt-4">
            <div className="text-ember-500 text-sm flex items-center gap-1">
              <ArrowRight size={14} className="rotate-180" />
              Cycle repeats
            </div>
          </div>
        </div>
      </motion.div>

      {/* Utility */}
      <div>
        <h2 className="text-2xl font-display font-bold text-center mb-8">Token Utility</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {UTILITY.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="phoenix-card p-6"
            >
              <div className="text-ember-500 mb-3">{item.icon}</div>
              <h3 className="font-display font-semibold text-white mb-1">{item.title}</h3>
              <p className="text-sm text-ash-400">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
