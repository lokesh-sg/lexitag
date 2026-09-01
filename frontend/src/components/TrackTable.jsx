import React, { useState, useEffect, useRef } from 'react';
import { usePlayerContext } from '../contexts/AppContext';

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const ALL_COLUMNS = [
  { key: 'title', label: 'Title', cls: 'flex-[2.5]', minWidth: '200px', required: true },
  { key: 'artist', label: 'Artist', cls: 'flex-[1.5]', minWidth: '140px' },
  { key: 'album', label: 'Album', cls: 'flex-[1.5]', minWidth: '140px' },
  { key: 'genre', label: 'Genre', cls: 'flex-1', minWidth: '100px' },
  { key: 'year', label: 'Year', cls: 'w-16' },
  { key: 'language', label: 'Language', cls: 'w-20', minWidth: '90px' },
  { key: 'composer', label: 'Composer', cls: 'flex-1', minWidth: '120px' },
  { key: 'duration', label: 'Time', cls: 'w-16' },
  { key: 'bitrate', label: 'Kbps', cls: 'w-16' },
  { key: 'format', label: 'Type', cls: 'w-16' },
  { key: 'comment', label: 'Comment', cls: 'flex-1', minWidth: '150px' },
  { key: 'filename', label: 'Filename', cls: 'flex-1', minWidth: '150px' },
  { key: 'path', label: 'Full Path', cls: 'flex-[2]', minWidth: '250px' },
  { key: 'last_scanned', label: 'Scanned', cls: 'w-24' },
  { key: 'last_fixed_at', label: 'Status/Fixed', cls: 'w-32' },
];

const DEFAULT_COLUMNS = ['title', 'artist', 'album', 'genre', 'language', 'composer', 'duration', 'last_fixed_at'];

export default function TrackTable({
  tracks, loading, selected, onSelect, onSelectAll,
  sortBy, sortDir, onSort, onTrackClick, groupBy
}) {
  const player = usePlayerContext();
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => {
    const saved = localStorage.getItem('lexitag_visible_columns');
    return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
  });
  const menuRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('lexitag_visible_columns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const [columnWidths, setColumnWidths] = useState(() => {
    const saved = localStorage.getItem('lexitag_column_widths');
    return saved ? JSON.parse(saved) : {
        title: 320,
        artist: 180,
        album: 180,
        genre: 120,
        year: 80,
        language: 100,
        composer: 150,
        duration: 80,
        bitrate: 80,
        format: 80,
        comment: 200,
        filename: 200,
        path: 400,
        last_scanned: 150,
        last_fixed_at: 160
    };
  });

  const resizingCol = useRef(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    localStorage.setItem('lexitag_column_widths', JSON.stringify(columnWidths));
  }, [columnWidths]);

  const onResizing = (e) => {
    if (!resizingCol.current) return;
    const diff = e.pageX - startX.current;
    const newWidth = Math.max(60, startWidth.current + diff);
    setColumnWidths(prev => ({
        ...prev,
        [resizingCol.current]: newWidth
    }));
  };

  const onResizeEnd = () => {
    resizingCol.current = null;
    document.removeEventListener('mousemove', onResizing);
    document.removeEventListener('mouseup', onResizeEnd);
    document.body.style.cursor = 'default';
  };

  const onResizeStart = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = key;
    startX.current = e.pageX;
    startWidth.current = columnWidths[key];
    document.addEventListener('mousemove', onResizing);
    document.addEventListener('mouseup', onResizeEnd);
    document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowColumnMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleColumn = (key) => {
    const col = ALL_COLUMNS.find(c => c.key === key);
    if (col?.required) return;
    
    setVisibleColumns(prev => 
      prev.includes(key) 
        ? prev.filter(k => k !== key) 
        : [...prev, key]
    );
  };

  const [draggedKey, setDraggedKey] = useState(null);

  const handleDragStart = (e, key) => {
      setDraggedKey(key);
      e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, key) => {
      e.preventDefault();
      if (draggedKey === key) return;
      
      const draggedIdx = visibleColumns.indexOf(draggedKey);
      const targetIdx = visibleColumns.indexOf(key);
      
      if (draggedIdx === -1 || targetIdx === -1) return;
      
      const newOrder = [...visibleColumns];
      newOrder.splice(draggedIdx, 1);
      newOrder.splice(targetIdx, 0, draggedKey);
      setVisibleColumns(newOrder);
  };

  const activeColumns = visibleColumns
    .map(key => ALL_COLUMNS.find(col => col.key === key))
    .filter(Boolean);

  if (activeColumns.length === 0) {
      activeColumns.push(ALL_COLUMNS.find(c => c.key === 'title'));
  }

  const allSelected = tracks.length > 0 && selected.size === tracks.length;

  // Grouping logic
  const groupedTracks = React.useMemo(() => {
    if (!groupBy || tracks.length === 0) return null;
    
    const groups = {};
    tracks.forEach(track => {
      let groupKey = 'Unknown';
      if (groupBy === 'folder') {
        const pathParts = track.path.split('/');
        pathParts.pop();
        groupKey = pathParts.join('/') || 'Root';
      }
      
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(track);
    });
    
    return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
  }, [tracks, groupBy]);

  const flatVisibleTracks = React.useMemo(() => {
    if (!groupedTracks) return tracks;
    return Object.values(groupedTracks).flat();
  }, [groupedTracks, tracks]);

  // Pre-calculate index map for performance O(n) instead of O(n^2)
  const trackIndexMap = React.useMemo(() => {
    const map = new Map();
    flatVisibleTracks.forEach((t, i) => map.set(t.id, i));
    return map;
  }, [flatVisibleTracks]);

  const pivotIndex = useRef(null);
  const lastIndex = useRef(null);

  const handleSelectOne = (track, index, shiftKey) => {
    if (shiftKey && pivotIndex.current !== null) {
      const start = Math.min(index, pivotIndex.current);
      const end = Math.max(index, pivotIndex.current);
      const rangeIds = flatVisibleTracks.slice(start, end + 1).map(t => t.id);
      onSelect(rangeIds, 'range');
    } else {
      onSelect(track.id, 'toggle');
      pivotIndex.current = index;
    }
    lastIndex.current = index;
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = e.key === 'ArrowDown' ? index + 1 : index - 1;
      if (nextIdx >= 0 && nextIdx < flatVisibleTracks.length) {
        const nextTrack = flatVisibleTracks[nextIdx];
        if (e.shiftKey) {
            handleSelectOne(nextTrack, nextIdx, true);
        }
        // Focus the next row
        const row = document.getElementById(`track-row-${nextIdx}`);
        if (row) row.focus();
        lastIndex.current = nextIdx;
      }
    }
    if (e.key === ' ') {
      e.preventDefault();
      handleSelectOne(flatVisibleTracks[index], index, e.shiftKey);
    }
    if (e.key === 'Enter') {
      onTrackClick(flatVisibleTracks[index]);
    }
  };

  if (loading && tracks.length === 0) {
    return (
      <div className="studio-card p-12 flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-ink-muted text-sm">
          <svg className="w-4 h-4 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
          Loading tracks…
        </div>
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="studio-card p-16 text-center">
        <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-surface-3 flex items-center justify-center">
          <svg className="w-6 h-6 text-ink-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-ink-normal mb-1">No tracks found</h3>
        <p className="text-xs text-ink-muted">
          Click "Scan Library" to import tracks from your music directory.
        </p>
      </div>
    );
  }

  const renderTrackRow = (track, index) => {
    const isActive = player.currentTrack?.id === track.id;
    const isSelected = selected.has(track.id);
    
    return (
      <div 
        key={track.id}
        id={`track-row-${index}`}
        tabIndex={0}
        className={`group flex items-center gap-2 px-4 py-2 border-b border-surface-5/10 hover:bg-surface-3/30 transition-colors cursor-default outline-none focus:bg-amber-400/5 ${isActive ? 'bg-surface-3/60' : ''} ${isSelected ? 'ring-1 ring-inset ring-amber-400/30 bg-amber-400/5' : ''}`}
        onClick={(e) => {
            if (e.target.type === 'checkbox' || e.target.closest('button')) return;
            handleSelectOne(track, index, e.shiftKey);
        }}
        onDoubleClick={() => player.playTrack(track, tracks)}
        onKeyDown={(e) => handleKeyDown(e, index)}
      >
        <div className="w-9 flex-shrink-0">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => handleSelectOne(track, index, e.nativeEvent.shiftKey)}
            onClick={(e) => e.stopPropagation()}
            className="w-3.5 h-3.5 rounded border-surface-5 bg-surface-3 accent-amber-400 cursor-pointer opacity-0 group-hover:opacity-100 checked:opacity-100 transition-opacity"
          />
        </div>

        <div className="w-8 flex-shrink-0 flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); player.playTrack(track, tracks); }}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${isActive ? 'bg-amber-400 text-black shadow-lg shadow-amber-400/20' : 'text-ink-faint hover:text-amber-400 hover:bg-surface-4/60'}`}
            title={isActive && player.isPlaying ? "Pause" : "Play"}
          >
            {isActive && player.isPlaying ? (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,3 20,12 6,21" className={isActive ? "" : "ml-0.5"} />
              </svg>
            )}
          </button>
        </div>

        {activeColumns.map(col => {
            const width = columnWidths[col.key] || 150;
            if (col.key === 'last_fixed_at') {
                return (
                    <div key={col.key} style={{ width }} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 py-1 overflow-hidden shrink-0">
                        {track.has_junk ? (
                        <span className="px-1.5 py-0.5 rounded bg-fn-danger/20 text-[#f2746e] text-[9px] font-bold uppercase tracking-wider border border-fn-danger/35 leading-none shrink-0">
                            Junk
                        </span>
                        ) : null}
                        {track.has_lyrics ? (
                        <span className="px-1.5 py-0.5 rounded bg-fn-success/20 text-[#79cb8d] text-[9px] font-bold uppercase tracking-wider border border-fn-success/35 leading-none shrink-0">
                            LRC
                        </span>
                        ) : (
                        <span className="px-1.5 py-0.5 rounded bg-surface-3 text-ink-muted text-[9px] font-bold uppercase tracking-wider border border-surface-5/50 leading-none shrink-0">
                            No Lyrics
                        </span>
                        )}
                        {track.language && (
                            <span className="px-1.5 py-0.5 rounded bg-surface-3 text-ink-normal text-[9px] font-bold uppercase tracking-wider border border-surface-5/50 leading-none shrink-0">
                                {track.language.substring(0, 3).toUpperCase()}
                            </span>
                        )}
                        {track.llm_fix_count > 0 && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-400 border border-amber-400/35 text-[9px] font-bold uppercase tracking-wider leading-none shrink-0" title={`AI Optimized ${track.llm_fix_count} time(s)`}>
                            ✨ {track.llm_fix_count}
                        </span>
                        )}
                        {track.local_fix_count > 0 && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/35 text-[9px] font-bold uppercase tracking-wider leading-none shrink-0" title={`Locally Standardized ${track.local_fix_count} time(s)`}>
                            📦 {track.local_fix_count}
                        </span>
                        )}
                        {track.last_fixed_at && (
                            <span className="text-[10px] text-ink-muted font-mono font-medium whitespace-nowrap shrink-0">
                            {track.last_fixed_at.split(' ')[1].substring(0, 5)} • {track.last_fixed_at.split(' ')[0].split('-').slice(1).join('/')}
                            </span>
                        )}
                    </div>
                );
            }

            let val = track[col.key] || '—';
            if (col.key === 'duration') val = formatDuration(track.duration);
            if (col.key === 'bitrate' && track.bitrate) val = `${track.bitrate}k`;
            
            const textColorClass = col.key === 'title' 
              ? 'text-ink-rich font-medium' 
              : col.key === 'artist' 
              ? 'text-ink-normal font-medium' 
              : 'text-ink-normal';
            
            return (
                <div 
                    key={col.key} 
                    style={{ width }} 
                    className={`truncate text-sm shrink-0 ${textColorClass} flex items-center gap-2`}
                    onClick={(e) => {
                        if (col.key === 'title') {
                            e.stopPropagation();
                            onTrackClick(track);
                        }
                    }}
                >
                    <span className={`
                        truncate
                        ${col.key === 'title' ? 'hover:text-amber-400 hover:underline decoration-dotted underline-offset-4 cursor-pointer transition-colors duration-150' : ''}
                        ${col.key === 'title' && isActive ? 'text-amber-400 font-bold' : ''}
                    `}>
                        {val}
                    </span>
                    {col.key === 'title' && track.last_fix_type === 'llm' && (
                        <div className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-400/15 border border-amber-400/30 group/timer ml-auto animate-fade-in" title={`AI Fixed: ${track.last_ai_fix_duration ? track.last_ai_fix_duration.toFixed(1) : '—'}s`}>
                            <svg className="w-2.5 h-2.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
                            {track.last_ai_fix_duration > 0 && (
                                <span className="text-[9px] font-mono font-bold text-amber-400 tracking-tighter">
                                    {track.last_ai_fix_duration.toFixed(1)}s
                                </span>
                            )}
                        </div>
                    )}
                </div>
            );
        })}
      </div>
    );
  };

  return (
    <div className="studio-card overflow-x-auto custom-scrollbar">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-5/40 text-[10px] font-bold text-ink-normal uppercase tracking-wider relative bg-surface-2/70 backdrop-blur-sm sticky top-0 z-30 min-w-max">
        <div className="w-9 flex-shrink-0">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            className="w-3.5 h-3.5 rounded border-surface-5 bg-surface-3 accent-amber-400 cursor-pointer"
          />
        </div>
        <div className="w-8 flex-shrink-0">
            <div className="relative" ref={menuRef}>
                <button 
                    onClick={() => setShowColumnMenu(!showColumnMenu)}
                    className={`w-7 h-7 rounded-md flex items-center justify-center transition-all duration-200 relative ${showColumnMenu ? 'bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20' : 'text-ink-faint hover:bg-surface-4 hover:text-ink-muted'}`}
                    title="Customize Columns"
                >
                    {loading ? (
                        <svg className="w-3.5 h-3.5 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M21 12a9 9 0 11-6.219-8.56" />
                        </svg>
                    ) : (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    )}
                </button>
                {showColumnMenu && (
                    <div className="absolute top-full left-0 mt-2 w-56 bg-surface-2 border border-surface-5/20 rounded shadow-2xl z-50 py-3 animate-in fade-in slide-in-from-top-2">
                        <div className="px-4 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold border-b border-surface-5/10 mb-2">Column Manager</div>
                        <div className="max-h-[400px] overflow-y-auto custom-scrollbar px-1">
                            {visibleColumns.map((key) => {
                                const col = ALL_COLUMNS.find(c => c.key === key);
                                if (!col) return null;
                                return (
                                    <div 
                                        key={key} 
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, key)}
                                        onDragOver={(e) => handleDragOver(e, key)}
                                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-3/60 cursor-move transition-colors group rounded-md"
                                    >
                                        <div className="w-4 flex items-center justify-center text-ink-faint group-hover:text-amber-500/50">
                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                <path d="M9 5h6M9 12h6M9 19h6" />
                                            </svg>
                                        </div>
                                        <input 
                                            type="checkbox" 
                                            checked={true}
                                            disabled={col.required}
                                            onChange={() => toggleColumn(key)}
                                            className={`w-3.5 h-3.5 accent-amber-500 ${col.required ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                        />
                                        <span className={`text-xs select-none lowercase first-letter:uppercase flex-1 font-medium ${col.required ? 'text-ink-faint' : 'text-ink-normal'}`}>
                                            {col.label} {col.required && <span className="text-[8px] opacity-40">(REQUIRED)</span>}
                                        </span>
                                    </div>
                                );
                            })}
                            
                            <div className="my-2 border-b border-surface-5/10" />
                            
                            {ALL_COLUMNS.filter(col => !visibleColumns.includes(col.key)).map(col => (
                                <div 
                                    key={col.key} 
                                    className="flex items-center gap-2 px-3 py-1.5 opacity-60 hover:opacity-100 transition-opacity"
                                >
                                    <div className="w-4" />
                                    <input 
                                        type="checkbox" 
                                        checked={false}
                                        onChange={() => toggleColumn(col.key)}
                                        className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                                    />
                                    <span className="text-xs select-none lowercase first-letter:uppercase flex-1 text-ink-faint">
                                        {col.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 px-4 py-2 border-t border-surface-5/10 text-[9px] text-ink-faint italic leading-tight">
                            Tip: Drag active columns (top section) to reorder them instantly.
                        </div>
                    </div>
                )}
            </div>
        </div>
        {activeColumns.map(col => (
          <div
            key={col.key}
            style={{ width: columnWidths[col.key] || 150 }}
            className={`group/header relative shrink-0 ${!col.noSort ? 'cursor-pointer hover:text-ink-muted' : ''} select-none flex items-center gap-1 transition-colors`}
            onClick={() => !col.noSort && onSort(col.key)}
          >
            <span className="truncate">{col.label}</span>
            {!col.noSort && sortBy === col.key && (
              <svg className={`w-2.5 h-2.5 text-amber-500 shrink-0 ${sortDir === 'asc' ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M7 13l5 5 5-5M7 6l5 5 5-5" />
              </svg>
            )}
            
            {/* Resize Handle */}
            <div 
                className={`absolute right-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-surface-5/20 hover:bg-amber-500/60 active:bg-amber-500 cursor-col-resize z-40 rounded-full transition-all hover:h-full hover:rounded-none`}
                onMouseDown={(e) => onResizeStart(e, col.key)}
            />
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="divide-y divide-surface-5/20">
        {groupedTracks ? (
          Object.entries(groupedTracks).map(([groupName, groupTracks]) => {
            // Find global index for each track in group for shift select
            return (
              <React.Fragment key={groupName}>
                {/* Group Header */}
                <div className="flex items-center gap-3 px-4 py-2 bg-surface-2/60 border-y border-surface-5/20 sticky top-0 z-10 backdrop-blur-md shadow-sm min-w-max">
                  <svg className="w-4 h-4 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="text-xs font-semibold text-ink-rich tracking-wide truncate pr-4">
                    {groupName}
                  </span>
                  <span className="text-[10px] text-ink-faint font-semibold bg-surface-4 px-2 py-0.5 rounded-full ml-auto whitespace-nowrap">
                    {groupTracks.length} track{groupTracks.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {/* Group Tracks */}
                {groupTracks.map(track => {
                    const globalIdx = trackIndexMap.get(track.id);
                    return renderTrackRow(track, globalIdx);
                })}
              </React.Fragment>
            );
          })
        ) : (
          tracks.map((track, idx) => renderTrackRow(track, idx))
        )}
      </div>
    </div>
  );
}
