import React, { useState, useEffect } from 'react';
import { fetchHistory, revertChange, revertBatch, bulkRevert, fetchTrack } from '../api';
import TrackMetadataModal from './TrackMetadataModal';
import HistoryDiffModal from './HistoryDiffModal';

export default function HistoryView() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  // Selection & Action states
  const [selectedIds, setSelectedIds] = useState([]);
  const [batchActionRunning, setBatchActionRunning] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState(null); // { type: 'bulk' | 'batch', id?: string }
  const [detailsEntry, setDetailsEntry] = useState(null); // Entry to show in side-by-side modal
  const [editModalTracks, setEditModalTracks] = useState(null); // Full track data for editing
  const [fetchingTrackId, setFetchingTrackId] = useState(null);
  
  const [pageSize, setPageSize] = useState(50);
  
  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
        setDebouncedSearch(search);
        setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { loadHistory(); }, [page, debouncedSearch, pageSize]);

  async function loadHistory() {
    setLoading(true);
    try {
      const data = await fetchHistory({ page, pageSize, search: debouncedSearch });
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch (err) { console.error('History load failed:', err); }
    finally { setLoading(false); }
  }

  // ── Actions ──

  async function handleRevertSingle(id) {
    setBatchActionRunning(true);
    try { 
      await revertChange(id); 
      await loadHistory(); 
    } catch (err) { alert('Revert failed: ' + err.message); }
    finally { setBatchActionRunning(false); setConfirmingAction(null); }
  }

  async function handleRevertBatch(batchId) {
    setBatchActionRunning(true);
    try { 
      await revertBatch(batchId); 
      await loadHistory(); 
    } catch (err) { alert('Batch revert failed: ' + err.message); }
    finally { setBatchActionRunning(false); setConfirmingAction(null); }
  }

  async function handleBulkRevert() {
    if (selectedIds.length === 0) return;
    setBatchActionRunning(true);
    try { 
      await bulkRevert(selectedIds); 
      setSelectedIds([]);
      await loadHistory(); 
    } catch (err) { alert('Bulk revert failed: ' + err.message); }
    finally { setBatchActionRunning(false); setConfirmingAction(null); }
  }
  
  async function handleTrackClick(trackId) {
    setFetchingTrackId(trackId);
    try {
      const track = await fetchTrack(trackId);
      setEditModalTracks([track]);
    } catch (err) {
      alert('Failed to fetch track details: ' + err.message);
    } finally {
      setFetchingTrackId(null);
    }
  }

  // ── Helpers ──

  const fname = (path) => path.split('/').pop() || path;

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // Grouping logic: identifies clusters of entries with the same batch_id
  const groups = [];
  let currentGroup = null;

  entries.forEach(entry => {
    if (!entry.batch_id) {
      groups.push({ type: 'single', entry });
    } else {
      if (currentGroup && currentGroup.batch_id === entry.batch_id) {
        currentGroup.entries.push(entry);
      } else {
        currentGroup = { type: 'batch', batch_id: entry.batch_id, entries: [entry], timestamp: entry.timestamp };
        groups.push(currentGroup);
      }
    }
  });

  return (
    <div className="space-y-5 animate-fade-in pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-bold text-ink-rich font-display">Change History</h2>
          <p className="text-xs text-ink-muted mt-0.5 font-medium">
            {total} modification{total !== 1 ? 's' : ''} recorded • {selectedIds.length} selected
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {/* Page Size Selector */}
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase text-ink-muted tracking-wider">Per Page</span>
                <select
                    value={pageSize}
                    onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                    }}
                    className="appearance-none bg-surface-2 border border-surface-5/50 text-ink-rich text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400/50 cursor-pointer transition-all"
                >
                    {[25, 50, 100, 200].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
            </div>

            <button 
                onClick={() => loadHistory()}
                disabled={loading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-5/50 text-xs font-bold text-ink-normal hover:bg-surface-3 transition-all ${loading ? 'opacity-50' : 'hover:text-ink-rich hover:border-amber-400/30 shadow-sm'}`}
                title="Refresh History"
            >
                <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-amber-400' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 4v6h-6" />
                    <path d="M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                <span>Refresh</span>
            </button>

            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2 animate-scale-in">
                 <button 
                    onClick={() => setConfirmingAction({ type: 'bulk' })}
                    disabled={batchActionRunning}
                    className="btn-danger !py-1.5 !px-3 text-xs shadow-lg shadow-fn-danger/20"
                 >
                    Revert Selected ({selectedIds.length})
                 </button>
                 <button onClick={() => setSelectedIds([])} className="text-xs text-ink-muted hover:text-ink-rich font-medium">Cancel</button>
              </div>
            )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative group flex-1 max-w-md w-full">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted group-focus-within:text-amber-400 transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <input 
                type="text"
                placeholder="Search history..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-surface-2 border border-surface-5/50 rounded-xl pl-10 pr-10 py-2 text-xs sm:text-sm text-ink-rich outline-none focus:ring-1 focus:ring-amber-400/50 focus:border-amber-400/50 transition-all font-medium"
            />
            {search && (
                <button 
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-surface-4 rounded-full text-ink-muted hover:text-ink-rich transition-all"
                >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
            )}
        </div>

        {total > pageSize && (
            <div className="flex items-center gap-1.5 self-end sm:self-auto">
                <button onClick={() => setPage(1)} disabled={page <= 1} className="p-1 px-2 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter">First</button>
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page <= 1} className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted">←</button>
                <div className="px-3 py-1 rounded-lg bg-surface-3 border border-surface-4 text-[10px] font-black text-amber-500 tabular-nums">
                    {page} / {Math.ceil(total / pageSize)}
                </div>
                <button onClick={() => setPage(p => p+1)} disabled={page * pageSize >= total} className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted">→</button>
                <button onClick={() => setPage(Math.ceil(total / pageSize))} disabled={page * pageSize >= total} className="p-1 px-2 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter">Last</button>
            </div>
        )}
      </div>

      {/* Global Confirmation Overlay */}
      {confirmingAction && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="studio-card max-w-sm w-full p-6 text-center animate-scale-in border-surface-6 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-fn-danger/10 text-fn-danger flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            </div>
            <h3 className="text-lg font-bold text-ink-rich mb-2">Confirm Revert</h3>
            <p className="text-xs text-ink-muted mb-6 leading-relaxed">
              {confirmingAction.type === 'bulk' 
                ? `You are about to revert ${selectedIds.length} tracks to their original state. This action cannot be undone.`
                : `You are about to revert the entire batch of changes. Continue?`
              }
            </p>
            <div className="flex gap-3">
              <button 
                disabled={batchActionRunning}
                onClick={() => confirmingAction.type === 'bulk' ? handleBulkRevert() : handleRevertBatch(confirmingAction.id)}
                className="flex-1 btn-danger py-2.5"
              >
                {batchActionRunning ? 'Processing...' : 'Yes, Revert'}
              </button>
              <button 
                disabled={batchActionRunning}
                onClick={() => setConfirmingAction(null)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-surface-4 text-xs font-bold text-ink-normal hover:bg-surface-5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-Side Comparison Modal */}
      {detailsEntry && (
        <HistoryDiffModal 
          entry={detailsEntry} 
          onClose={() => setDetailsEntry(null)} 
        />
      )}

      {editModalTracks && (
        <TrackMetadataModal 
          tracks={editModalTracks}
          onClose={() => setEditModalTracks(null)}
          onUpdated={() => loadHistory()}
        />
      )}

      {loading ? (
        <div className="studio-card p-12 flex items-center justify-center">
          <div className="flex items-center gap-2 text-ink-muted text-sm">
            <svg className="w-4 h-4 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            Loading history…
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className="studio-card p-16 text-center">
          <h3 className="text-sm font-semibold text-ink-normal">No history yet</h3>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group, gIdx) => (
            group.type === 'batch' ? (
              /* Batch Cluster */
              <div key={group.batch_id} className="rounded-2xl bg-surface-2 border border-surface-4 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-surface-3 flex items-center justify-between border-b border-surface-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                    </div>
                    <div>
                      <div className="text-xs font-black text-ink-normal uppercase tracking-tighter">Batch Operation</div>
                      <div className="text-[10px] text-ink-faint font-mono">{group.timestamp} • {group.entries.length} tracks</div>
                    </div>
                  </div>
                  {group.entries.some(e => !e.reverted) && (
                    <button 
                      onClick={() => setConfirmingAction({ type: 'batch', id: group.batch_id })}
                      className="text-[10px] font-bold text-amber-500 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/30 transition-all"
                    >
                      Revert Entire Batch
                    </button>
                  )}
                </div>
                
                <div className="divide-y divide-surface-4">
                   {group.entries.map(entry => (
                    <HistoryItem 
                      key={entry.id} 
                      entry={entry} 
                      isSelected={selectedIds.includes(entry.id)}
                      onSelect={() => toggleSelect(entry.id)}
                      isExpanded={expandedId === entry.id}
                      onExpand={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                      onRevert={() => setConfirmingAction({ type: 'bulk', id: entry.id })} 
                      onShowDetails={setDetailsEntry}
                      onTrackClick={handleTrackClick}
                      isFetching={fetchingTrackId === entry.track_id}
                    />
                  ))}
                </div>
              </div>
            ) : (
              /* Single Entry */
              <div key={group.entry.id} className="rounded-2xl border border-surface-4 bg-surface-1 shadow-sm overflow-hidden">
                <HistoryItem 
                  entry={group.entry} 
                  isSelected={selectedIds.includes(group.entry.id)}
                  onSelect={() => toggleSelect(group.entry.id)}
                  isExpanded={expandedId === group.entry.id}
                  onExpand={() => setExpandedId(expandedId === group.entry.id ? null : group.entry.id)}
                  onRevert={() => handleRevertSingle(group.entry.id)}
                  onShowDetails={setDetailsEntry}
                  onTrackClick={handleTrackClick}
                  isFetching={fetchingTrackId === group.entry.track_id}
                />
              </div>
            )
          ))}
        </div>
      )}

      {editModalTracks && (
        <TrackMetadataModal 
          tracks={editModalTracks}
          onClose={() => setEditModalTracks(null)}
          onUpdated={() => loadHistory()}
        />
      )}

      {/* Pagination Bottom */}
      {total > pageSize && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-ink-muted">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(1)} disabled={page <= 1} className="p-1 px-2 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter">First</button>
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page <= 1} className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted">← Prev</button>
            <div className="px-3 py-1 rounded-lg bg-surface-3 border border-surface-4 text-[10px] font-black text-amber-500 tabular-nums">
                {page} / {Math.ceil(total / pageSize)}
            </div>
            <button onClick={() => setPage(p => p+1)} disabled={page * pageSize >= total} className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted">Next →</button>
            <button onClick={() => setPage(Math.ceil(total / pageSize))} disabled={page * pageSize >= total} className="p-1 px-2 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter">Last</button>
          </div>
        </div>
      )}
    </div>
  );
}


function HistoryItem({ entry, isSelected, onSelect, isExpanded, onExpand, onRevert, onShowDetails, onTrackClick, isFetching }) {
  const fname = (entry.track_path || '').split('/').pop();
  
  return (
    <div className={`transition-all ${isSelected ? 'bg-amber-400/[0.03]' : ''}`}>
      <div 
        className="flex items-center gap-3 px-4 py-3 cursor-pointer group hover:bg-surface-3 transition-colors"
        onClick={onExpand}
      >
        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
           <input 
              type="checkbox" 
              checked={isSelected}
              onChange={onSelect}
              className="w-4 h-4 rounded border-surface-5 bg-surface-0 text-amber-500 focus:ring-amber-500/40 transition-all cursor-pointer" 
            />
        </div>
        
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${entry.reverted ? 'bg-ink-faint' : 'bg-fn-success'}`} />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p 
              onClick={(e) => { e.stopPropagation(); onTrackClick(entry.track_id); }}
              className={`text-sm font-semibold truncate hover:text-amber-500 transition-colors ${entry.reverted ? 'text-ink-muted' : 'text-ink-normal'}`}
            >
              {fname}
            </p>
            {isFetching && (
              <svg className="w-3 h-3 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
            )}
          </div>
          {!entry.reverted && <p className="text-[9px] text-ink-faint font-mono mt-0.5">{entry.timestamp}</p>}
        </div>

        {entry.reverted ? (
          <span className="tag bg-surface-4 text-ink-faint border-surface-5 opacity-60">reverted</span>
        ) : (
          <button 
            onClick={(e) => { e.stopPropagation(); onRevert(); }}
            className="opacity-0 group-hover:opacity-100 btn-ghost !text-[10px] !py-1 !px-2 text-fn-danger hover:bg-fn-danger/10"
          >
            Revert
          </button>
        )}

        <svg className={`w-3 h-3 text-ink-faint transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9" /></svg>
      </div>

      {isExpanded && (
        <div className="px-6 py-4 bg-surface-0 border-t border-surface-4 animate-fade-in">
           <div className="grid grid-cols-2 gap-8">
              <div>
                <h4 className="text-[10px] font-black uppercase text-fn-danger/70 mb-3 tracking-widest">Original</h4>
                <div className="space-y-1.5">
                  {Object.entries(entry.original_tags).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-[11px]">
                      <span className="w-16 flex-shrink-0 text-ink-faint">{k}</span>
                      <span className="text-ink-muted font-mono truncate">{v || '∅'}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-[10px] font-black uppercase text-fn-success/70 mb-3 tracking-widest">Modified</h4>
                <div className="space-y-1.5">
                  {Object.entries(entry.changed_tags).map(([k, v]) => {
                    const changed = entry.original_tags[k] !== v;
                    return (
                      <div key={k} className={`flex gap-2 text-[11px] ${changed ? 'font-bold' : ''}`}>
                        <span className="w-16 flex-shrink-0 text-ink-faint">{k}</span>
                        <span className={`font-mono truncate ${changed ? 'text-fn-success' : 'text-ink-muted'}`}>
                          {v || '∅'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
           </div>
           {Object.keys(entry.raw_before || {}).length > 0 && (
              <div className="mt-6 pt-4 border-t border-dashed border-surface-4 flex justify-end">
                <button 
                  onClick={(e) => { e.stopPropagation(); onShowDetails(entry); }}
                  className="btn-secondary !py-1 !px-4 text-[10px] flex items-center gap-2 group"
                >
                  <svg className="w-3 h-3 group-hover:rotate-12 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                  View Full Raw Changes
                </button>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
