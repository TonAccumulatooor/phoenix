export function shortenAddress(addr: string, chars = 4): string {
  if (!addr) return '';
  return `${addr.slice(0, chars + 2)}...${addr.slice(-chars)}`;
}

export function formatNumber(n: number, decimals = 2): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(decimals)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeRemaining(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m remaining`;
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    proposed: 'Proposed',
    depositing: 'Collecting Deposits',
    qualified: 'Threshold Met',
    selling: 'Selling OLDMEME',
    launching: 'Launching on Groypad',
    distributing: 'Distributing Tokens',
    late_claims: 'Late Claims Open',
    voting: 'Creator Vote Active',
    closed: 'Migration Complete',
    failed: 'Failed',
  };
  return labels[status] || status;
}

export function statusColor(status: string): string {
  const colors: Record<string, string> = {
    proposed: 'text-ash-400',
    depositing: 'text-ember-400',
    qualified: 'text-gold',
    selling: 'text-ember-500',
    launching: 'text-ember-300',
    distributing: 'text-emerald-400',
    late_claims: 'text-amber-400',
    voting: 'text-blue-400',
    closed: 'text-emerald-500',
    failed: 'text-pyre',
  };
  return colors[status] || 'text-ash-400';
}

export function assessmentLabel(assessment: string): {
  label: string;
  color: string;
} {
  const map: Record<string, { label: string; color: string }> = {
    full_launch: { label: 'Full Launch Expected', color: 'text-emerald-400' },
    flexible_launch: { label: 'Flexible Launch', color: 'text-amber-400' },
    minimum_viable: { label: 'Minimum Viable', color: 'text-orange-400' },
    unlikely: { label: 'Unlikely Without Top-up', color: 'text-pyre' },
    no_liquidity: { label: 'No Liquidity Found', color: 'text-ash-500' },
  };
  return map[assessment] || { label: assessment, color: 'text-ash-400' };
}
