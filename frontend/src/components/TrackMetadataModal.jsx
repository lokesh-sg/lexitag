import React, { useState, useEffect, useRef } from 'react';
import { 
  fetchRawTags, updateTracks, fetchHistory, fetchTrack,
  searchAiCover, applyTrackCover, deleteTrackCover, getTrackCoverUrl, batchAiCover, batchRemoveCover,
  syncGroupCover
} from '../api';
import { useFixerContext } from '../contexts/AppContext';
import HistoryDiffModal from './HistoryDiffModal';
import ConfirmDialog from './ConfirmDialog';

export default function TrackMetadataModal({ tracks, onClose, onUpdated, initialAction = null }) {
  const fixer = useFixerContext();
  const hasTriggeredInitialAction = useRef(false);
  const [loading, setLoading] = useState(true);
  const [rawTags, setRawTags] = useState({});
  const [history, setHistory] = useState([]);
  const [isAuditing, setIsAuditing] = useState(false);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState(null);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    confirmVariant: 'danger',
    onConfirm: null
  });
  const [formData, setFormData] = useState({
    title: '', artist: '', album: '', genre: '', year: '', 
    composer: '', comment: '', lyrics: '', language: '',
    newPath: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showAddTag, setShowAddTag] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  
  // Local state for editing raw tags
  const [editingRawKey, setEditingRawKey] = useState(null);
  const [rawEditValue, setRawEditValue] = useState("");
  const [newTagKey, setNewTagKey] = useState("");
  const [newTagValue, setNewTagValue] = useState("");

  // Cover Art state
  const [coverTimestamp, setCoverTimestamp] = useState(Date.now());
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverError, setCoverError] = useState(null);
  const [coverSuccess, setCoverSuccess] = useState(false);
  const [aiCoverCandidate, setAiCoverCandidate] = useState(null);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentCustomAlbum, setAgentCustomAlbum] = useState("");
  const [agentCustomYear, setAgentCustomYear] = useState("");
  const [agentCustomArtist, setAgentCustomArtist] = useState("");
  const [agentSearching, setAgentSearching] = useState(false);
  const [showAgentRefine, setShowAgentRefine] = useState(false);
  const [agentError, setAgentError] = useState(null);
  const [candImageErrors, setCandImageErrors] = useState({});
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const fileInputRef = useRef(null);

  const isBulk = tracks.length > 1;
  const repTrack = tracks.find(t => t.has_cover) || tracks[0];
  const hasAnyCover = tracks.some(t => t.has_cover);

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
      if (initialAction === 'cover-ai' && !hasTriggeredInitialAction.current && tracks.length) {
        hasTriggeredInitialAction.current = true;
        const initialParams = isBulk ? null : {
          album: tracks[0]?.album || '',
          artist: tracks[0]?.artist || '',
          year: tracks[0]?.year || '',
        };
        handlePullAiCover(initialParams);
      }
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
      setError(err.response?.data?.detail || err.message || 'Failed to save tags');
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

  const handleLocalFix = async () => {
    const trackIds = tracks.map(t => t.id);
    setSaving(true);
    try {
      const { localFixTracks } = await import('../api');
      await localFixTracks(trackIds);
      await loadData();
      onUpdated && onUpdated();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      setError(err.message || 'Local fix failed');
    } finally {
      setSaving(false);
    }
  };

  const handleFixFilenames = () => {
    const trackIds = tracks.map(t => t.id);
    fixer.fix(trackIds, { filenames_only: true }, () => {
      loadData();
      onUpdated && onUpdated();
    });
  };

  const handlePullAiCover = async (customParams = null) => {
    // If called from an event handler, customParams is the SyntheticEvent — ignore it
    if (customParams && (customParams.nativeEvent || customParams.target || typeof customParams.preventDefault === 'function')) {
      customParams = null;
    }
    setCoverLoading(true);
    setCoverError(null);
    setCandImageErrors({});
    try {
      const rep = tracks.find(t => t.album) || tracks[0];
      const params = customParams || {
        album: formData.album || rep?.album || "",
        artist: formData.artist || rep?.artist || "",
        year: formData.year || rep?.year || "",
      };
      const res = await searchAiCover(rep.id, params);
      if (res && res.success && res.image_url) {
        setAiCoverCandidate(res);
        setSelectedCandidateIndex(0);
        setAgentCustomAlbum(formData.album || rep?.album || res.album || "");
        setAgentCustomYear(formData.year || rep?.year || res.year || "");
        // Do NOT overwrite user's authentic track artist with wrong candidate artist
        const authenticArtist = formData.composer || formData.artist || rep?.composer || rep?.artist || "";
        setAgentCustomArtist(authenticArtist);
        setAgentPrompt("");
        setAgentError(null);
        setShowCoverModal(true);
      } else {
        // Show the interactive modal even on failure so user can use the refinement instructions
        setAiCoverCandidate({ success: false, candidates: [], exact_match: false });
        setSelectedCandidateIndex(0);
        setAgentCustomAlbum(formData.album || rep?.album || "");
        setAgentCustomYear(formData.year || rep?.year || "");
        const authenticArtist = formData.composer || formData.artist || rep?.composer || rep?.artist || "";
        setAgentCustomArtist(authenticArtist);
        setAgentPrompt("");
        setAgentError(res?.error || 'No album art found by Google AI. Try refining the search below.');
        setShowCoverModal(true);
        setCoverError(null);
      }
    } catch (err) {
      setCoverError(err.response?.data?.detail || err.message || 'Failed to search AI cover');
      // Show the interactive modal even on hard failures so user can use the refinement instructions or Wikipedia URL
      setAiCoverCandidate({ success: false, candidates: [], exact_match: false });
      setSelectedCandidateIndex(0);
      setAgentCustomAlbum(formData.album || rep?.album || "");
      setAgentCustomYear(formData.year || rep?.year || "");
      const authenticArtist = formData.composer || formData.artist || rep?.composer || rep?.artist || "";
      setAgentCustomArtist(authenticArtist);
      setAgentPrompt("");
      setShowCoverModal(true);
    } finally {
      setCoverLoading(false);
    }
  };

  const handleAgentRefineSearch = async (e, customPromptOverride = null) => {
    if (e) e.preventDefault();
    if (!tracks.length) return;
    setAgentSearching(true);
    setAgentError(null);
    setCandImageErrors({});
    const promptToUse = customPromptOverride !== null ? customPromptOverride : agentPrompt;
    try {
      const rep = tracks.find(t => t.album) || tracks[0];
      const res = await searchAiCover(rep.id, {
        album: agentCustomAlbum || formData.album || rep?.album,
        artist: agentCustomArtist || formData.artist || rep?.artist,
        year: agentCustomYear || formData.year || rep?.year,
        prompt: promptToUse,
      });
      if (res && res.success && res.image_url) {
        setAiCoverCandidate(res);
        setSelectedCandidateIndex(0);
        setAgentError(null);
      } else {
        setAgentError(res?.error || 'No matching artwork found with these criteria.');
      }
    } catch (err) {
      setAgentError(err.response?.data?.detail || err.message || 'Agent search failed');
    } finally {
      setAgentSearching(false);
    }
  };

  const handleBroadSearch = async () => {
    const broadPrompt = "Search for related album, soundtrack or artist discography artwork without strict album name match";
    setAgentPrompt(broadPrompt);
    await handleAgentRefineSearch(null, broadPrompt);
  };

  const handleConfirmApplyCover = async (syncToAlbum = false) => {
    const candidates = aiCoverCandidate?.candidates || [];
    const activeCand = candidates[selectedCandidateIndex] || aiCoverCandidate;
    const selectedUrl = activeCand?.image_url;
    if (!selectedUrl) return;
    setCoverLoading(true);
    try {
      if (syncToAlbum && tracks[0]?.id) {
        // Sync cover to all tracks sharing this track's album / folder
        await syncGroupCover({
          sourceTrackId: tracks[0].id,
          imageUrl: selectedUrl,
        });
      } else if (isBulk) {
        for (const t of tracks) {
          await applyTrackCover(t.id, { imageUrl: selectedUrl });
        }
      } else {
        await applyTrackCover(tracks[0].id, { imageUrl: selectedUrl });
      }
      setCoverTimestamp(Date.now());
      setCoverFailed(false);
      setCoverLoaded(true);
      setShowCoverModal(false);
      setCoverSuccess(true);
      setTimeout(() => setCoverSuccess(false), 3000);
      onUpdated && onUpdated();
      if (onClose) onClose(); // Auto-close editor as requested by user
    } catch (err) {
      setCoverError(err.response?.data?.detail || err.message || 'Failed to apply cover');
    } finally {
      setCoverLoading(false);
    }
  };

  const handleUploadCoverFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setCoverLoading(true);
      setCoverError(null);
      try {
        const base64Data = reader.result;
        if (isBulk) {
          for (const t of tracks) {
            await applyTrackCover(t.id, { base64Data });
          }
        } else {
          await applyTrackCover(tracks[0].id, { base64Data });
        }
        setCoverTimestamp(Date.now());
        setCoverFailed(false);
        setCoverLoaded(true);
        setCoverSuccess(true);
        setTimeout(() => setCoverSuccess(false), 3000);
        onUpdated && onUpdated();
      } catch (err) {
        setCoverError(err.response?.data?.detail || err.message || 'Failed to upload cover');
      } finally {
        setCoverLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveCover = () => {
    const confirmMsg = isBulk 
      ? `Remove embedded album cover art from all ${tracks.length} selected audio files?`
      : 'Remove embedded album cover art from this audio file?';
    setConfirmModal({
      isOpen: true,
      title: 'Remove Embedded Cover Art',
      message: confirmMsg,
      confirmText: 'Remove Cover',
      confirmVariant: 'danger',
      onConfirm: async () => {
        setCoverLoading(true);
        try {
          if (isBulk) {
            await batchRemoveCover(tracks.map(t => t.id));
          } else {
            await deleteTrackCover(tracks[0].id);
          }
          setCoverTimestamp(Date.now());
          setCoverLoaded(false);
          setCoverFailed(true);
          tracks.forEach(t => { t.has_cover = false; });
          onUpdated && onUpdated();
        } catch (err) {
          setCoverError(err.response?.data?.detail || err.message || 'Failed to remove cover');
        } finally {
          setCoverLoading(false);
        }
      }
    });
  };

  if (!tracks.length) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className={`bg-surface-1 rounded-2xl border border-surface-5/50 w-full flex flex-col shadow-2xl overflow-hidden transition-all duration-300 ${isAuditing ? 'max-w-7xl' : 'max-w-6xl'} max-h-[94vh] sm:max-h-[90vh]`}>
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-surface-5/40 flex items-center justify-between bg-surface-1/90">
          <div className="min-w-0 flex-1 mr-3">
            <h2 className="text-base sm:text-lg font-bold text-ink-rich flex items-center gap-2 truncate">
              <svg className={`w-5 h-5 shrink-0 ${isAuditing ? 'text-blue-400' : 'text-amber-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                {isAuditing ? (
                    <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : (
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                )}
              </svg>
              <span className="truncate">
                {isAuditing 
                  ? `Audit History: ${tracks[0].filename}` 
                  : isBulk ? `Bulk Edit ${tracks.length} Tracks` : tracks[0].filename
                }
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
             {isAuditing && (
                <button 
                  onClick={() => {
                    setIsAuditing(false);
                    setSelectedHistoryEntry(null);
                  }}
                  className="text-xs font-bold text-ink-normal hover:text-ink-rich uppercase tracking-wider px-3 py-1.5 rounded-lg bg-surface-4 hover:bg-surface-5 transition-all"
                >
                  Back to Editor
                </button>
             )}
             <button onClick={onClose} className="p-1.5 hover:bg-surface-4 rounded-xl transition-colors text-ink-muted hover:text-ink-rich">
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
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col lg:flex-row gap-6 lg:gap-8 custom-scrollbar">
                {/* Main Fields Form */}
                <form id="metadata-form" onSubmit={handleSave} className="flex-1 space-y-4">
                  {/* Album Art Hero Card */}
                  <div className="bg-surface-2 rounded-xl p-3 sm:p-4 border border-surface-5/40 flex flex-col sm:flex-row items-center sm:items-start gap-4 transition-all">
                    {/* Square Cover Container */}
                    <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-xl overflow-hidden bg-surface-3 border border-surface-5/50 shrink-0 shadow-lg group">
                      {repTrack && (
                        <img
                          key={`${repTrack.id}-${coverTimestamp}`}
                          src={getTrackCoverUrl(repTrack.id, coverTimestamp)}
                          alt="Album Art"
                          className={`w-full h-full object-cover transition-all duration-300 ${coverFailed ? 'hidden' : 'block'}`}
                          onLoad={() => { setCoverLoaded(true); setCoverFailed(false); }}
                          onError={() => { setCoverLoaded(false); setCoverFailed(true); }}
                        />
                      )}
                      
                      {/* Placeholder when missing or failed */}
                      {(coverFailed || (!hasAnyCover && isBulk) || (!coverLoaded && !isBulk)) && !coverLoading && (
                        <div className="w-full h-full flex flex-col items-center justify-center text-ink-muted/60 p-2 text-center bg-surface-3/80">
                          <svg className="w-8 h-8 sm:w-10 sm:h-10 mb-1 text-ink-muted/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                          </svg>
                          <span className="text-[10px] font-semibold text-ink-muted">
                            {isBulk ? `${tracks.length} Tracks` : 'No Album Art'}
                          </span>
                        </div>
                      )}

                      {/* Bulk badge overlay on image */}
                      {isBulk && coverLoaded && !coverFailed && (
                        <div className="absolute bottom-1 right-1 bg-black/75 backdrop-blur-xs text-[9px] font-bold text-amber-300 px-1.5 py-0.5 rounded shadow-xs border border-amber-500/20 pointer-events-none">
                          {tracks.length} Tracks
                        </div>
                      )}

                      {/* Loading Overlay */}
                      {coverLoading && (
                        <div className="absolute inset-0 bg-black/70 backdrop-blur-xs flex flex-col items-center justify-center text-amber-400 gap-1.5 z-10 animate-fade-in">
                          <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M21 12a9 9 0 11-6.219-8.56"/>
                          </svg>
                          <span className="text-[10px] font-bold tracking-tight text-ink-rich">Google AI...</span>
                        </div>
                      )}
                    </div>

                    {/* Cover Controls & Metadata */}
                    <div className="flex-1 min-w-0 space-y-2 w-full text-center sm:text-left">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <div>
                          <h4 className="text-xs font-bold text-ink-rich uppercase tracking-wider">Album Artwork</h4>
                          <p className="text-[11px] text-ink-muted truncate">
                            {isBulk 
                              ? `Batch apply artwork across ${tracks.length} tracks` 
                              : (coverLoaded && !coverFailed ? 'Embedded in physical audio file' : 'No embedded artwork detected')
                            }
                          </p>
                        </div>

                        {coverSuccess && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 animate-fade-in self-center sm:self-auto">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                            Artwork Saved!
                          </span>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handlePullAiCover()}
                          disabled={coverLoading}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-surface-0 shadow-sm transition-all active:scale-95 disabled:opacity-50"
                          title="Search and pull official album artwork from internet using Google AI"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                          </svg>
                          <span>{isBulk ? 'Pull AI Covers (Batch)' : 'Pull AI Cover'}</span>
                        </button>

                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleUploadCoverFile}
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={coverLoading}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-surface-3 hover:bg-surface-4 text-ink-rich border border-surface-5/50 transition-all active:scale-95 disabled:opacity-50"
                          title="Upload an image from your computer"
                        >
                          <svg className="w-3.5 h-3.5 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          <span>Upload Image</span>
                        </button>

                        {(isBulk || (coverLoaded && !coverFailed)) && (
                          <button
                            type="button"
                            onClick={handleRemoveCover}
                            disabled={coverLoading}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                            title={isBulk ? `Remove embedded artwork from all ${tracks.length} tracks` : "Remove embedded artwork from audio file"}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                            <span>{isBulk ? `Remove All Covers (${tracks.length})` : 'Remove'}</span>
                          </button>
                        )}
                      </div>

                      {coverError && (
                        <p className="text-[11px] text-red-400 bg-red-500/10 px-2.5 py-1 rounded border border-red-500/20">
                          {coverError}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: 'Title', name: 'title' },
                      { label: 'Artist', name: 'artist' },
                      { label: 'Album', name: 'album' },
                      { label: 'Genre', name: 'genre' },
                      { label: 'Year', name: 'year' },
                      { label: 'Composer', name: 'composer' },
                      { label: 'Language', name: 'language' }
                    ].map(field => (
                      <div key={field.name} className="space-y-1.5">
                        <label className="text-xs font-bold text-ink-normal uppercase tracking-wider">{field.label}</label>
                        <input
                          name={field.name}
                          value={formData[field.name]}
                          onChange={handleChange}
                          className="w-full bg-surface-2 border border-surface-5/50 rounded-lg px-3 py-2 text-sm text-ink-rich font-medium focus:ring-1 focus:ring-amber-400 focus:border-amber-400/50 outline-none transition-all placeholder:italic"
                          placeholder={isBulk ? "(Multiple values)" : ""}
                        />
                      </div>
                    ))}
                  </div>

                  {!isBulk && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-ink-normal uppercase tracking-wider">File Path (Migration)</label>
                      <div className="relative group">
                          <input
                              name="newPath"
                              value={formData.newPath}
                              onChange={handleChange}
                              className="w-full bg-surface-2 border border-surface-5/50 rounded-lg px-3 py-2 text-xs text-ink-rich font-mono focus:ring-1 focus:ring-amber-400 outline-none"
                          />
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-[9px] uppercase font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">Physical Move</span>
                          </div>
                      </div>
                      <p className="text-[10px] text-ink-muted italic px-1">Changing this will physically move the file on your disk and update the library.</p>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-ink-normal uppercase tracking-wider">Lyrics</label>
                    <textarea
                      name="lyrics"
                      value={formData.lyrics}
                      onChange={handleChange}
                      rows={isBulk ? 2 : 6}
                      className="w-full bg-surface-2 border border-surface-5/50 rounded-lg px-3 py-2 text-sm text-ink-rich focus:ring-1 focus:ring-amber-400 outline-none font-mono text-xs leading-relaxed"
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
                                                  src={getTrackCoverUrl(tracks[0].id, coverTimestamp)} 
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

        {/* Artwork Research Agent Modal */}
        {showCoverModal && aiCoverCandidate && (() => {
          const candidates = aiCoverCandidate.candidates?.length ? aiCoverCandidate.candidates : [aiCoverCandidate];
          const activeCand = candidates[selectedCandidateIndex] || candidates[0] || aiCoverCandidate;
          return (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
              <div className="bg-surface-1 rounded-2xl border border-surface-5/50 max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scale-in">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-surface-5/30 px-5 py-3.5 bg-surface-2/60">
                  <div className="flex items-center gap-2.5">
                    <span className="p-1.5 rounded-lg bg-amber-400/10 text-amber-400">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                      </svg>
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-ink-rich">Artwork Research Agent</h3>
                        {aiCoverCandidate.exact_match ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Exact Match
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Candidate Matches ({candidates.length})
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-muted">Select your preferred artwork below. Final confirmation is required before embedding.</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowCoverModal(false)}
                    className="p-1.5 rounded-lg text-ink-muted hover:text-ink-rich hover:bg-surface-3 transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
                  {/* Status Banner */}
                  {agentError && (
                    <div className="px-3.5 py-2.5 rounded-xl bg-red-900/20 border border-red-900/50 text-sm font-semibold text-red-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <span className="text-xs">{agentError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleBroadSearch}
                        disabled={agentSearching}
                        className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-surface-0 border border-amber-400/40 shadow-sm transition-all flex items-center gap-1.5 shrink-0 self-end sm:self-auto"
                      >
                        {agentSearching ? (
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25"/><path d="M4 12a8 8 0 018-8" strokeWidth="4" className="opacity-75"/></svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M8 11h6"/><path d="M11 8v6"/></svg>
                        )}
                        <span>Try Broad Search</span>
                      </button>
                    </div>
                  )}
                  {!agentError && aiCoverCandidate.exact_match && (
                    <div className="px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        <span>Exact album match found! You can preview and apply, or run a broad search for alternatives.</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleBroadSearch}
                        disabled={agentSearching}
                        className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 shrink-0 self-end sm:self-auto transition-colors"
                        title="Search discography and related artwork"
                      >
                        <span>Want more choices? Broad Search</span>
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    </div>
                  )}
                  {!agentError && !aiCoverCandidate.exact_match && (
                    <div className="px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <span>No 100% exact match found for "{formData.album || formData.title}". Review candidates or run broad search.</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleBroadSearch}
                        disabled={agentSearching}
                        className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-surface-0 border border-amber-400/40 shadow-sm transition-all flex items-center gap-1.5 shrink-0 self-end sm:self-auto"
                      >
                        {agentSearching ? (
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25"/><path d="M4 12a8 8 0 018-8" strokeWidth="4" className="opacity-75"/></svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M8 11h6"/><path d="M11 8v6"/></svg>
                        )}
                        <span>Broad Search</span>
                      </button>
                    </div>
                  )}

                  {/* Main Preview & Details Section */}
                  {!agentError && activeCand?.image_url && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start bg-surface-2/40 p-4 rounded-xl border border-surface-5/20">
                      <div className="sm:col-span-5 flex flex-col items-center justify-center">
                        <div className="relative aspect-square w-full max-w-[200px] rounded-xl overflow-hidden bg-surface-3 border border-surface-5/40 shadow-lg flex items-center justify-center">
                          {candImageErrors[activeCand.image_url] ? (
                            <div className="w-full h-full p-4 flex flex-col items-center justify-center text-center bg-surface-2/90">
                              <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-2">
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                  <circle cx="8.5" cy="8.5" r="1.5"/>
                                  <path d="M21 15l-5-5L5 21"/>
                                </svg>
                              </div>
                              <span className="text-xs font-semibold text-ink-rich">Direct Preview Unavailable</span>
                              <span className="text-[10px] text-ink-muted mt-1 leading-tight">
                                Source blocks browser linking. Artwork will be downloaded by server when applied.
                              </span>
                            </div>
                          ) : (
                            <img 
                              key={activeCand.image_url}
                              src={activeCand.image_url} 
                              alt="Cover Preview" 
                              className="w-full h-full object-contain"
                              onError={() => {
                                setCandImageErrors(prev => ({ ...prev, [activeCand.image_url]: true }));
                              }}
                            />
                          )}
                        </div>
                      </div>

                      <div className="sm:col-span-7 flex flex-col justify-between space-y-2.5">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-surface-4 text-ink-rich border border-surface-5/30">
                              {activeCand.source || 'Music Repository'}
                            </span>
                            {activeCand.is_exact && (
                              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                Exact Title
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-bold text-ink-rich leading-snug">
                            {activeCand.album || formData.album || 'Unknown Album'}
                          </h4>
                          <p className="text-xs text-ink-muted">
                            {activeCand.artist || formData.artist || 'Unknown Artist'}
                            {activeCand.year ? ` • ${activeCand.year}` : ''}
                          </p>
                          {activeCand.description && (
                            <p className="text-[11px] text-ink-faint mt-1.5 italic">
                              {activeCand.description}
                            </p>
                          )}
                        </div>

                        <div className="bg-surface-3/60 rounded-lg p-2.5 text-[11px] space-y-1 text-ink-muted border border-surface-5/20">
                          <div className="flex justify-between">
                            <span className="text-ink-faint">Target Track:</span>
                            <span className="text-ink-rich font-medium truncate ml-2">{formData.title || tracks[0]?.filename}</span>
                          </div>
                          {formData.composer && (
                            <div className="flex justify-between">
                              <span className="text-ink-faint">Composer:</span>
                              <span className="text-ink-rich font-medium truncate ml-2">{formData.composer}</span>
                            </div>
                          )}
                          {formData.language && (
                            <div className="flex justify-between">
                              <span className="text-ink-faint">Language:</span>
                              <span className="text-ink-rich font-medium truncate ml-2">{formData.language}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Candidate Selector Strip */}
                  {candidates.length > 1 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-ink-rich flex items-center gap-1.5">
                          <span>Candidate Options ({candidates.length})</span>
                          <span className="text-[10px] font-normal text-ink-muted">(Click to select)</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {candidates.map((cand, idx) => {
                          const isSelected = selectedCandidateIndex === idx;
                          return (
                            <div 
                              key={cand.id || idx}
                              onClick={() => setSelectedCandidateIndex(idx)}
                              className={`p-2 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 relative ${
                                isSelected 
                                  ? 'bg-amber-400/10 border-amber-400 ring-2 ring-amber-400/40 shadow-md' 
                                  : 'bg-surface-2/60 border-surface-5/20 hover:border-surface-5/50 hover:bg-surface-2'
                              }`}
                            >
                              <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-surface-3 flex items-center justify-center">
                                {candImageErrors[cand.image_url] ? (
                                  <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center bg-surface-2 text-ink-faint">
                                    <svg className="w-5 h-5 mb-1 opacity-60 text-amber-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                      <circle cx="8.5" cy="8.5" r="1.5"/>
                                      <path d="M21 15l-5-5L5 21"/>
                                    </svg>
                                    <span className="text-[9px] text-ink-muted">No Preview</span>
                                  </div>
                                ) : (
                                  <img 
                                    src={cand.image_url} 
                                    alt={`Option ${idx + 1}`} 
                                    className="w-full h-full object-contain"
                                    onError={() => {
                                      setCandImageErrors(prev => ({ ...prev, [cand.image_url]: true }));
                                    }}
                                  />
                                )}
                                {isSelected && (
                                  <div className="absolute top-1 right-1 p-0.5 rounded-full bg-amber-400 text-surface-0 shadow">
                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 text-left">
                                <span className="text-[9px] font-bold block truncate text-amber-400 uppercase tracking-tight">
                                  {cand.source?.replace(/\(.*\)/, '') || 'Candidate'}
                                </span>
                                <p className="text-[11px] font-semibold text-ink-rich truncate">
                                  {cand.album}
                                </p>
                                <p className="text-[10px] text-ink-muted truncate">
                                  {cand.year ? `${cand.year} • ` : ''}{cand.artist}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Agent Refinement Box ("Tell the agent to look for different one") */}
                  <div className="border border-surface-5/20 rounded-xl overflow-hidden bg-surface-2/30">
                    <button
                      type="button"
                      onClick={() => setShowAgentRefine(!showAgentRefine)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-ink-muted hover:text-ink-rich hover:bg-surface-3/40 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <span>Not satisfied? Tell agent to search for a different release / metadata</span>
                      </div>
                      <span className="text-[10px] text-amber-400 font-bold uppercase">{showAgentRefine ? 'Hide' : 'Refine'}</span>
                    </button>

                    {showAgentRefine && (
                      <form onSubmit={handleAgentRefineSearch} className="p-3.5 border-t border-surface-5/20 space-y-3 bg-surface-1/40">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div>
                            <label className="text-[10px] font-bold text-ink-faint uppercase">Album Name</label>
                            <input 
                              type="text" 
                              value={agentCustomAlbum} 
                              onChange={(e) => setAgentCustomAlbum(e.target.value)}
                              placeholder="Album title"
                              className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-surface-5/30 text-xs text-ink-rich focus:border-amber-400 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-ink-faint uppercase">Release Year</label>
                            <input 
                              type="text" 
                              value={agentCustomYear} 
                              onChange={(e) => setAgentCustomYear(e.target.value)}
                              placeholder="Release year (YYYY)"
                              className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-surface-5/30 text-xs text-ink-rich focus:border-amber-400 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-ink-faint uppercase">Artist / Composer</label>
                            <input 
                              type="text" 
                              value={agentCustomArtist} 
                              onChange={(e) => setAgentCustomArtist(e.target.value)}
                              placeholder="Artist or composer"
                              className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-surface-5/30 text-xs text-ink-rich focus:border-amber-400 focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold text-ink-faint uppercase">Custom Agent Instructions</label>
                            <button
                              type="button"
                              onClick={handleBroadSearch}
                              disabled={agentSearching}
                              className="text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
                              title="Search related artwork and discography without typing custom query"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M8 11h6"/><path d="M11 8v6"/></svg>
                              <span>Do Broad Search</span>
                            </button>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 mt-1">
                            <textarea 
                              rows={2}
                              value={agentPrompt} 
                              onChange={(e) => setAgentPrompt(e.target.value)}
                              placeholder="Enter custom search instructions or click 'Broad Search'..."
                              className="flex-1 px-3 py-1.5 rounded-lg bg-surface-2 border border-surface-5/30 text-xs text-ink-rich focus:border-amber-400 focus:outline-none resize-none custom-scrollbar"
                            />
                            <div className="flex sm:flex-col gap-1.5 shrink-0 self-end sm:self-stretch">
                              <button
                                type="button"
                                onClick={handleBroadSearch}
                                disabled={agentSearching}
                                className="flex-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-surface-3 hover:bg-surface-4 text-amber-400 border border-amber-400/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                                title="Search related artwork without strict album match"
                              >
                                <span>Broad Search</span>
                              </button>
                              <button
                                type="submit"
                                disabled={agentSearching}
                                className="flex-1 px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-surface-0 border border-amber-400/40 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                              >
                                {agentSearching ? (
                                  <>
                                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25"/><path d="M4 12a8 8 0 018-8" strokeWidth="4" className="opacity-75"/></svg>
                                    <span>Searching...</span>
                                  </>
                                ) : (
                                  <span>Agent Search</span>
                                )}
                              </button>
                            </div>
                          </div>
                          {agentError && (
                            <div className="mt-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                              <svg className="w-4 h-4 shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                              <span>{agentError}</span>
                            </div>
                          )}
                        </div>
                      </form>
                    )}
                  </div>
                </div>

                {/* Footer / Final Confirmation */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-surface-5/30 px-5 py-3.5 bg-surface-2/60">
                  <span className="text-[11px] text-ink-muted">
                    Selected artwork will be embedded into audio tags & folder.
                  </span>
                  <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setShowCoverModal(false)}
                      className="px-3.5 py-2 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink-rich hover:bg-surface-3 transition-colors"
                    >
                      Cancel
                    </button>
                    {isBulk ? (
                      <button
                        type="button"
                        onClick={() => handleConfirmApplyCover(false)}
                        disabled={coverLoading || agentSearching}
                        className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-surface-0 shadow-lg shadow-amber-400/20 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        <span>{coverLoading ? 'Embedding...' : `Apply to All ${tracks.length} Selected`}</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleConfirmApplyCover(false)}
                          disabled={coverLoading || agentSearching}
                          className="px-3.5 py-2 rounded-lg text-xs font-bold bg-surface-3 hover:bg-surface-4 text-ink-rich border border-surface-5/50 transition-all active:scale-95 disabled:opacity-50"
                        >
                          {coverLoading ? 'Embedding...' : 'Apply to Track'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmApplyCover(true)}
                          disabled={coverLoading || agentSearching}
                          className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                          title="Apply artwork to this track and immediately sync it to all other tracks in this album"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="23 4 23 10 17 10"/>
                            <polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                          </svg>
                          <span>{coverLoading ? 'Syncing...' : 'Apply & Sync to Entire Album'}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* In-app Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        confirmVariant={confirmModal.confirmVariant}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />
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
