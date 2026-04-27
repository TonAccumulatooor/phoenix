import { Outlet, Link } from 'react-router-dom';
import { Navbar } from './Navbar';
import { EmberParticles } from './EmberParticles';
import { CursorGlow } from './CursorGlow';
import { FireBackground } from './FireBackground';

export function Layout() {
  return (
    <div className="min-h-screen relative">
      <FireBackground />
      <EmberParticles count={80} />
      <CursorGlow />
      <Navbar />
      <main className="relative z-10 pt-16">
        <Outlet />
      </main>
      <footer className="relative z-10 border-t border-ash-800/30 mt-20">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-ash-500 text-sm font-body">
            Phoenix — Token Rebirth Platform for TON
          </div>
          <div className="flex items-center gap-6 text-sm text-ash-500">
            <Link to="/docs" className="hover:text-ember-400 transition-colors">Docs</Link>
            <a href="https://github.com/TonAccumulatooor/phoenix" target="_blank" rel="noopener noreferrer" className="hover:text-ember-400 transition-colors">GitHub</a>
            <a href="https://t.me/phoenixrisetg" target="_blank" rel="noopener noreferrer" className="hover:text-ember-400 transition-colors">Telegram</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
