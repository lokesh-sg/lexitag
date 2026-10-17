import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useFixerContext, useTracksContext } from '../contexts/AppContext';
import FixerControls from './FixerControls';
import PlayerBar from './PlayerBar';
import LyricsPanel from './LyricsPanel';
import SelectionHelper from './SelectionHelper';

export default function Layout({ children }) {
  const fixer = useFixerContext();
  const tracks = useTracksContext();
  const [version, setVersion] = useState('');
  const [showLyrics, setShowLyrics] = useState(false);
  const [scanMinimized, setScanMinimized] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        if (data.version) setVersion('v' + data.version);
      })
      .catch(() => setVersion('v0.1.9'));
  }, []);

  useEffect(() => {
    const handleToggle = () => setShowLyrics(prev => !prev);
    document.addEventListener('toggle-lyrics', handleToggle);
    return () => document.removeEventListener('toggle-lyrics', handleToggle);
  }, []);

  return (
    <div className="h-screen w-screen max-w-full flex flex-col bg-surface-0 overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-surface-5/40 bg-surface-1/90 backdrop-blur-md z-30 w-full max-w-full">
        <div className="max-w-[1920px] mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2 sm:gap-2.5 group transition-transform active:scale-95 shrink-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-400 flex items-center justify-center shadow-inner-glow group-hover:shadow-amber-400/20 transition-all">
              <svg className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-surface-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight font-display flex items-baseline gap-1.5 sm:gap-2">
              <div>
                <span className="text-ink-rich">Lexi</span>
                <span className="text-amber-400">Tag</span>
              </div>
              {version && (
                <span className="text-[9px] sm:text-[10px] font-medium bg-surface-3 text-ink-muted px-1.5 py-0.5 rounded border border-surface-5 font-mono">
                  {version}
                </span>
              )}
            </h1>
          </NavLink>

          {/* Nav */}
          <nav className="flex items-center gap-1 sm:gap-1.5">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 ${
                  isActive
                    ? 'bg-surface-3 text-amber-400 shadow-sm'
                    : 'text-ink-muted hover:text-ink-rich hover:bg-surface-3/50'
                }`
              }
            >
              <span className="flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span>Library</span>
              </span>
            </NavLink>
            <NavLink
              to="/album-art"
              className={({ isActive }) =>
                `px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 ${
                  isActive
                    ? 'bg-surface-3 text-amber-400 shadow-sm'
                    : 'text-ink-muted hover:text-ink-rich hover:bg-surface-3/50'
                }`
              }
            >
              <span className="flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span>Album Art</span>
              </span>
            </NavLink>
            <NavLink
              to="/history"
              className={({ isActive }) =>
                `px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 ${
                  isActive
                    ? 'bg-surface-3 text-amber-400 shadow-sm'
                    : 'text-ink-muted hover:text-ink-rich hover:bg-surface-3/50'
                }`
              }
            >
              <span className="flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>History</span>
              </span>
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 ${
                  isActive
                    ? 'bg-surface-3 text-amber-400 shadow-sm'
                    : 'text-ink-muted hover:text-ink-rich hover:bg-surface-3/50'
                }`
              }
              id="settings-nav-btn"
            >
              <span className="flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Settings</span>
              </span>
            </NavLink>
          </nav>
        </div>
      </header>

      {/* Global Scan / Status Refresh Progress Overlay */}
      {tracks?.scanProgress && (
        <div className={`fixed top-20 right-6 z-[60] animate-slide-in-right ${scanMinimized ? 'w-auto' : 'w-80'}`}>
          {scanMinimized ? (
            <div 
              onClick={() => setScanMinimized(false)}
              className="studio-card p-2 flex items-center gap-3 bg-surface-1/95 backdrop-blur-md border-amber-400/30 cursor-pointer hover:bg-surface-2 transition-all shadow-xl"
            >
              <div className="w-8 h-8 rounded-full bg-amber-400/10 flex items-center justify-center relative">
                <svg className="w-4 h-4 text-amber-500 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-amber-600">
                  {tracks.scanProgress.total > 0 ? Math.round((tracks.scanProgress.current / tracks.scanProgress.total) * 100) : 0}%
                </div>
              </div>
              <div className="flex flex-col pr-1">
                <span className="text-[10px] font-bold text-ink-rich uppercase tracking-tight">
                  {tracks.scanProgress.type === 'refresh' ? 'Refreshing' : 'Scanning'}
                </span>
                <span className="text-[9px] text-ink-faint">{tracks.scanProgress.current}/{tracks.scanProgress.total}</span>
              </div>
            </div>
          ) : (
            <div className="studio-card p-4 border-amber-400/30 bg-surface-1/95 backdrop-blur-md shadow-2xl relative">
              <button 
                onClick={() => setScanMinimized(true)}
                className="absolute top-2 right-2 p-1 rounded text-ink-faint hover:text-ink-normal hover:bg-surface-3 transition-all"
                title="Minimize"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
                </svg>
              </button>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-[11px] font-bold text-ink-rich uppercase tracking-wider">
                    {tracks.scanProgress.type === 'refresh' ? 'Status Refresh in Progress' : 'Library Scan in Progress'}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-500 font-bold bg-amber-400/10 px-1.5 py-0.5 rounded mr-5">
                  {tracks.scanProgress.total > 0 ? Math.round((tracks.scanProgress.current / tracks.scanProgress.total) * 100) : 0}%
                </span>
              </div>
              
              <div className="space-y-3">
                <div className="progress-track h-1.5 bg-surface-3">
                  <div 
                    className="progress-fill h-full bg-amber-400 transition-all duration-300" 
                    style={{ width: `${tracks.scanProgress.total > 0 ? (tracks.scanProgress.current / tracks.scanProgress.total) * 100 : 0}%` }}
                  />
                </div>
                
                <div className="flex items-center justify-between text-[10px]">
                  <div className="text-ink-muted truncate max-w-[180px]">
                    {tracks.scanProgress.filename || 'Counting files...'}
                  </div>
                  <div className="text-ink-faint font-mono">
                    {tracks.scanProgress.current} / {tracks.scanProgress.total}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content Wrapper */}
      <div className="flex-1 flex overflow-hidden relative w-full max-w-full min-w-0 pb-20">
        {/* Main Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden transition-all duration-300 relative w-full max-w-full min-w-0">
          <div className="max-w-[1600px] w-full mx-auto px-3 sm:px-6 py-3 sm:py-5 pb-12 min-w-0">
            {children}
          </div>
        </main>

        {/* Lyrics Sidebar / Mobile Overlay */}
        {showLyrics && (
          <div 
            onClick={() => setShowLyrics(false)}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs z-40 md:hidden animate-fade-in"
          />
        )}
        <aside 
          className={`fixed md:relative right-0 top-14 md:top-0 bottom-0 z-50 md:z-auto h-[calc(100%-3.5rem)] md:h-full border-l border-surface-5/40 bg-surface-1/95 md:bg-surface-1/50 backdrop-blur-md md:backdrop-blur-sm transition-all duration-300 ease-in-out ${
            showLyrics ? 'w-full sm:w-[400px] opacity-100 translate-x-0' : 'w-0 opacity-0 translate-x-full md:translate-x-0 pointer-events-none md:pointer-events-auto'
          } overflow-hidden shadow-2xl md:shadow-none`}
        >
          <div className="w-full sm:w-[400px] h-full flex flex-col">
            <LyricsPanel onClose={() => setShowLyrics(false)} />
          </div>
        </aside>
      </div>

      {/* Global Fixer Progress */}
      {fixer.isVisible && (
        <div className="fixed bottom-24 right-3 sm:right-6 z-[150] w-[460px] max-w-[calc(100vw-1.5rem)]">
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


