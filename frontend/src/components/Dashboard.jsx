import React, { useState } from 'react';
import { useTracksContext, useFixerContext } from '../contexts/AppContext';
import TrackTable from './TrackTable';
import Filters from './Filters';
import ConfirmModal from './ConfirmModal';
import TrackMetadataModal from './TrackMetadataModal';

export default function Dashboard() {
  const tracks = useTracksContext();
  const fixer = useFixerContext();
  const [selected, setSelected] = useState(new Set());
  const [modalTracks, setModalTracks] = useState(null); // Tracks to show in metadata modal
  const [groupBy, setGroupBy] = useState(''); // Grouping state
  const [cleanFilenames, setCleanFilenames] = useState(false);
  const [modal, setModal] = useState(null); // { type, title, message, onConfirm }

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

  const handleSyncLanguage = () => {
    if (selected.size === 0) return;
    const isAdding = fixer.isFixing;
    setModal({
      type: 'confirm',
      title: isAdding ? 'Add to Current Queue' : 'Sync Language to Genre',
      message: isAdding 
        ? `You already have an active fix job. These ${selected.size} track(s) will be added to the queue.`
        : `Are you sure you want to sync the language to the genre field for ${selected.size} track(s)? This will keep existing tags exactly as they are.`,
      onConfirm: async () => {
        setModal(null);
        try {
          await fixer.fix(Array.from(selected), { language_only: true }, tracks.reload);
          setSelected(new Set());
        } catch (e) {}
      }
    });
  };

  return (
    <div className="space-y-3 animate-fade-in relative">
      {/* Header Bar with Always-Visible File Fixing & Library Action Buttons */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2 sm:gap-3">
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <h2 className="text-base sm:text-2xl font-bold text-ink-rich font-display tracking-tight">Music Library</h2>
          <span className="text-[10px] sm:text-xs text-ink-muted bg-surface-2 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full border border-surface-4 font-mono font-semibold">
            {tracks.total.toLocaleString()} track{tracks.total !== 1 ? 's' : ''}
          </span>
          {selected.size > 0 && (
            <span className="text-[10px] sm:text-xs text-amber-400 bg-amber-400/15 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full border border-amber-400/35 font-bold flex items-center gap-1.5">
              <span>{selected.size.toLocaleString()} selected</span>
              <button
                onClick={() => setSelected(new Set())}
                className="hover:text-white transition-colors ml-0.5"
                title="Clear Selection"
              >
                ×
              </button>
            </span>
          )}
        </div>

        {/* Always-Visible Organized Action Toolbar — Symmetrical full-width rows on mobile, inline on desktop */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-1.5 py-0.5 w-full sm:w-auto max-w-full">
          {/* Group 1: AI & Lyrics Tools + Refresh/Scan on mobile top row */}
          <div className="flex items-center gap-1 bg-surface-1 p-1 rounded-xl border border-surface-4 w-full sm:w-auto justify-between sm:justify-start">
            <button
              onClick={handleFix}
              disabled={fixer.isFixing || selected.size === 0}
              className="btn-secondary flex-1 sm:flex-initial justify-center !px-2 sm:!px-2.5 !py-1.5 !text-[11px] sm:!text-xs shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
              id="ai-fix-selected-btn"
              title="Run full AI metadata & lyrics fix on selected tracks"
            >
              <div className="flex items-center justify-center gap-1 sm:gap-1.5 font-bold whitespace-nowrap">
                <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                <span>AI Fix {selected.size > 0 ? `(${selected.size})` : ''}</span>
              </div>
            </button>

            <button
              onClick={handlePullLyrics}
              disabled={fixer.isFixing || selected.size === 0}
              className="btn-secondary flex-1 sm:flex-initial justify-center !px-2 sm:!px-2.5 !py-1.5 !text-[11px] sm:!text-xs shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
              title="Pull Lyrics Only (LLM)"
            >
              <div className="flex items-center justify-center gap-1 sm:gap-1.5 font-bold whitespace-nowrap">
                <svg className="w-3.5 h-3.5 text-fn-purple shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span>Lyrics {selected.size > 0 ? `(${selected.size})` : ''}</span>
              </div>
            </button>

            {/* Filename Cleaning Toggle */}
            <label
              className="flex items-center justify-center gap-1.5 cursor-pointer group bg-surface-2 px-2 sm:px-2.5 py-1.5 rounded-lg hover:bg-surface-3 transition-colors border border-surface-4 shrink-0"
              title="Also rename files on disk during AI Fix"
            >
              <div className="relative shrink-0">
                <input 
                  type="checkbox" 
                  className="sr-only" 
                  checked={cleanFilenames}
                  onChange={(e) => setCleanFilenames(e.target.checked)}
                />
                <div className={`w-6 h-3 rounded-full transition-colors ${cleanFilenames ? 'bg-amber-400' : 'bg-surface-5'}`} />
                <div className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full bg-white shadow-sm transition-transform ${cleanFilenames ? 'translate-x-3' : ''}`} />
              </div>
              <span className="text-[9px] font-bold text-ink-muted group-hover:text-ink-normal transition-colors uppercase tracking-wider whitespace-nowrap">
                Clean Names
              </span>
            </label>
          </div>

          {/* Group 2: Local & Manual Tag Tools */}
          <div className="grid grid-cols-4 sm:flex items-center gap-1 bg-surface-1 p-1 rounded-xl border border-surface-4 w-full sm:w-auto">
            <button
              onClick={handleLocalFix}
              disabled={selected.size === 0}
              className="btn-secondary justify-center !px-1.5 sm:!px-2.5 !py-1.5 !text-[10px] sm:!text-xs shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
              title="Local Standardization (No LLM)"
            >
              <div className="flex items-center justify-center gap-1 sm:gap-1.5 font-bold whitespace-nowrap">
                <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
                  <polyline points="7.5 19.79 7.5 14.6 3 12" />
                  <polyline points="21 12 16.5 14.6 16.5 19.79" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
                <span>Local Fix {selected.size > 0 ? `(${selected.size})` : ''}</span>
              </div>
            </button>

            <button
              onClick={handleFixFilenames}
              disabled={selected.size === 0}
              className="btn-secondary justify-center !px-1.5 sm:!px-2.5 !py-1.5 !text-[10px] sm:!text-xs shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
              title="Fix Filenames based on current tags"
            >
              <div className="flex items-center justify-center gap-1 sm:gap-1.5 font-bold whitespace-nowrap">
                <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-orange-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <span>Fix Names {selected.size > 0 ? `(${selected.size})` : ''}</span>
              </div>
            </button>

            <button
              onClick={handleSyncLanguage}
              disabled={selected.size === 0}
              className="btn-secondary justify-center !px-1.5 sm:!px-2.5 !py-1.5 !text-[10px] sm:!text-xs shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
              title="Append Language to Genre for Selected"
            >
              <div className="flex items-center justify-center gap-1 sm:gap-1.5 font-bold whitespace-nowrap">
                <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7v4a1 1 0 001 1h3" />
                  <path d="M21 17v-4a1 1 0 00-1-1h-3" />
                  <path d="M21 3v6h-6" />
                  <path d="M3 21v-6h6" />
                  <path d="M16 3l-4 4-4-4" />
                  <path d="M8 21l4-4 4 4" />
                </svg>
                <span>Sync Lang {selected.size > 0 ? `(${selected.size})` : ''}</span>
              </div>
            </button>

            <button
              onClick={handleBulkEdit}
              disabled={selected.size === 0}
              className="btn-secondary justify-center !px-1.5 sm:!px-2.5 !py-1.5 !text-[10px] sm:!text-xs shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
              title="Edit shared tags"
            >
              <div className="flex items-center justify-center gap-1 sm:gap-1.5 font-bold whitespace-nowrap">
                <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>Edit</span>
              </div>
            </button>
          </div>

          {/* Group 3: Library Refresh & Scan */}
          <div className="grid grid-cols-2 sm:flex items-center gap-1 bg-surface-1 p-1 rounded-xl border border-surface-4 w-full sm:w-auto">
            <button
              onClick={tracks.refresh}
              disabled={tracks.scanning}
              className="px-2 sm:px-2.5 py-1.5 rounded-lg bg-surface-2 border border-surface-4 text-ink-normal hover:text-amber-400 hover:bg-surface-3 transition-all disabled:opacity-50 text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
              title="Fast junk re-evaluation"
            >
              {tracks.scanning && tracks.scanProgress?.type === 'refresh' ? (
                <svg className="w-3.5 h-3.5 animate-spin-slow text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              )}
              <span>Refresh</span>
            </button>

            <button
              onClick={tracks.scan}
              disabled={tracks.scanning}
              className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-amber-400/15 border border-amber-400/35 text-amber-400 hover:bg-amber-400/25 transition-all disabled:opacity-50 text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 shrink-0"
              id="scan-library-btn"
              title="Full Library Scan"
            >
              {tracks.scanning && tracks.scanProgress?.type !== 'refresh' ? (
                <svg className="w-3.5 h-3.5 animate-spin-slow text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4v5h.582M20 20v-5h-.581M4.582 9A8 8 0 0 1 19.42 15" />
                </svg>
              )}
              <span>{tracks.scanning && tracks.scanProgress?.type !== 'refresh' ? 'Scanning…' : 'Scan'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Unified Search, Filter Pills, Grouping, Page Size & Compact Pagination Card */}
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
        page={tracks.page}
        total={tracks.total}
        onPageChange={tracks.setPage}
        sortBy={tracks.sortBy}
        sortDir={tracks.sortDir}
        onSortChange={(field, dir) => tracks.handleSort(field, dir)}
      />

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

      {/* Bottom Pagination — Sticky above PlayerBar */}
      {tracks.total > tracks.pageSize && (
        <div className="sticky bottom-2 z-20 studio-card px-2.5 sm:px-4 py-2 sm:py-2.5 bg-surface-1/95 backdrop-blur-md border border-surface-4 shadow-xl flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] sm:text-xs font-mono text-ink-normal">
            <span className="hidden sm:inline">Showing </span>
            <strong className="text-ink-rich">{((tracks.page - 1) * tracks.pageSize + 1).toLocaleString()}–{Math.min(tracks.page * tracks.pageSize, tracks.total).toLocaleString()}</strong> of <strong className="text-amber-400">{tracks.total.toLocaleString()}</strong>
            <span className="hidden sm:inline"> tracks</span>
          </p>
          <div className="flex items-center gap-1 sm:gap-1.5 ml-auto">
            <button onClick={() => tracks.setPage(1)} disabled={tracks.page <= 1} className="p-1 px-2 sm:px-2.5 rounded-lg bg-surface-2 border border-surface-4 hover:border-amber-500/40 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-normal uppercase tracking-tighter">
              <span className="hidden sm:inline">First</span>
              <span className="sm:hidden">«</span>
            </button>
            <button onClick={() => tracks.setPage(p => Math.max(1, p - 1))} disabled={tracks.page <= 1} className="p-1 px-2 sm:px-3 rounded-lg bg-surface-2 border border-surface-4 hover:border-amber-500/40 hover:bg-surface-3 transition-all disabled:opacity-30 text-[11px] sm:text-xs font-bold text-ink-rich">
              <span className="hidden sm:inline">← Prev</span>
              <span className="sm:hidden">‹</span>
            </button>
            <div className="px-2 sm:px-3.5 py-1 rounded-lg bg-surface-0 border border-amber-400/30 text-[11px] sm:text-xs font-mono font-black text-amber-400 tabular-nums">
              <span className="hidden sm:inline">Page </span>{tracks.page} / {Math.ceil(tracks.total / tracks.pageSize)}
            </div>
            <button onClick={() => tracks.setPage(p => p + 1)} disabled={tracks.page * tracks.pageSize >= tracks.total} className="p-1 px-2 sm:px-3 rounded-lg bg-surface-2 border border-surface-4 hover:border-amber-500/40 hover:bg-surface-3 transition-all disabled:opacity-30 text-[11px] sm:text-xs font-bold text-ink-rich">
              <span className="hidden sm:inline">Next →</span>
              <span className="sm:hidden">›</span>
            </button>
            <button onClick={() => tracks.setPage(Math.ceil(tracks.total / tracks.pageSize))} disabled={tracks.page * tracks.pageSize >= tracks.total} className="p-1 px-2 sm:px-2.5 rounded-lg bg-surface-2 border border-surface-4 hover:border-amber-500/40 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-normal uppercase tracking-tighter">
              <span className="hidden sm:inline">Last</span>
              <span className="sm:hidden">»</span>
            </button>
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
