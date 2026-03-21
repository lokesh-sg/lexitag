import React, { useState } from 'react';
import { useTracksContext, useFixerContext } from '../contexts/AppContext';
import { localFixTracks } from '../api';
import TrackTable from './TrackTable';
import Filters from './Filters';
import SettingsPanel from './SettingsPanel';
import ConfirmModal from './ConfirmModal';
import TrackMetadataModal from './TrackMetadataModal';

export default function Dashboard() {
  const tracks = useTracksContext();
  const fixer = useFixerContext();
  const [selected, setSelected] = useState(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [modalTracks, setModalTracks] = useState(null); // Tracks to show in metadata modal
  const [groupBy, setGroupBy] = useState(''); // Grouping state
  const [cleanFilenames, setCleanFilenames] = useState(false);
  const [modal, setModal] = useState(null); // { type, title, message, onConfirm }


  const [scanMinimized, setScanMinimized] = useState(false);

  const handleSelectAll = () => {
    if (selected.size === tracks.tracks.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tracks.tracks.map(t => t.id)));
    }
  };

  const handleSelect = (ids, mode = 'toggle') => {
    setSelected(prev => {
      const next = new Set(prev);
      const idList = Array.isArray(ids) ? ids : [ids];
      
      if (mode === 'range') {
        // Range mode is special: usually it's used with Shift+Arrow or Shift+Click.
        // For professional behavior, we replace the currently active shift block.
        // However, a simple implementation for now that "removes" is to just
        // be additive but if we want to "shrink", we need the caller to provide
        // the EXACT set of IDs that should be selected in this range transaction.
        return new Set(ids);
      }

      if (mode === 'toggle') {
        if (!Array.isArray(ids) && next.has(ids)) {
          next.delete(ids);
        } else {
          idList.forEach(id => next.add(id));
        }
      } else if (mode === 'add') {
        idList.forEach(id => next.add(id));
      }
      
      return next;
    });
  };

  const handleFix = () => {
    if (selected.size === 0) return;
    
    const isAdding = fixer.isFixing;
    setModal({
      type: 'confirm',
      title: isAdding ? 'Add to Current Queue' : 'Begin Full Fix',
      message: isAdding 
        ? `You already have an active fix job. These ${selected.size} track(s) will be added to the existing queue.`
        : `Are you sure you want to run a FULL AI-powered fix for ${selected.size} track(s)? This will identify metadata and fetch lyrics.`,
      onConfirm: async () => {
        setModal(null);
        try {
          await fixer.fix(Array.from(selected), { clean_filenames: cleanFilenames }, tracks.reload);
          setSelected(new Set());
        } catch (e) {}
      }
    });
  };

  const handlePullLyrics = () => {
    if (selected.size === 0) return;
    
    const isAdding = fixer.isFixing;
    setModal({
      type: 'confirm',
      title: isAdding ? 'Add to Current Queue' : 'Pull Missing Lyrics',
      message: isAdding 
        ? `You already have an active fix job. These ${selected.size} track(s) will be added to the existing queue.`
        : `Are you sure you want to pull missing lyrics for ${selected.size} track(s)? Existing metadata will be preserved.`,
      onConfirm: async () => {
        setModal(null);
        try {
          await fixer.fix(Array.from(selected), { lyrics_only: true }, tracks.reload);
          setSelected(new Set());
        } catch (e) {}
      }
    });
  };

  const handleLocalFix = async () => {
    if (selected.size === 0) return;
    
    const isAdding = fixer.isFixing;
    setModal({
      type: 'confirm',
      title: isAdding ? 'Add to Current Queue' : 'Local Standardization',
      message: isAdding 
        ? `You already have an active fix job. These ${selected.size} track(s) will be added to the existing queue.`
        : `Are you sure you want to locally standardize metadata for ${selected.size} track(s)? This will refresh the files on disk using rules but will not use AI.`,
      onConfirm: async () => {
        setModal(null);
        try {
          await fixer.fix(Array.from(selected), { local_only: true }, tracks.reload);
          setSelected(new Set());
        } catch (e) {}
      }
    });
  };

  const handleFixFilenames = async () => {
    if (selected.size === 0) return;
    
    const isAdding = fixer.isFixing;
    setModal({
      type: 'confirm',
      title: isAdding ? 'Add to Current Queue' : 'Fix Filenames Only',
      message: isAdding 
        ? `You already have an active fix job. These ${selected.size} track(s) will be added to the renaming queue.`
        : `Are you sure you want to fix filenames for ${selected.size} track(s)? This will organize your files (e.g. "Title - Artist.ext") based on existing tags and update the database.`,
      onConfirm: async () => {
        setModal(null);
        try {
          await fixer.fix(Array.from(selected), { filenames_only: true }, tracks.reload);
          setSelected(new Set());
        } catch (e) {}
      }
    });
  };

  const handleBulkEdit = () => {
    if (selected.size === 0) return;
    const selectedTracks = tracks.tracks.filter(t => selected.has(t.id));
    setModalTracks(selectedTracks);
  };

  return (
    <div className="space-y-5 animate-fade-in relative">
      {/* Scan Progress Overlay */}
      {tracks.scanProgress && (
        <div className={`fixed top-24 right-8 z-[60] animate-slide-in-right ${scanMinimized ? 'w-auto' : 'w-80'}`}>
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
                  {Math.round((tracks.scanProgress.current / tracks.scanProgress.total) * 100)}%
                </div>
              </div>
              <div className="flex flex-col pr-1">
                <span className="text-[10px] font-bold text-ink-rich uppercase tracking-tight">Scanning</span>
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
                  {Math.round((tracks.scanProgress.current / tracks.scanProgress.total) * 100)}%
                </span>
              </div>
              
              <div className="space-y-3">
                <div className="progress-track h-1.5 bg-surface-3">
                  <div 
                    className="progress-fill h-full bg-amber-400 transition-all duration-300" 
                    style={{ width: `${(tracks.scanProgress.current / tracks.scanProgress.total) * 100}%` }}
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

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Filename Cleaning Toggle */}
          <label className="flex items-center gap-2 cursor-pointer group bg-surface-2/50 px-3 py-1.5 rounded-lg hover:bg-surface-3 transition-colors border border-surface-4">
              <div className="relative">
                <input 
                  type="checkbox" 
                  className="sr-only" 
                  checked={cleanFilenames}
                  onChange={(e) => {
                    setCleanFilenames(e.target.checked);
                  }}
                />
                <div className={`w-7 h-3.5 rounded-full transition-colors ${cleanFilenames ? 'bg-amber-400' : 'bg-surface-5'}`} />
                <div className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-transform ${cleanFilenames ? 'translate-x-3.5' : ''}`} />
              </div>
              <span className="text-[10px] font-bold text-ink-muted group-hover:text-ink-normal transition-colors uppercase tracking-widest whitespace-nowrap">Clean Filenames</span>
          </label>
          <div>
            <h2 className="text-xl font-bold text-ink-rich font-display">Music Library</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              {tracks.total} track{tracks.total !== 1 ? 's' : ''} indexed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2">
              <button
                onClick={handleFix}
                disabled={fixer.isFixing}
                className="btn-secondary !px-3 disabled:opacity-50 disabled:cursor-not-allowed"
                id="ai-fix-selected-btn"
              >
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  <span>AI Fix {selected.size > 0 ? selected.size : ''}</span>
                </div>
              </button>
              <button
                onClick={handlePullLyrics}
                disabled={fixer.isFixing || selected.size === 0}
                className="btn-secondary !px-3 disabled:opacity-50"
                title="Pull Lyrics Only (LLM)"
              >
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-fn-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                  <span>Pull Lyrics {selected.size > 0 ? selected.size : ''}</span>
                </div>
              </button>
              <button
                onClick={handleLocalFix}
                disabled={selected.size === 0}
                className="btn-secondary !px-3 disabled:opacity-50"
                title="Local Standardization (No LLM)"
              >
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
                    <polyline points="7.5 19.79 7.5 14.6 3 12" />
                    <polyline points="21 12 16.5 14.6 16.5 19.79" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  <span>Local Fix {selected.size > 0 ? selected.size : ''}</span>
                </div>
              </button>
              <button
                onClick={handleFixFilenames}
                disabled={selected.size === 0}
                className="btn-secondary !px-3 disabled:opacity-50"
                title="Fix Filenames based on current tags"
              >
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <span>Fix Names {selected.size > 0 ? selected.size : ''}</span>
                </div>
              </button>
              <button
                onClick={handleBulkEdit}
                className="btn-secondary !px-3"
                title="Edit shared tags"
              >
                <svg className="w-3.5 h-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </div>
          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(v => !v)}
            className={`p-2 rounded-lg transition-all duration-200 ${
              showSettings
                ? 'bg-amber-400/15 text-amber-400'
                : 'text-ink-muted hover:text-ink-normal hover:bg-surface-3'
            }`}
            title="Studio Configuration"
            id="settings-btn"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="2" y1="14" x2="6" y2="14" />
              <line x1="10" y1="8" x2="14" y2="8" />
              <line x1="18" y1="16" x2="22" y2="16" />
            </svg>
          </button>
          <button
            onClick={tracks.refresh}
            disabled={tracks.scanning}
            className="btn-ghost disabled:opacity-50"
            title="Fast junk re-evaluation"
          >
            <span className="flex items-center gap-1.5">
              {tracks.scanning && tracks.scanProgress?.type === 'refresh' ? (
                <svg className="w-3.5 h-3.5 animate-spin-slow text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              )}
              {tracks.scanning && tracks.scanProgress?.type === 'refresh' ? 'Refreshing…' : 'Refresh Status'}
            </span>
          </button>
          <button
            onClick={tracks.scan}
            disabled={tracks.scanning}
            className="btn-ghost disabled:opacity-50"
            id="scan-library-btn"
          >
            <span className="flex items-center gap-1.5">
              {tracks.scanning && tracks.scanProgress?.type !== 'refresh' ? (
                <svg className="w-3.5 h-3.5 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4v5h.582M20 20v-5h-.581M4.582 9A8 8 0 0 1 19.42 15" />
                </svg>
              )}
              {tracks.scanning && tracks.scanProgress?.type !== 'refresh' ? 'Scanning…' : 'Scan Library'}
            </span>
          </button>
        </div>
      </div>

      {/* Settings panel */}
      <SettingsPanel 
        visible={showSettings} 
        onClose={() => {
          setShowSettings(false);
          tracks.reload();
        }} 
      />

      <Filters
        search={tracks.search}
        onSearch={tracks.setSearch}
        searchField={tracks.searchField}
        onSearchFieldChange={tracks.setSearchField}
        filter={tracks.filter}
        onFilter={(f) => {
          if (f === tracks.filter) tracks.reload();
          else tracks.setFilter(f);
        }}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
        pageSize={tracks.pageSize}
        onPageSizeChange={tracks.setPageSize}
      />

      <div className="flex items-center justify-between gap-4 mt-2">
        <div className="flex-1" />
        {tracks.total > tracks.pageSize && (
            <div className="flex items-center gap-1.5">
                <button onClick={() => tracks.setPage(1)} disabled={tracks.page <= 1} className="p-1 px-2 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter">First</button>
                <button onClick={() => tracks.setPage(p => Math.max(1, p-1))} disabled={tracks.page <= 1} className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted">←</button>
                <div className="px-3 py-1 rounded-lg bg-surface-3 border border-surface-4 text-[10px] font-black text-amber-500 tabular-nums">
                    {tracks.page} / {Math.ceil(tracks.total / tracks.pageSize)}
                </div>
                <button onClick={() => tracks.setPage(p => p+1)} disabled={tracks.page * tracks.pageSize >= tracks.total} className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted">→</button>
                <button onClick={() => tracks.setPage(Math.ceil(tracks.total / tracks.pageSize))} disabled={tracks.page * tracks.pageSize >= tracks.total} className="p-1 px-2 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter">Last</button>
            </div>
        )}
      </div>

      {/* Track table */}
      <TrackTable
        tracks={tracks.tracks}
        loading={tracks.loading}
        selected={selected}
        onSelect={handleSelect}
        onSelectAll={handleSelectAll}
        sortBy={tracks.sortBy}
        sortDir={tracks.sortDir}
        onSort={tracks.handleSort}
        onTrackClick={(track) => setModalTracks([track])}
        groupBy={groupBy}
      />

      {/* Pagination */}
      {tracks.total > tracks.pageSize && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-ink-muted">
            {(tracks.page - 1) * tracks.pageSize + 1}–
            {Math.min(tracks.page * tracks.pageSize, tracks.total)} of {tracks.total}
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => tracks.setPage(1)} disabled={tracks.page <= 1} className="p-1 px-2 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter">First</button>
            <button onClick={() => tracks.setPage(p => Math.max(1, p - 1))} disabled={tracks.page <= 1} className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted">← Prev</button>
            <div className="px-3 py-1 rounded-lg bg-surface-3 border border-surface-4 text-[10px] font-black text-amber-500 tabular-nums">
                {tracks.page} / {Math.ceil(tracks.total / tracks.pageSize)}
            </div>
            <button onClick={() => tracks.setPage(p => p + 1)} disabled={tracks.page * tracks.pageSize >= tracks.total} className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted">Next →</button>
            <button onClick={() => tracks.setPage(Math.ceil(tracks.total / tracks.pageSize))} disabled={tracks.page * tracks.pageSize >= tracks.total} className="p-1 px-2 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter">Last</button>
          </div>
        </div>
      )}
      {/* Metadata Modal */}
      {modalTracks && (
        <TrackMetadataModal
          tracks={modalTracks}
          onClose={() => setModalTracks(null)}
          onUpdated={() => {
            tracks.reload();
            setSelected(new Set());
          }}
        />
      )}
      {/* Messaging Modal */}
      {modal && (
        <ConfirmModal
          {...modal}
          onCancel={() => setModal(null)}
          onConfirm={modal.onConfirm || (() => setModal(null))}
        />
      )}
    </div>
  );
}
