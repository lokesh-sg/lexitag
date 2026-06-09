import React from 'react';
import ProgressBar from './ProgressBar';

export default function FixerControls({ progress, totalTracks, isFixing, isAborting, jobStartTime, error, onDismiss, onAbort }) {
  const [minimized, setMinimized] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStart = React.useRef({ x: 0, y: 0 });

  // Handle Dragging
  const onMouseDown = (e) => {
    if (!minimized || e.target.closest('button')) return;
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
    e.preventDefault();
  };

  React.useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e) => {
      setPosition({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y
      });
    };
    const onMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging]);

  // Reset position when expanded to avoid weird layout shifts
  React.useEffect(() => {
    if (!minimized) setPosition({ x: 0, y: 0 });
  }, [minimized]);

  const trackMap = {};
  progress.forEach(p => {
    trackMap[p.track_id] = { ...trackMap[p.track_id], ...p };
  });
  const tracks = Object.values(trackMap).sort((a, b) => {
    // 1. Running items always at the very top
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (a.status !== 'running' && b.status === 'running') return 1;

    // 2. Finished/Error items (the history) come next, sorted by most recent
    const aHandled = a.status === 'done' || a.status === 'error';
    const bHandled = b.status === 'done' || b.status === 'error';

    if (aHandled && !bHandled) return -1;
    if (!aHandled && bHandled) return 1;

    if (aHandled && bHandled) {
      return (b.updated_at || 0) - (a.updated_at || 0);
    }

    // 3. Waiting items go to the bottom
    return 0;
  });

  // Use the explicitly passed totalTracks if available, otherwise fallback to progress length
  const totalCount = totalTracks || tracks.length;
  const finishedCount = tracks.filter(t => t.step === 'write' && t.status === 'done').length;
  
  // Calculate display index based on finished count to avoid flickering between events
  const displayIdx = Math.min(finishedCount + 1, totalCount);
  
  const overallPct = totalCount > 0 ? Math.round((finishedCount / totalCount) * 100) : 0;

  if (minimized && !error) {
    return (
      <div 
        onMouseDown={onMouseDown}
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        className={`studio-card p-2 shadow-2xl bg-surface-1/90 backdrop-blur-md cursor-grab active:cursor-grabbing hover:bg-surface-2 flex items-center gap-3 animate-slide-in-right border-amber-400/20 select-none ${isDragging ? 'opacity-90 scale-95 z-[100]' : 'transition-all'}`}
      >
        <div 
          onClick={() => setMinimized(false)}
          className="flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded-full bg-amber-400/10 flex items-center justify-center relative pointer-events-none">
            <svg className={`w-4 h-4 text-amber-500 ${isFixing ? 'animate-spin-slow' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-amber-600">
              {overallPct}%
            </div>
          </div>
          <div className="flex flex-col pr-2 pointer-events-none">
            <span className="text-[10px] font-bold text-ink-rich uppercase tracking-wider leading-none">
              {isFixing ? 'Fixing' : 'Completed'}
            </span>
            <span className="text-[11px] font-bold text-amber-500 mt-1 whitespace-nowrap">
              {isFixing ? `Item ${displayIdx} of ${totalCount}` : `${finishedCount} Tracks Fixed`}
            </span>
          </div>
        </div>
        <button 
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-3 border border-surface-5 flex items-center justify-center text-ink-muted hover:text-ink-normal shadow-sm"
          onClick={(e) => { e.stopPropagation(); setMinimized(false); }}
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={`studio-card p-4 space-y-3 animate-slide-up relative ${error ? 'border-fn-danger/30' : ''}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-ink-normal flex items-center gap-2 uppercase tracking-wider">
          {error ? (
            <>
              <svg className="w-3.5 h-3.5 text-fn-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Critical Error
            </>
          ) : isFixing ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin-slow text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              Fixing {displayIdx} of {totalCount}
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 text-fn-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {finishedCount === totalCount ? `${totalCount} Tracks Fixed` : `${finishedCount} of ${totalCount} Tracks Fixed`}
            </>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {isFixing && jobStartTime && (
            <div className="flex items-center gap-2">
              <div className="px-1.5 py-0.5 rounded bg-amber-400/10 border border-amber-400/20 text-[9px] font-mono text-amber-500 flex items-center gap-1">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <ElapsedTime startTime={jobStartTime} />
              </div>
              {onAbort && (
                <button 
                  onClick={onAbort}
                  disabled={isAborting}
                  className={`px-1.5 py-0.5 rounded border text-[8px] font-black uppercase transition-all flex items-center gap-1 ${isAborting ? 'bg-surface-3 border-surface-5 text-ink-muted cursor-not-allowed' : 'bg-fn-danger/10 border-fn-danger/20 text-fn-danger hover:bg-fn-danger/20 animate-pulse'}`}
                  title={isAborting ? "Stopping..." : "Abort ongoing fixes"}
                >
                  <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  {isAborting ? 'Stopping...' : 'Abort'}
                </button>
              )}
            </div>
          )}
          {!error && (
            <button 
              onClick={() => setMinimized(true)}
              className="p-1 rounded bg-surface-3 text-ink-muted hover:text-ink-normal transition-colors"
              title="Minimize"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
              </svg>
            </button>
          )}
          <button 
            onClick={onDismiss}
            className="px-2 py-0.5 rounded bg-surface-3 text-[10px] font-bold text-ink-normal hover:bg-surface-4 transition-colors"
          >
            {isFixing ? 'Stop & Clear' : 'Dismiss'}
          </button>
        </div>
      </div>

      {error && (
        <div className={`p-4 rounded-xl border ${error.includes('Daily API Limit') ? 'bg-amber-400/10 border-amber-400/30' : 'bg-fn-danger/10 border-fn-danger/20'}`}>
          <div className="flex items-start gap-3">
            <svg className={`w-4 h-4 mt-0.5 ${error.includes('Daily API Limit') ? 'text-amber-400' : 'text-fn-danger'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className={`text-xs font-bold leading-tight ${error.includes('Daily API Limit') ? 'text-amber-400' : 'text-fn-danger'}`}>
                {error.includes('Daily API Limit') ? 'DAILY QUOTA EXHAUSTED' : 'CRITICAL ERROR'}
              </p>
              <p className={`text-[11px] mt-1 ${error.includes('Daily API Limit') ? 'text-amber-400/80' : 'text-fn-danger/80'}`}>
                {error.includes('Daily API Limit') 
                  ? "You've reached Gemini's daily free limit (1500 reqs). Please wait for a reset or switch providers in Settings."
                  : error}
              </p>
            </div>
          </div>
        </div>
      )}

      {tracks.length > 0 ? (
        <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar">
          {tracks.map(track => (
            <div key={track.track_id} className="bg-surface-0/60 rounded-lg p-3 border border-surface-5/10">
              <div className="flex items-center justify-between gap-4 mb-2">
                <span className="text-xs text-ink-normal truncate font-medium flex-1">
                  {track.track_name || `Track ${track.track_id}`}
                </span>
                <div className="flex items-center gap-2">
                    {track.track_id && (
                        <div className="text-[9px] font-mono text-ink-faint">
                            <FixedTrackTimer track={track} />
                        </div>
                    )}
                    <span className={`text-[11px] font-bold ${
                    track.status === 'error' ? 'text-fn-danger' :
                    track.status === 'waiting' ? 'text-amber-400 animate-pulse' :
                    track.status === 'done' && track.step === 'write' ? 'text-fn-success' :
                    'text-amber-400'
                    }`}>
                    {track.status === 'error' ? 'Error' :
                    track.status === 'waiting' ? 'Waiting' :
                    track.step === 'write' && track.status === 'done' ? 'Done' :
                    track.step}
                    </span>
                </div>
              </div>
              <ProgressBar 
                step={track.step} 
                status={track.status} 
                stageDurations={track.stageDurations}
              />
              {track.message && (track.status === 'error' || track.status === 'waiting') && (
                <p className={`text-[11px] mt-1.5 font-medium ${track.status === 'error' ? 'text-fn-danger' : 'text-amber-400/90'}`}>
                  {track.message}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ElapsedTime({ startTime }) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const hours = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  
  if (hours > 0) {
    return <span>{hours}:{mins.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}</span>;
  }
  return <span>{mins}:{secs.toString().padStart(2, '0')}</span>;
}

function FixedTrackTimer({ track }) {
    const [currentTime, setCurrentTime] = React.useState(0);
    const isFinished = track.status === 'done' && track.step === 'write';
    
    React.useEffect(() => {
        if (isFinished || track.status === 'error') return;
        
        const start = track.updated_at || Date.now();
        const timer = setInterval(() => {
            setCurrentTime(Math.max(0, Math.floor((Date.now() - start) / 1000)));
        }, 1000);
        return () => clearInterval(timer);
    }, [isFinished, track.status, track.updated_at]);

    if (isFinished) {
        // Calculate total from stage durations if available
        const total = Object.values(track.stageDurations || {}).reduce((a, b) => a + b, 0);
        return <span>{total.toFixed(1)}s</span>;
    }
    
    return <span>{currentTime}s</span>;
}
