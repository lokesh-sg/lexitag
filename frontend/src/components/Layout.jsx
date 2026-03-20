import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useFixerContext } from '../contexts/AppContext';
import FixerControls from './FixerControls';
import PlayerBar from './PlayerBar';
import LyricsPanel from './LyricsPanel';
import { fetchHealth } from '../api';
import SelectionHelper from './SelectionHelper';

export default function Layout({ children }) {
  const fixer = useFixerContext();
  const [version, setVersion] = React.useState('');
  const [showLyrics, setShowLyrics] = React.useState(false);

  React.useEffect(() => {
    fetchHealth().then(data => setVersion(data.version)).catch(() => {});
  }, []);

  React.useEffect(() => {
    const handleToggle = () => setShowLyrics(prev => !prev);
    document.addEventListener('toggle-lyrics', handleToggle);
    return () => document.removeEventListener('toggle-lyrics', handleToggle);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-surface-0 overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-surface-5/40 bg-surface-1/90 backdrop-blur-md">
        <div className="max-w-[1920px] mx-auto px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2.5 group transition-transform active:scale-95">
            <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center shadow-inner-glow group-hover:shadow-amber-400/20 transition-all">
              <svg className="w-4.5 h-4.5 text-surface-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <h1 className="text-base font-bold tracking-tight font-display flex items-baseline gap-2">
              <div>
                <span className="text-ink-rich">Lexi</span>
                <span className="text-amber-400">Tag</span>
              </div>
              {version && (
                <span className="text-[10px] font-mono font-medium text-ink-muted/50 bg-surface-3 px-1.5 py-0.5 rounded uppercase tracking-wider">
                  v{version}
                </span>
              )}
            </h1>
          </NavLink>

          {/* Nav */}
          <nav className="flex items-center gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-surface-3 text-amber-400'
                    : 'text-ink-muted hover:text-ink-rich hover:bg-surface-3/50'
                }`
              }
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                Library
              </span>
            </NavLink>
            <NavLink
              to="/history"
              className={({ isActive }) =>
                `px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-surface-3 text-amber-400'
                    : 'text-ink-muted hover:text-ink-rich hover:bg-surface-3/50'
                }`
              }
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                History
              </span>
            </NavLink>
          </nav>
        </div>
      </header>

      {/* Content Wrapper */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Area */}
        <main className={`flex-1 overflow-y-auto transition-all duration-300 relative ${showLyrics ? 'mr-0' : ''}`}>
          <div className="max-w-[1600px] w-full mx-auto px-6 py-6 pb-28">
            {children}
          </div>
        </main>

        {/* Lyrics Sidebar */}
        <aside 
          className={`h-full border-l border-surface-5/10 bg-surface-1/50 backdrop-blur-sm transition-all duration-300 ease-in-out ${
            showLyrics ? 'w-[400px] opacity-100' : 'w-0 opacity-0'
          } overflow-hidden`}
        >
          <div className="w-[400px] h-full flex flex-col">
            <LyricsPanel onClose={() => setShowLyrics(false)} />
          </div>
        </aside>
      </div>

      {/* Global Fixer Progress */}
      {fixer.isVisible && (
        <div className="fixed bottom-24 right-6 z-[150] w-[460px] max-w-[calc(100vw-3rem)]">
          <FixerControls 
            progress={fixer.progress} 
            totalTracks={fixer.totalTracks}
            isFixing={fixer.isFixing} 
            isAborting={fixer.isAborting}
            jobStartTime={fixer.jobStartTime}
            error={fixer.error}
            onDismiss={fixer.dismiss} 
            onAbort={fixer.abort}
          />
        </div>
      )}

      {/* Player */}
      <PlayerBar />
      <SelectionHelper />
    </div>
  );
}
