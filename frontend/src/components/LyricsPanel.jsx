import React, { useEffect, useRef, useMemo } from 'react';
import { usePlayerContext } from '../contexts/AppContext';

export default function LyricsPanel({ onClose }) {
  const player = usePlayerContext();
  const scrollRef = useRef(null);
  const [lyricsText, setLyricsText] = React.useState('');
  const [fetching, setFetching] = React.useState(false);
  
  const { currentTrack, currentTime } = player || {};

  useEffect(() => {
    if (currentTrack?.id) {
        setFetching(true);
        fetch(`/api/tracks/${currentTrack.id}/lyrics`)
            .then(res => res.json())
            .then(data => {
                setLyricsText(data.lyrics || '');
                setFetching(false);
            })
            .catch(err => {
                console.error("Failed to fetch lyrics from disk", err);
                setLyricsText('');
                setFetching(false);
            });
    } else {
        setLyricsText('');
    }
  }, [currentTrack?.id]);

  // Parse LRC formatted lyrics
  const parsedLyrics = useMemo(() => {
    if (!lyricsText) return [];
    
    const lines = lyricsText.split('\n');
    const result = [];
    const timestampRegex = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

    lines.forEach(line => {
      let match;
      let hasMatch = false;
      const timestamps = [];
      
      // Extract all timestamps from the line
      while ((match = timestampRegex.exec(line)) !== null) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseFloat(match[2]);
        timestamps.push(minutes * 60 + seconds);
        hasMatch = true;
      }

      const text = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();
      
      if (hasMatch) {
        timestamps.forEach(time => {
            if (text) result.push({ time, text });
        });
      } else {
        if (text) result.push({ time: -1, text });
      }
    });

    return result.sort((a, b) => a.time - b.time);
  }, [lyricsText]);

  // Find active line
  const activeIndex = useMemo(() => {
    if (parsedLyrics.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (parsedLyrics[i].time !== -1 && parsedLyrics[i].time <= currentTime) {
            idx = i;
        }
    }
    return idx;
  }, [parsedLyrics, currentTime]);

  // Auto-scroll to active line
  useEffect(() => {
    if (activeIndex !== -1 && scrollRef.current) {
        const activeEl = scrollRef.current.children[activeIndex];
        if (activeEl) {
            activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
  }, [activeIndex]);

  if (!currentTrack) return null;

  return (
    <div className="h-full flex flex-col bg-surface-1/50">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-surface-5/10 shrink-0">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 rounded bg-surface-3 border border-surface-5/20 overflow-hidden shrink-0 shadow-sm">
             <img 
                src={`/api/tracks/${currentTrack.id}/cover?t=${Date.now()}`} 
                className="w-full h-full object-cover"
                onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.classList.add('flex', 'items-center', 'justify-center'); }}
             />
             <div className="hidden absolute inset-0 items-center justify-center bg-surface-3">
                 <svg className="w-4 h-4 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
             </div>
          </div>
          <div className="overflow-hidden">
            <h2 className="text-sm font-bold text-ink-rich truncate leading-tight">{currentTrack.title || currentTrack.filename}</h2>
            <p className="text-[11px] text-amber-500 font-medium truncate">{currentTrack.artist || 'Unknown Artist'}</p>
          </div>
        </div>
        <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink-rich hover:bg-surface-3 transition-all shrink-0"
            title="Close Lyrics"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Lyrics Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-10 pb-40">
        <div ref={scrollRef} className="flex flex-col gap-6">
          {parsedLyrics.length > 0 ? (
            parsedLyrics.map((line, idx) => (
              <p 
                key={idx}
                className={`text-lg font-bold transition-all duration-500 leading-relaxed cursor-default ${
                    idx === activeIndex 
                    ? 'text-amber-400 scale-[1.02] opacity-100 blur-0' 
                    : idx < activeIndex 
                        ? 'text-ink-muted/30 opacity-20'
                        : 'text-ink-normal opacity-50 hover:opacity-100'
                }`}
              >
                {line.text}
              </p>
            ))
          ) : (
            <div className="text-center py-20 opacity-40">
                <svg className="w-12 h-12 text-ink-faint mx-auto mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <path d="M12 21c-5-1-9-3-9-8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8c0 5-4 7-9 8z" />
                    <path d="M9 10h6" /><path d="M9 14h3" />
                </svg>
                <h3 className="text-sm font-medium text-ink-faint">No lyrics available</h3>
                <p className="text-[11px] text-ink-faint/60 mt-1">Check file tags or fix metadata.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
