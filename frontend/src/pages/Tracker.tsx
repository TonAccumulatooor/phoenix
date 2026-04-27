import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { MigrationCard } from '../components/MigrationCard';
import type { MigrationListItem } from '../types';
import { Flame, Filter, Loader2 } from 'lucide-react';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'depositing', label: 'Active' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'distributing', label: 'Distributing' },
  { value: 'late_claims', label: 'Late Claims' },
  { value: 'closed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

export function Tracker() {
  const [migrations, setMigrations] = useState<MigrationListItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMigrations();
  }, [filter]);

  async function loadMigrations() {
    setLoading(true);
    try {
      const data: any = await api.listMigrations({
        status: filter || undefined,
        limit: 50,
      });
      setMigrations(data.migrations || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">
              <span className="phoenix-gradient-text">Active</span> Migrations
            </h1>
            <p className="text-ash-400 mt-1">
              Track all token rebirth campaigns on Phoenix
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-ash-500" />
            <div className="flex gap-1 flex-wrap">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                    filter === f.value
                      ? 'bg-ember-500/20 text-ember-400 border border-ember-500/30'
                      : 'text-ash-400 hover:text-white hover:bg-ash-800/50 border border-transparent'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={32} className="animate-spin text-ember-500" />
          </div>
        ) : migrations.length === 0 ? (
          <div className="phoenix-card p-12 text-center">
            <Flame size={48} className="text-ash-700 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No migrations yet</h3>
            <p className="text-ash-400">
              Be the first to propose a token rebirth.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {migrations.map((m, i) => (
              <MigrationCard key={m.id} migration={m} index={i} />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
