import React, { useState, useEffect } from 'react';
import { fetchRawTags, updateTracks, fetchHistory, fetchTrack, previewFix } from '../api';
import { useFixerContext } from '../contexts/AppContext';
import HistoryDiffModal from './HistoryDiffModal';

export default function TrackMetadataModal({ tracks, onClose, onUpdated }) {
  const fixer = useFixerContext();
  const [loading, setLoading] = useState(true);
  const [rawTags, setRawTags] = useState({});
  const [history, setHistory] = useState([]);
  const [isAuditing, setIsAuditing] = useState(false);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState(null);
  const [formData, setFormData] = useState({
    title: '', artist: '', album: '', genre: '', year: '', 
    composer: '', comment: '', lyrics: '', language: '',
    newPath: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showAddTag, setShowAddTag] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);
  
  // Local state for editing raw tags
  const [editingRawKey, setEditingRawKey] = useState(null);
  const [rawEditValue, setRawEditValue] = useState("");
  const [newTagKey, setNewTagKey] = useState("");
  const [newTagValue, setNewTagValue] = useState("");

  const isBulk = tracks.length > 1;

  const trackIdsKey = tracks.map(t => t.id).join(',');

  useEffect(() => {
    loadData();
    
    // Auto-refresh if a new selection rule was added successfully anywhere
    const handleRuleRefresh = async (e) => {
        if (!tracks.length) return;
        const trackId = tracks[0].id;
        try {
            // First, trigger-backend re-clean based on the NEW rules
            await fetch(`/api/tracks/${trackId}/refresh-local`, { method: 'POST' });
            // Then reload all data in modal
            await loadData();
        } catch (err) {
            console.error("Auto-refresh failed after rule add:", err);
        }
    };
    
    document.addEventListener('cleanup-rule-added', handleRuleRefresh);
    return () => document.removeEventListener('cleanup-rule-added', handleRuleRefresh);
  }, [trackIdsKey, isBulk]);

  const loadData = async () => {
    if (!tracks.length) return;
    setLoading(true);
    const trackId = tracks[0].id;
    try {
      if (isBulk) {
        // Bulk logic
        const first = tracks[0];
        setFormData({
          title: tracks.every(t => t.title === first.title) ? first.title : '',
          artist: tracks.every(t => t.artist === first.artist) ? first.artist : '',
          album: tracks.every(t => t.album === first.album) ? first.album : '',
          genre: tracks.every(t => t.genre === first.genre) ? first.genre : '',
          year: tracks.every(t => t.year === first.year) ? first.year : '',
          composer: tracks.every(t => t.composer === first.composer) ? first.composer : '',
          comment: '', lyrics: '',
          language: tracks.every(t => t.language === first.language) ? first.language : '',
          newPath: '',
        });
        setLoading(false);
      } else {
          const [raw, lyricsRes, historyRes, trackRecord] = await Promise.all([
            fetchRawTags(trackId),
            fetch(`/api/tracks/${trackId}/lyrics`).then(res => res.json()),
            fetchHistory({ trackId: trackId, pageSize: 100 }),
            fetchTrack(trackId)
          ]);
          
          const tags = raw.tags || {};
          setRawTags(tags);
          
          setFormData({
            title: trackRecord.title || tags['TIT2'] || '',
            artist: trackRecord.artist || tags['TPE1'] || '',
            album: trackRecord.album || tags['TALB'] || '',
            genre: trackRecord.genre || tags['TCON'] || '',
            year: trackRecord.year || tags['TDRC'] || '',
            composer: trackRecord.composer || tags['TCOM'] || '',
            comment: trackRecord.comment || tags['COMM::eng'] || '',
            lyrics: lyricsRes.lyrics || '',
            language: trackRecord.language || tags['TLAN'] || '',
            newPath: trackRecord.path || '',
          });
          
          setHistory(historyRes.entries || []);
      }
    } catch (err) {
      console.error("Failed to refresh modal data", err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    if (!isBulk) {
        const revMap = {
            'title': 'TIT2', 'artist': 'TPE1', 'album': 'TALB',
            'genre': 'TCON', 'year': 'TDRC', 'composer': 'TCOM',
            'language': 'TLAN', 'comment': 'COMM::eng', 'lyrics': 'USLT::eng'
        };
        const rawKey = revMap[name];
        if (rawKey) {
            setRawTags(prev => ({ ...prev, [rawKey]: value }));
        }
    }
  };

  const handleRawTagEdit = (key, value) => {
    setEditingRawKey(key);
    setRawEditValue(Array.isArray(value) ? value.join("; ") : String(value));
  };

  const saveRawTag = () => {
    if (editingRawKey) {
        const val = rawEditValue;
        setRawTags(prev => ({ ...prev, [editingRawKey]: val }));
        
        const keyMap = {
            'TIT2': 'title', 'TPE1': 'artist', 'TALB': 'album',
            'TCON': 'genre', 'TDRC': 'year', 'TCOM': 'composer',
            'TLAN': 'language', 'USLT::eng': 'lyrics', 'COMM::eng': 'comment'
        };
        const stdKey = keyMap[editingRawKey];
        if (stdKey) {
            setFormData(prev => ({ ...prev, [stdKey]: val }));
        }
        setEditingRawKey(null);
        setRawEditValue("");
    }
  };

  const deleteRawTag = (key) => {
    setRawTags(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
    });
  };

  const addNewTag = () => {
    if (newTagKey && newTagValue) {
        setRawTags(prev => ({ ...prev, [newTagKey.toUpperCase()]: newTagValue }));
        setNewTagKey("");
        setNewTagValue("");
        setShowAddTag(false);
    }
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const trackIds = tracks.map(t => t.id);
      await updateTracks(
        trackIds, 
        {
          title: formData.title,
          artist: formData.artist,
          album: formData.album,
          genre: formData.genre,
          year: formData.year,
          composer: formData.composer,
          comment: formData.comment,
        }, 
        formData.lyrics, 
        formData.language, 
        isBulk ? null : rawTags,
        isBulk ? null : formData.newPath
      );
      setShowSuccess(true);
      onUpdated && onUpdated();
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      setError(err.message || 'Failed to save tags');
    } finally {
      setSaving(false);
    }
  };

  const handlePullLyrics = () => {
    const trackIds = tracks.map(t => t.id);
    fixer.fix(trackIds, { lyrics_only: true }, () => {
      loadData();
      onUpdated && onUpdated();
    });
  };

  const handleAiFix = () => {
    const trackIds = tracks.map(t => t.id);
    fixer.fix(trackIds, {}, () => {
      loadData();
      onUpdated && onUpdated();
    });
  };

  const handleLocalFix = () => {
    const trackIds = tracks.map(t => t.id);
    fixer.fix(trackIds, { local_only: true }, () => {
      loadData();
      onUpdated && onUpdated();
    });
  };

  const handlePreviewFix = async () => {
    if (isBulk) return;
    setLoading(true);
    try {
      const trackIds = tracks.map(t => t.id);
      const res = await previewFix(trackIds);
      if (res.success && res.results && res.results.length > 0) {
        const result = res.results[0];
        const rawBefore = { ...rawTags }; 
        const rawAfter = { ...rawTags };
        
        for (const [k, v] of Object.entries(result.diffs)) {
            // Apply the 'old' value to the 'before' side
            // This ensures synthetic keys like [Scanner Diagnostics] show their reason
            if (v.old !== undefined && v.old !== null) {
                rawBefore[k] = v.old;
            }
            
            // Apply the 'new' value to our local state copy for 'after'
            if (v.new !== undefined && v.new !== "") {
                rawAfter[k] = v.new;
            } else {
                delete rawAfter[k];
            }
        }
        
        setPreviewResult({
            track_path: result.filename,
            raw_before: { ...rawBefore }, // Force new object ref
            raw_after: { ...rawAfter }
        });
      }
    } catch (e) {
      setError("Preview failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFixFilenames = () => {
    const trackIds = tracks.map(t => t.id);
    fixer.fix(trackIds, { filenames_only: true }, () => {
      loadData();
      onUpdated && onUpdated();
    });
  };

  if (!tracks.length) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink-rich/60 backdrop-blur-sm animate-fade-in">
      <div className={`bg-surface-1 rounded-2xl border border-surface-5/30 w-full flex flex-col shadow-2xl overflow-hidden transition-all duration-300 ${isAuditing ? 'max-w-7xl' : 'max-w-6xl'} max-h-[90vh]`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-5/20 flex items-center justify-between bg-surface-1/50">
          <div>
            <h2 className="text-lg font-bold text-ink-rich flex items-center gap-2">
              <svg className={`w-5 h-5 ${isAuditing ? 'text-blue-400' : 'text-amber-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isAuditing ? (
                    <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : (
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                )}
              </svg>
              {isAuditing 
                ? `Audit History: ${tracks[0].filename}` 
                : isBulk ? `Bulk Edit ${tracks.length} Tracks` : tracks[0].filename
              }
            </h2>
          </div>
          <div className="flex items-center gap-3">
             {isAuditing && (
                <button 
                  onClick={() => {
                    setIsAuditing(false);
                    setSelectedHistoryEntry(null);
                  }}
                  className="text-xs font-bold text-ink-faint hover:text-ink-normal uppercase tracking-widest px-4 py-2 rounded-lg bg-surface-5/30 transition-all"
                >
                  Back to Editor
                </button>
             )}
             <button onClick={onClose} className="p-2 hover:bg-surface-5/30 rounded-xl transition-colors text-ink-muted">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
             </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {isAuditing ? (
            <HistoryAuditView 
              history={history} 
              selectedEntry={selectedHistoryEntry} 
              onSelectEntry={setSelectedHistoryEntry}
            />
          ) : (
            <>
              {/* Edit Mode Content */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col lg:row gap-8 lg:flex-row custom-scrollbar">
                {/* Main Fields Form */}
                <form id="metadata-form" onSubmit={handleSave} className="flex-1 space-y-6">
                  <h3 className="text-xs font-bold text-ink-faint uppercase tracking-[0.2em] mb-4">Standard Metadata</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    {[
                      { label: 'Title', name: 'title' },
                      { label: 'Artist', name: 'artist' },
                      { label: 'Album / Movie', name: 'album' },
                      { label: 'Genre', name: 'genre' },
                      { label: 'Year', name: 'year' },
                      { label: 'Composer', name: 'composer' },
                      { label: 'Language', name: 'language' }
                    ].map(field => (
                      <div key={field.name} className="space-y-1.5">
                        <label className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">{field.label}</label>
                        <input
                          name={field.name}
                          value={formData[field.name]}
                          onChange={handleChange}
                          className="w-full bg-surface-2 border border-surface-5/30 rounded-lg px-3 py-2 text-sm text-ink-normal focus:ring-1 focus:ring-amber-400 outline-none transition-all placeholder:italic"
                          placeholder={isBulk ? "(Multiple values)" : ""}
                        />
                      </div>
                    ))}
                  </div>

                  {!isBulk && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">File Path (Migration)</label>
                      <div className="relative group">
                          <input
                              name="newPath"
                              value={formData.newPath}
                              onChange={handleChange}
                              className="w-full bg-surface-2 border border-surface-5/30 rounded-lg px-3 py-2 text-xs text-ink-muted font-mono focus:ring-1 focus:ring-amber-400 outline-none"
                          />
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-[8px] uppercase font-bold text-amber-500/60 bg-amber-500/5 px-1.5 py-0.5 rounded border border-amber-500/10">Physical Move</span>
                          </div>
                      </div>
                      <p className="text-[9px] text-ink-faint italic px-1">Changing this will physically move the file on your disk and update the library.</p>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">Lyrics</label>
                    <textarea
                      name="lyrics"
                      value={formData.lyrics}
                      onChange={handleChange}
                      rows={isBulk ? 2 : 6}
                      className="w-full bg-surface-2 border border-surface-5/30 rounded-lg px-3 py-2 text-sm text-ink-normal focus:ring-1 focus:ring-amber-400 outline-none font-mono text-xs leading-relaxed"
                    />
                  </div>

                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-500">
                      {error}
                    </div>
                  )}
                </form>

                {/* Raw / Universal Editor Side */}
                {!isBulk && (
                  <div className="lg:w-[400px] bg-surface-2 rounded-xl border border-surface-5/20 flex flex-col max-h-[600px] overflow-hidden">
                      <div className="px-4 py-3 border-b border-surface-5/20 bg-surface-3 flex items-center justify-between">
                          <h3 className="text-[10px] font-bold text-ink-normal uppercase tracking-widest">Universal Tag Editor</h3>
                          <button 
                              onClick={() => setShowAddTag(!showAddTag)}
                              className="p-1 hover:bg-surface-4 rounded transition-colors text-amber-500"
                              title="Add Custom Tag"
                          >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                              </svg>
                          </button>
                      </div>

                      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                          {showAddTag && (
                              <div className="p-3 bg-surface-3 rounded-lg border border-amber-500/30 space-y-2 mb-4 animate-scale-in">
                                  <div className="grid grid-cols-2 gap-2">
                                      <input 
                                          placeholder="TAG_KEY" 
                                          value={newTagKey} 
                                          onChange={e => setNewTagKey(e.target.value)}
                                          className="bg-surface-1 border border-surface-5/30 rounded px-2 py-1 text-[10px] outline-none font-mono"
                                      />
                                      <input 
                                          placeholder="Value" 
                                          value={newTagValue} 
                                          onChange={e => setNewTagValue(e.target.value)}
                                          className="bg-surface-1 border border-surface-5/30 rounded px-2 py-1 text-[10px] outline-none"
                                      />
                                  </div>
                                  <div className="flex justify-end gap-2">
                                      <button onClick={() => setShowAddTag(false)} className="text-[9px] uppercase font-bold text-ink-muted px-2 py-1">Cancel</button>
                                      <button onClick={addNewTag} className="text-[9px] uppercase font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded">Add Tag</button>
                                  </div>
                              </div>
                          )}

                          {loading ? (
                              <div className="flex items-center gap-2 text-ink-faint text-[10px] italic py-4">
                                  <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                                  Analyzing file frames...
                              </div>
                          ) : (
                              Object.entries(rawTags).map(([key, val]) => (
                                  <div key={key} className="group relative bg-surface-1/50 rounded-lg p-2.5 border border-surface-5/10 hover:border-amber-500/40 transition-all">
                                      <div className="flex items-center justify-between mb-1">
                                          <span className="text-[10px] font-bold text-amber-500 font-mono tracking-tight">{key}</span>
                                          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                              <button 
                                                  onClick={() => handleRawTagEdit(key, val)}
                                                  className="p-1 hover:text-amber-400 transition-colors"
                                              >
                                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                              </button>
                                              <button 
                                                  onClick={() => deleteRawTag(key)}
                                                  className="p-1 hover:text-red-400 transition-colors"
                                              >
                                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                              </button>
                                          </div>
                                      </div>
                                      
                                      {editingRawKey === key ? (
                                          <div className="mt-2 space-y-2">
                                              <textarea
                                                  value={rawEditValue}
                                                  onChange={e => setRawEditValue(e.target.value)}
                                                  rows={2}
                                                  className="w-full bg-surface-3 border border-amber-500/50 rounded p-1.5 text-[10px] outline-none"
                                              />
                                              <div className="flex justify-end gap-2">
                                                  <button onClick={() => setEditingRawKey(null)} className="text-[9px] font-bold text-ink-muted">Cancel</button>
                                                  <button onClick={saveRawTag} className="text-[9px] font-bold text-amber-500">Save</button>
                                              </div>
                                          </div>
                                      ) : val === "__ALBUM_ART__" ? (
                                          <div className="mt-1 flex justify-center bg-surface-4/30 rounded-lg p-2 border border-surface-5/10">
                                              <img 
                                                  src={`/api/tracks/${tracks[0].id}/cover?t=${Date.now()}`} 
                                                  alt="Cover Art"
                                                  className="max-w-full h-auto rounded shadow-lg border border-surface-5/20 max-h-[200px] object-contain"
                                                  onError={(e) => {
                                                      e.target.style.display = 'none';
                                                      e.target.insertAdjacentHTML('afterend', '<span class="text-[9px] text-ink-faint italic">Failed to load cover art</span>');
                                                  }}
                                              />
                                          </div>
                                      ) : (
                                          <div className="text-[10px] text-ink-muted break-all leading-tight">
                                              {Array.isArray(val) ? val.join('; ') : String(val)}
                                          </div>
                                      )}
                                  </div>
                              ))
                          )}
                      </div>
                  </div>
                )}
              </div>

              {/* Footer - Only show in Edit mode */}
              <div className="px-6 py-4 border-t border-surface-5/20 bg-surface-2 flex items-center justify-end gap-3">
                {showSuccess ? (
                  <>
                    <span className="text-xs font-bold text-fn-success flex items-center gap-1.5 animate-fade-in mr-auto pl-2">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                      Changes persisted to disk successfully!
                    </span>
                    <button onClick={onClose} className="btn-primary !bg-fn-success !text-white px-8">Done</button>
                  </>
                ) : (
                  <>
                    {!isBulk && history.length > 0 && (
                      <button 
                        onClick={() => {
                          setIsAuditing(true);
                          if (!selectedHistoryEntry) setSelectedHistoryEntry(history[0]);
                        }}
                        className="btn-secondary !text-[11px] !py-1.5 !px-3 mr-2 flex items-center gap-2 group"
                      >
                        <svg className="w-3.5 h-3.5 text-amber-500 group-hover:rotate-12 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        History ({history.length})
                      </button>
                    )}
                    <button 
                      onClick={handlePreviewFix}
                      disabled={fixer.isFixing || saving || isBulk}
                      className="btn-secondary !text-[11px] !py-1.5 !px-3 flex items-center gap-2 group"
                      title="Dry-run to see expected cleaning without saving"
                    >
                      <svg className="w-3.5 h-3.5 text-blue-300 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      Preview {tracks.length > 0 && !isBulk ? '' : '(Single)'}
                    </button>
                    <button 
                      onClick={handleLocalFix}
                      disabled={fixer.isFixing || saving}
                      className="btn-secondary !text-[11px] !py-1.5 !px-3 flex items-center gap-2 group"
                      title="Standardize mapping & clean junk locally"
                    >
                      <svg className="w-3.5 h-3.5 text-blue-500 group-hover:rotate-45 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      </svg>
                      Local Fix {tracks.length > 0 ? tracks.length : ''}
                    </button>
                    <button 
                      onClick={handleAiFix}
                      disabled={fixer.isFixing || saving}
                      className="btn-secondary !text-[11px] !py-1.5 !px-3 flex items-center gap-2 group"
                      title="Google-Grounded Deep Metadata Correction"
                    >
                      <svg className="w-3.5 h-3.5 text-amber-500 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                      </svg>
                      AI Fix {tracks.length > 0 ? tracks.length : ''}
                    </button>
                    <button 
                      onClick={handleFixFilenames}
                      disabled={fixer.isFixing || saving}
                      className="btn-secondary !text-[11px] !py-1.5 !px-3 flex items-center gap-2 group"
                      title="Fix Filenames based on current tags"
                    >
                      <svg className="w-3.5 h-3.5 text-orange-400 group-hover:rotate-12 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                      Fix Names {tracks.length > 0 ? tracks.length : ''}
                    </button>
                    <button 
                      onClick={handlePullLyrics}
                      disabled={fixer.isFixing || saving}
                      className="btn-secondary !text-[11px] !py-1.5 !px-3 mr-auto flex items-center gap-2 group"
                      title="AI Fetch Lyrics (Non-destructive)"
                    >
                      <svg className="w-3.5 h-3.5 text-fn-purple group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                      Pull Lyrics {tracks.length > 0 ? tracks.length : ''}
                    </button>
                    <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
                    <button
                      form="metadata-form"
                      type="submit"
                      disabled={saving}
                      className="btn-primary text-sm px-6"
                    >
                      {saving ? 'Saving...' : `Apply All Changes`}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {selectedHistoryEntry && !isAuditing && (
            <HistoryDiffModal 
                entry={selectedHistoryEntry}
                onClose={() => setSelectedHistoryEntry(null)}
            />
        )}
        
        {previewResult && !isAuditing && (
            <HistoryDiffModal 
                entry={previewResult}
                onClose={() => setPreviewResult(null)}
            />
        )}
      </div>
    </div>
  );
}

function HistoryAuditView({ history, selectedEntry, onSelectEntry }) {
    const [diffOnly, setDiffOnly] = useState(true);

    return (
        <div className="flex-1 flex overflow-hidden bg-surface-1">
            {/* List Side */}
            <div className="w-[380px] border-r border-surface-5/20 flex flex-col bg-surface-2">
                <div className="p-4 border-b border-surface-5/10 bg-surface-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-faint">Modification Timeline</h4>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                    {history.map((entry) => (
                        <div 
                            key={entry.id} 
                            onClick={() => onSelectEntry(entry)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer group ${
                                selectedEntry?.id === entry.id 
                                    ? 'bg-surface-0 border-amber-500/40 shadow-lg shadow-black/10' 
                                    : 'bg-surface-1 border-surface-5/5 hover:border-surface-5/30'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <span className={`text-[10px] font-mono ${selectedEntry?.id === entry.id ? 'text-amber-500' : 'text-ink-faint'}`}>
                                    {entry.timestamp}
                                </span>
                                {entry.reverted && <span className="text-[8px] font-black uppercase tracking-tighter bg-surface-4 text-ink-faint px-1.5 py-0.5 rounded">Reverted</span>}
                            </div>
                            <p className="text-[11px] font-medium text-ink-muted line-clamp-2 leading-relaxed">
                                {Object.keys(entry.changed_tags).length > 0 
                                    ? `Cleaned: ${Object.keys(entry.changed_tags).join(', ')}`
                                    : "Raw tag update / lyrics fetch"
                                }
                            </p>
                            <div className={`mt-2 h-0.5 w-0 group-hover:w-full bg-amber-500/30 transition-all duration-300 ${selectedEntry?.id === entry.id ? 'w-full' : ''}`} />
                        </div>
                    ))}
                </div>
            </div>

            {/* Content Side (The Diff) */}
            <div className="flex-1 flex flex-col overflow-hidden bg-surface-1">
                {selectedEntry ? (
                    <>
                        <div className="px-6 py-3 border-b border-surface-5/20 bg-surface-2 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <span className="text-xs font-bold text-ink-normal">Change Details</span>
                                <div className="h-4 w-px bg-surface-5/30" />
                                <span className="text-[10px] font-mono text-ink-faint uppercase">{selectedEntry.timestamp}</span>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <div className="relative">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only" 
                                        checked={diffOnly}
                                        onChange={(e) => setDiffOnly(e.target.checked)}
                                    />
                                    <div className={`w-8 h-4 rounded-full transition-colors ${diffOnly ? 'bg-amber-400' : 'bg-surface-5'}`} />
                                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${diffOnly ? 'translate-x-4' : ''}`} />
                                </div>
                                <span className="text-[10px] font-bold text-ink-muted uppercase tracking-tighter">Changes Only</span>
                            </label>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                           <HistoryDiffLayout entry={selectedEntry} diffOnly={diffOnly} />
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-ink-faint gap-4">
                        <svg className="w-12 h-12 opacity-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <p className="text-sm italic">Select a modification point to audit changes...</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function HistoryDiffLayout({ entry, diffOnly }) {
    const rawBefore = entry.raw_before || {};
    const rawAfter = entry.raw_after || {};
    const allKeys = Array.from(new Set([...Object.keys(rawBefore), ...Object.keys(rawAfter)])).sort();
    const displayedKeys = diffOnly 
        ? allKeys.filter(k => String(rawBefore[k]) !== String(rawAfter[k]))
        : allKeys;

    return (
        <div className="grid grid-cols-2 gap-8 h-full">
            <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    <h4 className="text-[10px] font-black uppercase text-ink-faint tracking-widest">Original</h4>
                </div>
                <div className="space-y-2">
                    {displayedKeys.map(k => (
                        <div key={k} className={`p-2.5 rounded-lg border text-[11px] font-mono leading-tight ${k in rawBefore && !(k in rawAfter) ? 'bg-red-400/5 border-red-500/20' : 'bg-surface-2 border-surface-5/10'}`}>
                            <div className="text-amber-500/80 mb-1 flex justify-between">
                                <span>{k}</span>
                                {k in rawBefore && !(k in rawAfter) && <span className="text-[8px] text-red-500 font-black">REMOVED</span>}
                            </div>
                            <div className="text-ink-muted break-all">
                                {k in rawBefore ? String(rawBefore[k]) : <span className="italic opacity-30">[Empty]</span>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    <h4 className="text-[10px] font-black uppercase text-ink-faint tracking-widest">Modified</h4>
                </div>
                <div className="space-y-2">
                    {displayedKeys.map(k => {
                        const isNew = !(k in rawBefore);
                        const isChanged = k in rawBefore && String(rawBefore[k]) !== String(rawAfter[k]);
                        const isRemoved = !(k in rawAfter);
                        return (
                            <div key={k} className={`p-2.5 rounded-lg border text-[11px] font-mono leading-tight ${
                                isRemoved ? 'bg-red-400/5 border-red-500/10 opacity-40' :
                                isNew ? 'bg-green-400/10 border-green-500/40' :
                                isChanged ? 'bg-green-400/5 border-green-500/20' : 'bg-surface-2 border-surface-5/10'
                            }`}>
                                <div className="flex items-center justify-between mb-1">
                                    <div className={`${(isChanged || isNew) ? 'text-green-500' : 'text-amber-500/80'}`}>{k}</div>
                                    {isRemoved ? <span className="text-[8px] font-black text-red-500">STRIPPED</span> : 
                                     isNew ? <span className="text-[8px] font-black text-green-500">ADDED</span> :
                                     isChanged ? <span className="text-[8px] font-black text-green-500">CLEANED</span> : null}
                                </div>
                                <div className={`${(isChanged || isNew) ? 'text-ink-normal' : 'text-ink-muted'} break-all`}>
                                    {isRemoved ? <span className="italic opacity-30">[Stripped]</span> : String(rawAfter[k])}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
