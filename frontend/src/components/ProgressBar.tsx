import { motion } from 'framer-motion';

interface ProgressBarProps {
  percent: number;
  label?: string;
  showPercent?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function ProgressBar({
  percent,
  label,
  showPercent = true,
  size = 'md',
}: ProgressBarProps) {
  const heights = { sm: 'h-2', md: 'h-3', lg: 'h-4' };
  const clamped = Math.min(Math.max(percent, 0), 100);
  const qualified = clamped >= 51;

  return (
    <div className="w-full">
      {(label || showPercent) && (
        <div className="flex justify-between items-center mb-2">
          {label && <span className="text-sm text-ash-400">{label}</span>}
          {showPercent && (
            <span
              className={`text-sm font-mono font-semibold ${
                qualified ? 'text-emerald-400' : 'text-ember-400'
              }`}
            >
              {clamped.toFixed(1)}%
            </span>
          )}
        </div>
      )}
      <div className={`phoenix-progress-track ${heights[size]}`}>
        <motion.div
          className={`h-full rounded-full ${
            qualified
              ? 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300'
              : 'bg-gradient-to-r from-ember-600 via-ember-500 to-gold'
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </div>
      {qualified && (
        <div className="mt-1 text-xs text-emerald-400 font-medium">
          Threshold reached — Migration qualified
        </div>
      )}
    </div>
  );
}
