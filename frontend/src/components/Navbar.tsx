import { Link, useLocation } from 'react-router-dom';
import { PhoenixLogo } from './PhoenixLogo';
import { TonConnectButton } from '@tonconnect/ui-react';

const NAV_ITEMS = [
  { path: '/', label: 'Home' },
  { path: '/migrations', label: 'Migrations' },
  { path: '/propose', label: 'Propose' },
  { path: '/token', label: 'PHX' },
  { path: '/docs', label: 'Docs' },
];

export function Navbar() {
  const location = useLocation();

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 backdrop-blur-2xl border-b border-ember-500/8"
      style={{
        background: 'linear-gradient(180deg, rgba(7,7,10,0.92) 0%, rgba(7,7,10,0.85) 100%)',
        boxShadow: '0 1px 30px rgba(255,69,0,0.04)',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <PhoenixLogo className="w-9 h-9 group-hover:scale-110 transition-transform duration-300" />
          <span className="text-xl font-display font-bold phoenix-gradient-text tracking-tight">Phoenix</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'text-ember-400 bg-ember-500/10 shadow-[0_0_12px_rgba(255,69,0,0.08)]'
                    : 'text-ash-400 hover:text-white hover:bg-ash-800/40'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <TonConnectButton />
      </div>
    </nav>
  );
}
