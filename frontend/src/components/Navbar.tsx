import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PhoenixLogo } from './PhoenixLogo';
import { TonConnectButton } from '@tonconnect/ui-react';
import { Menu, X } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: 'Home' },
  { path: '/migrations', label: 'Migrations' },
  { path: '/propose', label: 'Propose' },
  { path: '/token', label: 'PHX' },
  { path: '/docs', label: 'Docs' },
];

export function Navbar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          scrolled
            ? 'backdrop-blur-2xl border-b border-ember-500/8'
            : 'border-b border-transparent'
        }`}
        style={{
          background: scrolled
            ? 'linear-gradient(180deg, rgba(7,7,10,0.95) 0%, rgba(7,7,10,0.88) 100%)'
            : 'linear-gradient(180deg, rgba(7,7,10,0.7) 0%, rgba(7,7,10,0) 100%)',
          boxShadow: scrolled ? '0 1px 30px rgba(255,69,0,0.04)' : 'none',
        }}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group" onClick={() => setMobileOpen(false)}>
            <PhoenixLogo className="w-9 h-9 group-hover:scale-110 transition-transform duration-300" />
            <span className="text-xl font-display font-bold phoenix-gradient-text tracking-tight">Phoenix</span>
          </Link>

          {/* Desktop: Floating center pill */}
          <div
            className="hidden md:flex items-center gap-0.5 px-1.5 py-1 rounded-full"
            style={{
              background: 'rgba(14, 14, 20, 0.6)',
              border: '1px solid rgba(255, 143, 0, 0.06)',
              backdropFilter: 'blur(16px) saturate(1.4)',
              boxShadow: '0 2px 20px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.02)',
            }}
          >
            {NAV_ITEMS.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="relative px-4 py-1.5 text-sm font-medium transition-all duration-300 rounded-full"
                  style={{
                    color: active ? '#ffb300' : '#8e8e9a',
                    background: active ? 'rgba(255, 143, 0, 0.08)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.color = '#ffffff';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.color = '#8e8e9a';
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {item.label}
                  {/* Active dot indicator */}
                  {active && (
                    <span
                      className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                      style={{
                        background: 'linear-gradient(135deg, #ffd700, #ff6b00)',
                        boxShadow: '0 0 6px rgba(255, 143, 0, 0.6)',
                      }}
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right side: wallet + mobile toggle */}
          <div className="flex items-center gap-3">
            {/* Ember-styled wallet wrapper */}
            <div className="phoenix-wallet-wrap">
              <TonConnectButton />
            </div>

            {/* Mobile hamburger */}
            <button
              className="md:hidden relative w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300"
              style={{
                background: mobileOpen ? 'rgba(255, 143, 0, 0.1)' : 'rgba(14, 14, 20, 0.5)',
                border: `1px solid ${mobileOpen ? 'rgba(255, 143, 0, 0.2)' : 'rgba(255, 255, 255, 0.05)'}`,
              }}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <X size={18} className="text-ember-400" />
              ) : (
                <Menu size={18} className="text-ash-400" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile slide-in panel */}
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-72 transition-transform duration-300 ease-out md:hidden ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          background: 'linear-gradient(195deg, rgba(14, 14, 20, 0.98), rgba(7, 7, 10, 0.99))',
          borderLeft: '1px solid rgba(255, 143, 0, 0.08)',
          boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-6 h-16 border-b border-ash-800/40">
          <span className="text-sm font-display font-semibold phoenix-gradient-text tracking-wider uppercase">
            Navigate
          </span>
          <button
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{ background: 'rgba(255, 143, 0, 0.08)' }}
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={16} className="text-ember-400" />
          </button>
        </div>

        {/* Panel links */}
        <div className="px-4 py-6 flex flex-col gap-1">
          {NAV_ITEMS.map((item, i) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className="relative flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium transition-all duration-200"
                style={{
                  color: active ? '#ffb300' : '#acacb4',
                  background: active ? 'rgba(255, 143, 0, 0.06)' : 'transparent',
                  transitionDelay: mobileOpen ? `${i * 40}ms` : '0ms',
                }}
              >
                {/* Active left accent bar */}
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                    style={{
                      background: 'linear-gradient(180deg, #ffd700, #ff6b00)',
                      boxShadow: '0 0 8px rgba(255, 143, 0, 0.4)',
                    }}
                  />
                )}
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Panel footer accent */}
        <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
          style={{
            background: 'linear-gradient(0deg, rgba(255, 69, 0, 0.03), transparent)',
          }}
        />
      </div>
    </>
  );
}
