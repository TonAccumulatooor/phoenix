import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ProgressBar } from './ProgressBar';
import type { MigrationListItem } from '../types';
import { statusLabel, statusColor, timeRemaining, formatNumber } from '../lib/utils';
import { Clock, Users, Droplets } from 'lucide-react';

interface MigrationCardProps {
  migration: MigrationListItem;
  index?: number;
}

export function MigrationCard({ migration, index = 0 }: MigrationCardProps) {
  const isActive = !['closed', 'failed'].includes(migration.status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08 }}
    >
      <Link to={`/migration/${migration.id}`} className="block">
        <div className="phoenix-card-glow p-6 hover:border-ember-500/30 transition-all duration-300 group">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-white group-hover:text-ember-400 transition-colors">
                {migration.old_token_symbol || 'Unknown'}{' '}
                <span className="text-ash-500 font-normal text-sm">migration</span>
              </h3>
              <p className="text-sm text-ash-500 mt-0.5">
                {migration.old_token_name || 'Unknown Token'}
              </p>
            </div>
            <span
              className={`text-xs font-semibold px-3 py-1 rounded-full border ${statusColor(
                migration.status
              )} ${
                isActive
                  ? 'border-ember-500/30 bg-ember-500/10'
                  : migration.status === 'closed'
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-pyre/30 bg-pyre/10'
              }`}
            >
              {statusLabel(migration.status, migration.old_token_symbol ?? undefined)}
            </span>
          </div>

          <ProgressBar
            percent={migration.progress_percent}
            label="Vault progress"
            size="sm"
          />

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="flex items-center gap-2 text-sm text-ash-400">
              <Droplets size={14} className="text-ember-500" />
              <span>{formatNumber(migration.total_deposited)} deposited</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-ash-400">
              <Clock size={14} className="text-ember-500" />
              <span>{timeRemaining(migration.deposit_deadline)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-ash-400">
              <Users size={14} className="text-ember-500" />
              <span>
                {migration.lp_estimation_ton
                  ? `~${formatNumber(migration.lp_estimation_ton)} TON est.`
                  : 'Estimating...'}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
