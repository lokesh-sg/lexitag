import React, { useState } from 'react';
import { usePlayerContext } from '../contexts/AppContext';
import CastModal from './CastModal';
const TrackMetadataModal = React.lazy(() => import('./TrackMetadataModal'));

function fmt(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PlayerBar() {
  const player = usePlayerContext();
  const [showCast, setShowCast] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  
  const scrubberRef = React.useRef(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragProgress, setDragProgress] = React.useState(0);

  if (!player) return null;

  const { 
    currentTrack, isPlaying, currentTime, duration, volume, 
    togglePlay, seek, changeVolume, next, prev, stop,
    repeatMode, setRepeatMode, shuffleMode, setShuffle,
    isCasting, activeRenderer, stopCast
  } = player;

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const cycleRepeat = () => {
    const modes = ['none', 'all', 'one'];
    const nextMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    setRepeatMode(nextMode);
  };

  const handleScrub = (e) => {
    if (!duration || !scrubberRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setDragProgress(x / rect.width);
  };

  const onMouseDown = (e) => {
    if (!duration) return;
    setIsDragging(true);
    handleScrub(e);
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e) => handleScrub(e);
    const onMouseUp = () => {
      seek(dragProgress * duration);
      setIsDragging(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, dragProgress, duration, seek]);

  const displayPct = isDragging ? dragProgress * 100 : pct;

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-surface-5/30 bg-surface-1/95 backdrop-blur-lg w-full max-w-full overflow-hidden">
        {/* Scrubber - Large Hit Area */}
        <div
          ref={scrubberRef}
          className="h-4 -mt-2 relative z-10 cursor-pointer group flex items-center"
          onMouseDown={onMouseDown}
        >
          {/* Background Track */}
          <div className="absolute inset-x-0 h-[3px] group-hover:h-1 bg-surface-4 transition-all duration-150" />
          
          {/* Progress Bar */}
          <div
            className={`h-[3px] group-hover:h-1 bg-amber-400 absolute ${isDragging ? '' : 'transition-[width] duration-200'}`}
            style={{ width: `${displayPct}%` }}
          />
          
          {/* Thumb/Knob */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-300 shadow-xl border-2 border-amber-500/30 ${isDragging ? '' : 'transition-all duration-200'} ${isDragging ? 'scale-125 opacity-100' : 'opacity-0 group-hover:opacity-100 group-hover:scale-110'}`}
            style={{ left: `${displayPct}%`, marginLeft: '-6px' }}
          />
          
          {/* Hover Time Indicator (Optional but nice) */}
        </div>

        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Track info - Clickable for details */}
          <div 
            className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 cursor-pointer group/info"
            onClick={() => currentTrack && setShowDetails(true)}
            title="View full track details"
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-surface-3 border border-surface-5/40 flex items-center justify-center flex-shrink-0 group-hover/info:border-amber-400/50 transition-colors">
               {currentTrack ? (
                 <img 
                    src={`/api/tracks/${currentTrack.id}/cover?t=${Date.now()}`} 
                    className="w-full h-full object-cover rounded-lg"
                    onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'block';
                    }}
                 />
               ) : null}
              <svg 
                className={`w-4 h-4 ${currentTrack ? (isPlaying ? 'text-amber-400' : 'text-ink-muted') : 'text-ink-muted'}`} 
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ display: currentTrack ? 'none' : 'block' }}
              >
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            {currentTrack ? (
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-semibold text-ink-rich truncate group-hover/info:text-amber-400 transition-colors">
                  {currentTrack.title || currentTrack.filename}
                </p>
                <p className="text-[10px] sm:text-[11px] text-ink-muted truncate group-hover/info:text-ink-normal transition-colors font-medium">
                  {currentTrack.artist || 'Unknown Artist'}
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">No track selected</p>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0 justify-center">
            {/* Shuffle */}
            <button
               onClick={() => setShuffle(!shuffleMode)}
               className={`p-1.5 rounded transition-colors hidden sm:inline-flex ${shuffleMode ? 'text-amber-400' : 'text-ink-muted hover:text-ink-rich'}`}
               title="Shuffle"
            >
               <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" />
               </svg>
            </button>

            {/* Prev */}
            <button
               onClick={prev}
               disabled={!currentTrack}
               className="p-1.5 text-ink-normal hover:text-amber-400 disabled:opacity-20 transition-all"
               title="Previous"
            >
               <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="19,20 9,12 19,4" /><rect x="5" y="4" width="2" height="16" />
               </svg>
            </button>

            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              disabled={!currentTrack}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all duration-150 ${
                currentTrack
                  ? 'bg-amber-400 text-surface-0 hover:bg-amber-300 active:scale-95 shadow-md hover:shadow-lg'
                  : 'bg-surface-4 text-ink-muted cursor-not-allowed'
              }`}
              id="player-play-btn"
            >
              {isPlaying ? (
                <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg className="w-4 h-4 sm:w-5 sm:h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6,3 20,12 6,21" />
                </svg>
              )}
            </button>

            {/* Next */}
            <button
               onClick={next}
               disabled={!currentTrack}
               className="p-1.5 text-ink-normal hover:text-amber-400 disabled:opacity-20 transition-all"
               title="Next"
            >
               <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,4 15,12 5,20" /><rect x="17" y="4" width="2" height="16" />
               </svg>
            </button>

            {/* Repeat */}
            <button
               onClick={cycleRepeat}
               className={`p-1.5 rounded transition-colors relative hidden sm:inline-flex ${repeatMode !== 'none' ? 'text-amber-400' : 'text-ink-muted hover:text-ink-rich'}`}
               title={`Repeat: ${repeatMode}`}
            >
               <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
               </svg>
               {repeatMode === 'one' && (
                 <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] font-bold text-amber-400 mt-0.5">1</span>
               )}
            </button>

            {/* Stop */}
            <button
               onClick={stop}
               disabled={!currentTrack}
               className="p-1.5 text-ink-muted hover:text-red-500 disabled:opacity-20 transition-all ml-0.5 hidden sm:inline-flex"
               title="Stop"
            >
               <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="1" />
               </svg>
            </button>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3.5 flex-1 justify-end shrink-0">
            <span className="text-[10px] sm:text-[11px] text-ink-normal font-mono min-w-[60px] text-right tabular-nums hidden xs:inline">
              {fmt(currentTime)} / {fmt(duration)}
            </span>

            {/* Volume */}
            <div className="hidden md:flex items-center gap-2 group/vol min-w-[120px]">
              <button 
                onClick={() => changeVolume(volume > 0 ? 0 : 0.8)}
                className="p-1 px-1.5 rounded hover:bg-surface-3 transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-ink-normal group-hover/vol:text-amber-400 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H2V15H6L11 19V5Z" />
                    {volume > 0.5 ? <path d="M19.07 4.93C20.9447 6.80528 21.9979 9.34836 21.9979 12C21.9979 14.6516 20.9447 17.1947 19.07 19.07" /> : null}
                    {volume > 0 ? <path d="M15.54 8.46C16.4774 9.39764 17.004 10.6692 17.004 12C17.004 13.3308 16.4774 14.6024 15.54 15.54" /> : null}
                </svg>
              </button>
              <div className="relative flex-1 flex items-center h-4 cursor-pointer">
                <input
                    type="range" min="0" max="1" step="0.01" value={volume}
                    onChange={(e) => changeVolume(parseFloat(e.target.value))}
                    className="w-24 h-1 bg-surface-4 rounded-full appearance-none cursor-pointer group-hover/vol:h-1.5 transition-all
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:hover:scale-125
                        [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-amber-400 [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:shadow-lg [&::-moz-range-thumb]:hover:scale-125"
                    id="volume-slider"
                />
              </div>
            </div>

            {/* Lyrics Toggle */}
            <button
               onClick={() => document.dispatchEvent(new CustomEvent('toggle-lyrics'))}
               disabled={!currentTrack}
               className="p-1.5 rounded-md text-ink-faint hover:text-amber-400 hover:bg-surface-3/60 transition-all disabled:opacity-25"
               title="View Synced Lyrics"
            >
               <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <path d="M8 9h8" /><path d="M8 13h4" />
               </svg>
            </button>

            {/* Cast Controls */}
            <div className="flex items-center gap-1 group/cast">
              {isCasting && (
                <button
                  onClick={stopCast}
                  className="p-1 px-1.5 rounded-md text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-all border border-red-500/20"
                  title="Disconnect / Stop Casting"
                  id="stop-cast-btn"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => setShowCast(true)}
                disabled={!currentTrack}
                className={`p-1.5 rounded-md transition-all disabled:opacity-25 disabled:cursor-not-allowed ${isCasting ? 'text-amber-400 bg-amber-400/10' : 'text-ink-faint hover:text-amber-400 hover:bg-surface-3/60'}`}
                title={isCasting ? `Casting to ${activeRenderer?.name}` : "Cast to UPnP device"}
                id="cast-btn"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
                  <line x1="2" y1="20" x2="2.01" y2="20" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {showCast && currentTrack && (
        <CastModal trackId={currentTrack.id} onClose={() => setShowCast(false)} />
      )}

      {showDetails && currentTrack && (
        <React.Suspense fallback={null}>
          <TrackMetadataModal tracks={[currentTrack]} onClose={() => setShowDetails(false)} />
        </React.Suspense>
      )}
    </>
  );
}
