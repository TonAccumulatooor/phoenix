import { motion } from 'framer-motion';
import { type ReactNode } from 'react';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  delay?: number;
}

export function StatCard({ icon, label, value, subtitle, delay = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="py-8 px-6 text-center"
    >
      <div className="flex justify-center mb-2 text-ember-500">{icon}</div>
      <div className="text-2xl font-display font-bold text-white mb-0.5">{value}</div>
      <div className="text-xs text-ash-500 font-medium uppercase tracking-wider">{label}</div>
      {subtitle && <div className="text-xs text-ash-600 mt-0.5">{subtitle}</div>}
    </motion.div>
  );
}
