import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTonAddress } from '@tonconnect/ui-react';
import { api } from '../lib/api';
import { shortenAddress, formatNumber } from '../lib/utils';
import { Vote as VoteIcon, Trophy, Users, Loader2, CheckCircle } from 'lucide-react';

export function Vote() {
  const { id } = useParams<{ id: string }>();
  const walletAddress = useTonAddress();
  const [results, setResults] = useState<any>(null);
  const [candidateInput, setCandidateInput] = useState('');
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    loadResults();
  }, [id]);

  async function loadResults() {
    try {
      const data = await api.getVoteResults(id!);
      setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleVote() {
    if (!walletAddress || !candidateInput.trim()) return;
    setVoting(true);
    try {
      await api.castVote({
        migration_id: id!,
        voter_wallet: walletAddress,
        candidate_wallet: candidateInput.trim(),
      });
      setVoted(true);
      loadResults();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setVoting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-ember-500" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold mb-2">
          Creator Rewards <span className="phoenix-gradient-text">Vote</span>
        </h1>
        <p className="text-ash-400 mb-8">
          Vote for who should receive the 1.05% Groypad creator rewards for this migration.
          Votes are weighted by your NEWMEME token balance.
        </p>

        {/* Cast Vote */}
        <div className="phoenix-card-glow p-6 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <VoteIcon size={18} className="text-ember-500" />
            Cast Your Vote
          </h2>
          {voted ? (
            <div className="flex items-center gap-3 text-emerald-400">
              <CheckCircle size={20} />
              <span>Vote submitted successfully!</span>
            </div>
          ) : (
            <div>
              <label className="text-sm text-ash-400 mb-2 block">
                Candidate wallet address (who should receive creator rewards)
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={candidateInput}
                  onChange={(e) => setCandidateInput(e.target.value)}
                  placeholder="EQ... or 0:..."
                  className="phoenix-input flex-1 font-mono text-sm"
                />
                <button
                  onClick={handleVote}
                  disabled={voting || !walletAddress || !candidateInput.trim()}
                  className="phoenix-button flex items-center gap-2 disabled:opacity-50"
                >
                  {voting ? <Loader2 size={16} className="animate-spin" /> : 'Vote'}
                </button>
              </div>
              {!walletAddress && (
                <p className="text-xs text-ash-500 mt-2">Connect wallet to vote</p>
              )}
            </div>
          )}
        </div>

        {/* Results */}
        {results && (
          <div className="phoenix-card p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Trophy size={18} className="text-gold" />
                Current Results
              </h2>
              <div className="text-sm text-ash-400 flex items-center gap-2">
                <Users size={14} />
                {results.total_voters} / {results.eligible_voters} voted (
                {results.participation_percent}%)
              </div>
            </div>

            {results.candidates?.length > 0 ? (
              <div className="space-y-3">
                {results.candidates.map((c: any, i: number) => (
                  <div
                    key={c.candidate_wallet}
                    className={`flex items-center gap-4 p-4 rounded-xl ${
                      i === 0
                        ? 'bg-ember-500/10 border border-ember-500/20'
                        : 'bg-ash-800/30'
                    }`}
                  >
                    <div
                      className={`text-lg font-bold w-8 ${
                        i === 0 ? 'text-gold' : 'text-ash-500'
                      }`}
                    >
                      #{i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="font-mono text-sm text-white">
                        {shortenAddress(c.candidate_wallet, 8)}
                      </div>
                      <div className="text-xs text-ash-500">
                        {c.vote_count} votes — {formatNumber(c.total_weight)} weight
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-white">{c.percent}%</div>
                      <div className="w-20 h-2 bg-ash-800 rounded-full overflow-hidden mt-1">
                        <div
                          className="h-full bg-gradient-to-r from-ember-500 to-gold rounded-full"
                          style={{ width: `${c.percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-ash-500 text-center py-8">No votes cast yet</p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
