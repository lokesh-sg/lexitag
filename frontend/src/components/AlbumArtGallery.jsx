import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchTracks, fetchTrackGroups, getTrackCoverUrl, searchAiCover, applyTrackCover, batchAiCover, syncFolderCoverArt, syncGroupCover, fetchActiveScanJobs, batchRemoveCover } from '../api';
import TrackMetadataModal from './TrackMetadataModal';
import ConfirmDialog from './ConfirmDialog';

// Subcomponent for each track's square cover art with reactive cache-busting & fallback
function TrackCoverSquare({ track, timestamp, onCoverLoaded, onCoverError }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [timestamp, track?.id]);

  if (!track || !track.id) {
    return (
      <div className="relative aspect-square w-full bg-surface-3 overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-muted/50 p-2 text-center bg-surface-3 pointer-events-none">
          <svg className="w-8 h-8 mb-1 text-ink-muted/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span className="text-[9px] font-medium tracking-tight uppercase">Audio</span>
        </div>
      </div>
    );
  }

  // Fast-path: if track explicitly has no embedded cover, show placeholder immediately
  const hasNoCover = track.has_cover === false || track.has_cover === 0;
  const coverUrl = getTrackCoverUrl(track.id, timestamp);

  return (
    <div className="relative aspect-square w-full bg-surface-3 overflow-hidden flex items-center justify-center">
      {!hasNoCover && !failed && (
        <img
          key={`${track.id}-${timestamp}`}
          src={coverUrl}
          alt={track.title || track.filename}
          loading="lazy"
          className={`w-full h-full object-cover transition-opacity duration-200 group-hover:scale-105 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => {
            setLoaded(true);
            setFailed(false);
            if (onCoverLoaded) onCoverLoaded(track.id);
          }}
          onError={() => {
            setFailed(true);
            setLoaded(false);
            if (onCoverError) onCoverError(track.id);
          }}
        />
      )}

      {/* Fallback Vinyl Placeholder if missing or loading */}
      {(hasNoCover || !loaded || failed) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-muted/50 p-2 text-center bg-surface-3 pointer-events-none">
          <svg className="w-8 h-8 mb-1 text-ink-muted/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span className="text-[9px] font-medium tracking-tight uppercase">{track.format || 'Audio'}</span>
          {hasNoCover && (
            <span className="text-[8px] text-ink-muted/40 font-mono mt-0.5">No Embedded Art</span>
          )}
        </div>
      )}
    </div>
  );
}

function extractErrorMsg(err, fallback = 'Operation failed') {
  if (!err) return fallback;
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(d => (typeof d === 'string' ? d : d.msg || JSON.stringify(d))).join(', ');
  }
  if (detail && typeof detail === 'object') {
    return detail.msg || JSON.stringify(detail);
  }
  return err.message || fallback;
}

export default function AlbumArtGallery() {
  const [tracks, setTracks] = useState([]);
  const [total, setTotal] = useState(0);
  const [serverGroups, setServerGroups] = useState([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalTracksCount, setTotalTracksCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(48);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState('all'); // 'all', 'missing_cover', 'has_cover'
  const [groupBy, setGroupBy] = useState('none'); // 'none', 'album', 'artist', 'folder'
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  
  // Track being edited in modal (array of tracks)
  const [editingTracks, setEditingTracks] = useState(null);
  const [editorInitialAction, setEditorInitialAction] = useState(null);
  
  // Cache-busting timestamps for covers (trackId -> timestamp)
  const [coverTimestamps, setCoverTimestamps] = useState({});
  const [globalTimestamp, setGlobalTimestamp] = useState(Date.now());

  // Live verified covers map (trackId -> boolean)
  const [verifiedCovers, setVerifiedCovers] = useState({});
  
  // Single-track AI pull in progress (trackId -> boolean)
  const [aiLoadingIds, setAiLoadingIds] = useState({});

  // Batch AI pull state
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null); // { total, current, updated, failed, running, error }
  const [feedbackMsg, setFeedbackMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    confirmVariant: 'danger',
    onConfirm: null
  });
  const [syncingFolderArt, setSyncingFolderArt] = useState(false);
  const [coverSyncProgress, setCoverSyncProgress] = useState(null); // { current, total, found, filename, status, done }
  const [syncingGroupId, setSyncingGroupId] = useState(null);

  // Recently fixed items kept visible in session so user can review the artwork before they vanish
  const [recentlyFixedGroupKeys, setRecentlyFixedGroupKeys] = useState(new Set());
  const [recentlyFixedTrackIds, setRecentlyFixedTrackIds] = useState(new Set());

  // Interactive track hover preview within grouped view (groupKey, track)
  const [hoveredTrack, setHoveredTrack] = useState(null);

  // Clear session review items whenever user explicitly changes view, filter, or page
  useEffect(() => {
    setRecentlyFixedGroupKeys(new Set());
    setRecentlyFixedTrackIds(new Set());
    setHoveredTrack(null);
  }, [groupBy, filter, page, debouncedSearch]);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Load gallery data (tracks or groups depending on groupBy)
  const loadTracks = useCallback(async () => {
    setLoading(true);
    try {
      if (groupBy === 'none') {
        const data = await fetchTracks({
          page,
          pageSize,
          search: debouncedSearch,
          filter: filter === 'all' ? '' : filter,
          sortBy: 'title',
          sortDir: 'asc',
        });
        setTracks(data.tracks || []);
        setTotal(data.total || 0);
        setServerGroups([]);
      } else {
        const data = await fetchTrackGroups({
          groupBy,
          page,
          pageSize,
          search: debouncedSearch,
          filter: filter === 'all' ? '' : filter,
        });
        setServerGroups(data.groups || []);
        setTotalGroups(data.total_groups || 0);
        setTotalTracksCount(data.total_tracks || 0);
        // Flatten tracks so actions like multi-selection & editor work seamlessly
        const allTracks = (data.groups || []).flatMap(g => g.tracks || []);
        setTracks(allTracks);
      }
    } catch (err) {
      console.error('Failed to load gallery data:', err);
    } finally {
      setLoading(false);
    }
  }, [groupBy, page, pageSize, debouncedSearch, filter]);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  // Client-side accuracy filter ensuring verified covers are never treated as missing
  const visibleTracks = useMemo(() => {
    if (filter === 'missing_cover') {
      return tracks.filter(t => {
        // Keep recently fixed tracks visible on screen during this review session
        if (recentlyFixedTrackIds.has(t.id)) return true;
        const hasArt = verifiedCovers[t.id] !== undefined 
          ? verifiedCovers[t.id] 
          : Boolean(t.has_cover);
        return !hasArt;
      });
    }
    if (filter === 'has_cover') {
      return tracks.filter(t => {
        const hasArt = verifiedCovers[t.id] !== undefined 
          ? verifiedCovers[t.id] 
          : Boolean(t.has_cover);
        return hasArt;
      });
    }
    return tracks;
  }, [tracks, filter, verifiedCovers, recentlyFixedTrackIds]);

  const filteredGroups = useMemo(() => {
    if (groupBy === 'none') return null;
    return serverGroups;
  }, [groupBy, serverGroups]);

  // Selected groups (albums/folders) based on current selection
  const selectedGroups = useMemo(() => {
    if (groupBy === 'none' || !serverGroups?.length) return [];
    return serverGroups.filter(g => g.tracks?.some(t => selectedIds.has(t.id)));
  }, [groupBy, serverGroups, selectedIds]);

  // Toggle group accordion drawer
  const toggleExpandGroup = (key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Select / Deselect all tracks belonging to a group
  const toggleSelectGroup = (group, e) => {
    if (e) e.stopPropagation();
    const allSelected = group.tracks.every(t => selectedIds.has(t.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      group.tracks.forEach(t => {
        if (allSelected) next.delete(t.id);
        else next.add(t.id);
      });
      return next;
    });
  };

  // Open AI Artwork Research Agent with candidate preview & selection for entire group
  const handleGroupAiPull = (group, e) => {
    if (e) e.stopPropagation();
    if (!group?.tracks?.length) return;
    setEditorInitialAction('cover-ai');
    setEditingTracks(group.tracks);
  };

  const handleOpenGroupInEditor = (group, e) => {
    if (e) e.stopPropagation();
    setEditingTracks(group.tracks);
  };

  // Synchronize cover art from a track with cover art to all tracks in the group
  const handleSyncGroupArt = async (group, sourceTrack = null, e) => {
    if (e) e.stopPropagation();
    // Prioritize explicitly specified sourceTrack, then the visible album representative track, then first track with cover
    const source = sourceTrack || group.representative_track || group.representativeTrack || group.tracks?.find(t => t.has_cover) || (group.tracks && group.tracks[0]);
    const sourceId = source?.id;
    const targetIds = group.tracks?.map(t => t.id) || [];
    if (!targetIds.length) return;

    setSyncingGroupId(group.key);
    try {
      const res = await syncGroupCover({
        sourceTrackId: sourceId,
        targetTrackIds: targetIds,
        groupKey: group.key,
      });

      const now = Date.now();
      setCoverTimestamps(prev => {
        const next = { ...prev };
        targetIds.forEach(id => { next[id] = now; });
        return next;
      });
      setVerifiedCovers(prev => {
        const next = { ...prev };
        targetIds.forEach(id => { next[id] = true; });
        return next;
      });

      // Optimistically update group in local state — including representative_track so
      // TrackCoverSquare doesn't short-circuit to placeholder via hasNoCover check.
      setServerGroups(prev => prev.map(g => {
        if (g.key === group.key) {
          const updatedRep = source
            ? { ...(source), has_cover: true }
            : g.representative_track
            ? { ...g.representative_track, has_cover: true }
            : g.representative_track;
          return {
            ...g,
            has_cover_count: g.track_count,
            missing_cover_count: 0,
            representative_track: updatedRep,
            tracks: g.tracks?.map(t => ({ ...t, has_cover: true })),
          };
        }
        return g;
      }));

      // Keep on screen for verification
      setRecentlyFixedGroupKeys(prev => new Set(prev).add(group.key));
      setRecentlyFixedTrackIds(prev => {
        const next = new Set(prev);
        targetIds.forEach(id => next.add(id));
        return next;
      });

      setFeedbackMsg({
        type: 'success',
        text: `Successfully synced cover art to ${res.updated || targetIds.length} tracks in "${group.title}"!`
      });
      setTimeout(() => setFeedbackMsg(null), 4000);
      // Retain on screen for verification without loadTracks() flyaway
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: extractErrorMsg(err, 'Failed to sync cover art to group')
      });
      setTimeout(() => setFeedbackMsg(null), 4000);
    } finally {
      setSyncingGroupId(null);
    }
  };

  // Synchronize artwork across all selected albums/groups or tracks in batch
  const handleBatchSyncArt = async () => {
    if (selectedIds.size === 0) return;

    // 1. In Grouped View (by album, artist, or folder)
    if (groupBy !== 'none' && selectedGroups.length > 0) {
      setSyncingFolderArt(true);
      let updatedAlbums = 0;
      let totalUpdatedTracks = 0;
      const now = Date.now();
      const newTimestamps = {};
      const newVerified = {};
      const newlyFixedGroupKeys = new Set();
      const newlyFixedTrackIds = new Set();

      for (const group of selectedGroups) {
        const source = group.representative_track || group.representativeTrack || group.tracks?.find(t => t.has_cover) || (group.tracks && group.tracks[0]);
        const targetIds = group.tracks?.map(t => t.id) || [];
        if (!targetIds.length) continue;

        try {
          const res = await syncGroupCover({
            sourceTrackId: source?.id,
            targetTrackIds: targetIds,
            groupKey: group.key,
          });
          if (res?.updated > 0) {
            updatedAlbums += 1;
            totalUpdatedTracks += res.updated;
            targetIds.forEach(id => {
              newTimestamps[id] = now;
              newVerified[id] = true;
              newlyFixedTrackIds.add(id);
            });
            newlyFixedGroupKeys.add(group.key);
          }
        } catch (err) {
          console.error(`Failed to sync art for group ${group.title}:`, err);
        }
      }

      setCoverTimestamps(prev => ({ ...prev, ...newTimestamps }));
      setVerifiedCovers(prev => ({ ...prev, ...newVerified }));
      setRecentlyFixedGroupKeys(prev => {
        const next = new Set(prev);
        newlyFixedGroupKeys.forEach(k => next.add(k));
        return next;
      });
      setRecentlyFixedTrackIds(prev => {
        const next = new Set(prev);
        newlyFixedTrackIds.forEach(id => next.add(id));
        return next;
      });

      // Optimistically update server groups — also update representative_track.has_cover
      setServerGroups(prev => prev.map(g => {
        if (newlyFixedGroupKeys.has(g.key)) {
          const updatedRep = g.representative_track
            ? { ...g.representative_track, has_cover: true }
            : g.representative_track;
          return {
            ...g,
            has_cover_count: g.track_count,
            missing_cover_count: 0,
            representative_track: updatedRep,
            tracks: g.tracks?.map(t => ({ ...t, has_cover: true })),
          };
        }
        return g;
      }));

      setSyncingFolderArt(false);
      setFeedbackMsg({
        type: 'success',
        text: `Successfully synced artwork across ${updatedAlbums} of ${selectedGroups.length} albums (${totalUpdatedTracks} tracks updated)!`
      });
      setTimeout(() => setFeedbackMsg(null), 5000);
      return;
    }

    // 2. In Flat Track View (groupBy === 'none')
    const selectedTracksList = tracks.filter(t => selectedIds.has(t.id));
    const clusters = {};
    selectedTracksList.forEach(t => {
      const clusterKey = (t.album || '').trim().toLowerCase() || (t.path ? t.path.substring(0, t.path.lastIndexOf('/')) : 'unknown');
      if (!clusters[clusterKey]) clusters[clusterKey] = [];
      clusters[clusterKey].push(t);
    });

    setSyncingFolderArt(true);
    let updatedClusters = 0;
    let totalUpdated = 0;
    const now = Date.now();
    const newTimestamps = {};
    const newVerified = {};

    for (const [key, clusterTracks] of Object.entries(clusters)) {
      const source = clusterTracks.find(t => t.has_cover);
      const targetIds = clusterTracks.map(t => t.id);
      try {
        const res = await syncGroupCover({
          sourceTrackId: source?.id,
          targetTrackIds: targetIds,
        });
        if (res?.updated > 0) {
          updatedClusters += 1;
          totalUpdated += res.updated;
          targetIds.forEach(id => {
            newTimestamps[id] = now;
            newVerified[id] = true;
          });
        }
      } catch (err) {
        console.error(`Failed to sync art for cluster ${key}:`, err);
      }
    }

    setCoverTimestamps(prev => ({ ...prev, ...newTimestamps }));
    setVerifiedCovers(prev => ({ ...prev, ...newVerified }));
    setSyncingFolderArt(false);
    setFeedbackMsg({
      type: 'success',
      text: `Successfully synced artwork across ${updatedClusters} album clusters (${totalUpdated} tracks updated)!`
    });
    setTimeout(() => setFeedbackMsg(null), 5000);
  };

  // Selection helpers
  const toggleSelect = (id, e) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllCurrent = () => {
    setSelectedIds(new Set(tracks.map(t => t.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Single-track Artwork Research Agent Launch
  const handleSingleAiPull = (track, e) => {
    if (e) e.stopPropagation();
    setEditorInitialAction('cover-ai');
    setEditingTracks([track]);
  };

  // Batch Google AI Cover Pull for all selected tracks
  const handleBatchAiPull = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;

    setBatchProgress({ total: ids.length, current: 0, updated: 0, failed: 0, running: true });
    setBatchModalOpen(true);

    try {
      const res = await batchAiCover(ids);
      const firstErr = res.details?.find(d => !d.success)?.error;
      const errorMsg = typeof firstErr === 'string' ? firstErr : (firstErr ? JSON.stringify(firstErr) : 'No artwork found');
      setBatchProgress({
        total: ids.length,
        current: ids.length,
        updated: res.updated || 0,
        failed: res.failed || 0,
        error: res.failed > 0 && res.updated === 0 ? errorMsg : null,
        running: false,
      });

      const successfulIds = res.details?.filter(d => d.success).map(d => d.track_id) || [];
      if (successfulIds.length > 0) {
        setRecentlyFixedTrackIds(prev => {
          const next = new Set(prev);
          successfulIds.forEach(id => next.add(id));
          return next;
        });
      }

      setGlobalTimestamp(Date.now());
      loadTracks();
    } catch (err) {
      setBatchProgress({
        total: ids.length,
        current: ids.length,
        updated: 0,
        failed: ids.length,
        error: extractErrorMsg(err, 'Batch cover retrieval failed'),
        running: false,
      });
    }
  };

  // Subscribe to live SSE artwork sync progress
  const subscribeToCoverSync = useCallback((jobId) => {
    setSyncingFolderArt(true);
    const eventSource = new EventSource(`/api/tracks/scan/progress/${jobId}`);
    let lastReload = Date.now();

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.done) {
          eventSource.close();
          setSyncingFolderArt(false);
          setCoverSyncProgress(null);
          setFeedbackMsg({
            type: 'success',
            text: `Successfully finished artwork sync! Found ${data.found || 0} covers, processed ${data.total || 0} tracks in database.`
          });
          setGlobalTimestamp(Date.now());
          loadTracks();
        } else {
          setCoverSyncProgress(data);
          // Periodically reload gallery every 5 seconds so user sees album tiles turn green live
          if (Date.now() - lastReload > 5000) {
            setGlobalTimestamp(Date.now());
            loadTracks();
            lastReload = Date.now();
          }
        }
      } catch (e) {
        console.error('Error parsing SSE progress:', e);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection error for cover sync:', err);
      eventSource.close();
      setSyncingFolderArt(false);
      setCoverSyncProgress(null);
    };

    return () => eventSource.close();
  }, [loadTracks]);

  // Check for already-running background sync on mount
  useEffect(() => {
    fetchActiveScanJobs().then(data => {
      const activeCoverJob = data?.jobs?.find(j => j.type === 'cover_sync');
      if (activeCoverJob?.job_id) {
        subscribeToCoverSync(activeCoverJob.job_id);
      }
    }).catch(() => {});
  }, [subscribeToCoverSync]);

  // Synchronize and incorporate existing folder and embedded artwork via background job
  const handleSyncFolderArt = async () => {
    setSyncingFolderArt(true);
    setFeedbackMsg(null);
    try {
      const selectedArr = selectedIds.size > 0 ? Array.from(selectedIds) : null;
      const res = await syncFolderCoverArt({ trackIds: selectedArr, embed: false });
      if (res.job_id) {
        subscribeToCoverSync(res.job_id);
      } else {
        setSyncingFolderArt(false);
        setFeedbackMsg({
          type: 'success',
          text: res.message || `Artwork check complete. Updated ${res.tracks_updated || 0} tracks.`
        });
        setGlobalTimestamp(Date.now());
        loadTracks();
      }
    } catch (err) {
      setSyncingFolderArt(false);
      setFeedbackMsg({
        type: 'error',
        text: extractErrorMsg(err, 'Failed to start artwork sync')
      });
    }
  };

  // Batch remove artwork from all selected tracks
  const handleBatchRemoveCover = () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;

    setConfirmModal({
      isOpen: true,
      title: 'Remove Artwork from Selected Tracks',
      message: `Remove embedded album cover art from all ${ids.length} selected tracks?`,
      confirmText: 'Remove Artwork',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await batchRemoveCover(ids);
          setVerifiedCovers(prev => {
            const next = { ...prev };
            ids.forEach(id => { next[id] = false; });
            return next;
          });
          // Remove target tracks and albums from recentlyFixed sets so badge clears immediately
          setRecentlyFixedGroupKeys(prev => {
            const next = new Set(prev);
            serverGroups.forEach(g => {
              if (g.tracks?.some(t => ids.includes(t.id))) {
                next.delete(g.key);
              }
            });
            return next;
          });
          setRecentlyFixedTrackIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.delete(id));
            return next;
          });
          const now = Date.now();
          setCoverTimestamps(prev => {
            const next = { ...prev };
            ids.forEach(id => { next[id] = now; });
            return next;
          });
          setFeedbackMsg({
            type: 'success',
            text: `Successfully removed cover art from ${ids.length} tracks.`
          });
          setGlobalTimestamp(Date.now());
          loadTracks();
        } catch (err) {
          setFeedbackMsg({
            type: 'error',
            text: extractErrorMsg(err, 'Failed to remove covers')
          });
        }
      }
    });
  };

  // Open editor for selected tracks
  const handleOpenSelectedInEditor = () => {
    const selectedTracks = tracks.filter(t => selectedIds.has(t.id));
    if (selectedTracks.length) {
      setEditingTracks(selectedTracks);
    }
  };

  // Open editor for single track
  const handleOpenTrackEditor = (track, e) => {
    if (e) e.stopPropagation();
    setEditingTracks([track]);
  };

  // Refresh after editor save without flying away
  const handleEditorUpdated = () => {
    const updatedIds = editingTracks?.map(t => t.id) || [];
    setRecentlyFixedTrackIds(prev => {
      const next = new Set(prev);
      updatedIds.forEach(id => next.add(id));
      return next;
    });
    
    // Make sure the "Cover Added" badge shows up for the group we just edited
    const rep = editingTracks?.[0];
    if (rep) {
      const groupKey = groupBy === 'folder' ? rep.directory : (rep[groupBy] || "Unknown");
      setRecentlyFixedGroupKeys(prev => new Set(prev).add(groupKey));
    }
    setGlobalTimestamp(Date.now());
    const now = Date.now();
    setCoverTimestamps(prev => {
      const next = { ...prev };
      updatedIds.forEach(id => { next[id] = now; });
      return next;
    });
    setVerifiedCovers(prev => {
      const next = { ...prev };
      updatedIds.forEach(id => { next[id] = true; });
      return next;
    });
    setTracks(prev => prev.map(t => updatedIds.includes(t.id) ? { ...t, has_cover: true } : t));
    if (groupBy !== 'none') {
      setServerGroups(prev => prev.map(g => {
        const hasAnyUpdated = g.tracks?.some(t => updatedIds.includes(t.id));
        if (hasAnyUpdated) {
          setRecentlyFixedGroupKeys(k => new Set(k).add(g.key));
          const updatedTracks = g.tracks.map(t => updatedIds.includes(t.id) ? { ...t, has_cover: true } : t);
          const hasCoverCount = updatedTracks.filter(t => t.has_cover).length;
          // Also update representative_track so TrackCoverSquare re-renders correctly
          const updatedRep = g.representative_track && updatedIds.includes(g.representative_track.id)
            ? { ...g.representative_track, has_cover: true }
            : g.representative_track
            ? { ...g.representative_track, has_cover: true }  // representative might not have art yet but group does now
            : g.representative_track;
          // Pick the best representative: first track with cover art from the group
          const bestRep = updatedTracks.find(t => t.has_cover) || updatedRep;
          return {
            ...g,
            representative_track: bestRep,
            tracks: updatedTracks,
            has_cover_count: hasCoverCount,
            missing_cover_count: Math.max(0, g.track_count - hasCoverCount),
          };
        }
        return g;
      }));
    }
  };

  const currentTotal = groupBy !== 'none' ? totalGroups : total;
  const totalPages = Math.max(1, Math.ceil(currentTotal / pageSize));
  const isAllCurrentSelected = tracks.length > 0 && tracks.every(t => selectedIds.has(t.id));

  return (
    <div className="space-y-4 pb-32">
      {/* Top Toolbar */}
      <div className="bg-surface-1/90 backdrop-blur-md border border-surface-5/40 rounded-2xl px-4 sm:px-6 py-4 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Title & Stats */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400">
              <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-ink-rich flex items-center gap-2">
                Album Art Gallery
                <span className="text-xs font-normal text-ink-muted">
                  {groupBy !== 'none'
                    ? `(${totalGroups.toLocaleString()} ${groupBy === 'folder' ? 'folders' : `${groupBy}s`}, ${totalTracksCount.toLocaleString()} ${filter === 'missing_cover' ? 'missing tracks' : 'tracks'})`
                    : `(${total.toLocaleString()} ${filter === 'missing_cover' ? 'missing tracks' : 'tracks'})`
                  }
                </span>
              </h2>
              <p className="text-[11px] text-ink-muted hidden sm:block">
                View embedded album artwork, select multiple tracks, and pull official covers using Google AI.
              </p>
            </div>
          </div>

          {/* Search Bar & Top Pagination */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search title, artist, album..."
                className="w-full bg-surface-2 border border-surface-5/50 rounded-lg pl-8 pr-8 py-1.5 text-xs text-ink-rich placeholder:text-ink-muted/60 focus:ring-1 focus:ring-amber-400 focus:border-amber-400/50 outline-none transition-all"
              />
              <svg className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 top-1/2 -translate-y-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-rich p-0.5">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              )}
            </div>

            {/* Top Pagination Bar */}
            <div className="flex items-center gap-1 bg-surface-2/90 border border-surface-5/50 rounded-lg px-2 py-1 text-xs">
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1}
                className="px-1.5 py-0.5 rounded text-[10px] font-black text-ink-muted hover:text-ink-rich disabled:opacity-30 uppercase tracking-tighter"
                title="First Page"
              >
                First
              </button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-0.5 rounded bg-surface-3 hover:bg-surface-4 disabled:opacity-30 text-ink-rich font-bold text-xs"
                title="Previous Page"
              >
                ← Prev
              </button>
              <div className="px-2.5 py-0.5 rounded bg-surface-3 border border-surface-4 text-[11px] font-black text-amber-400 tabular-nums">
                {page} / {totalPages}
              </div>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2 py-0.5 rounded bg-surface-3 hover:bg-surface-4 disabled:opacity-30 text-ink-rich font-bold text-xs"
                title="Next Page"
              >
                Next →
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="px-1.5 py-0.5 rounded text-[10px] font-black text-ink-muted hover:text-ink-rich disabled:opacity-30 uppercase tracking-tighter"
                title="Last Page"
              >
                Last
              </button>
            </div>
          </div>
        </div>

        {/* Filters and Selection Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-surface-5/20">
          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
              {[
                { id: 'all', label: 'All Tracks' },
                { id: 'missing_cover', label: 'Missing Cover Art' },
                { id: 'has_cover', label: 'Has Cover Art' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => { setFilter(f.id); setPage(1); }}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    filter === f.id
                      ? 'bg-amber-400 text-surface-0 shadow-sm'
                      : 'bg-surface-2 hover:bg-surface-3 text-ink-normal border border-surface-5/40'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Group By Selector */}
            <div className="flex items-center gap-1 bg-surface-2 border border-surface-5/40 rounded-lg p-0.5 text-xs">
              <span className="text-[10px] font-bold text-ink-muted uppercase px-1.5 hidden sm:inline">Group:</span>
              {[
                { id: 'none', label: 'None', title: 'No Grouping — Show individual tracks' },
                { id: 'album', label: 'Album', title: 'Group tracks by Album' },
                { id: 'artist', label: 'Artist', title: 'Group tracks by Artist' },
                { id: 'folder', label: 'Folder', title: 'Group tracks by Folder' },
              ].map(g => (
                <button
                  key={g.id}
                  onClick={() => { setGroupBy(g.id); setPage(1); }}
                  title={g.title}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                    groupBy === g.id
                      ? 'bg-amber-400 text-surface-0 shadow-sm'
                      : 'text-ink-muted hover:text-ink-rich'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* Sync Existing Artwork Button (Folders + Embedded Audio Tags) */}
            <button
              onClick={handleSyncFolderArt}
              disabled={syncingFolderArt}
              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-surface-2 hover:bg-surface-3 border border-surface-5/40 hover:border-amber-400/50 text-ink-rich flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              title={selectedIds.size > 0 ? "Scan folders and embedded audio tags for selected tracks/albums to link existing artwork" : "Scan library folders (cover.jpg/folder.jpg) and embedded tags (FLAC/ID3) to capture existing artwork into database"}
            >
              <svg className={`w-3.5 h-3.5 text-amber-400 ${syncingFolderArt ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {syncingFolderArt ? (
                  <path d="M21 12a9 9 0 11-6.219-8.56"/>
                ) : (
                  <>
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                    <line x1="12" y1="11" x2="12" y2="17"/>
                    <line x1="9" y1="14" x2="15" y2="14"/>
                  </>
                )}
              </svg>
              <span>
                {syncingFolderArt 
                  ? 'Scanning Artwork...' 
                  : selectedIds.size > 0 
                  ? `Sync Existing Art (${selectedIds.size})` 
                  : 'Sync Existing Art'}
              </span>
            </button>

            {/* In-Page Refresh Gallery Button */}
            <button
              onClick={() => {
                const now = Date.now();
                setCoverTimestamps(prev => {
                  const next = { ...prev };
                  tracks.forEach(t => { next[t.id] = now; });
                  return next;
                });
                setGlobalTimestamp(now);
                loadTracks();
              }}
              disabled={loading}
              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-surface-2 hover:bg-surface-3 border border-surface-5/40 hover:border-amber-400/50 text-ink-rich flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              title="Refresh gallery and reload artwork"
            >
              <svg className={`w-3.5 h-3.5 text-amber-400 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
              <span>Refresh</span>
            </button>

            {/* Review Banner when items have been updated in Missing Cover Art mode */}
            {filter === 'missing_cover' && (recentlyFixedGroupKeys.size > 0 || recentlyFixedTrackIds.size > 0) && (
              <button
                onClick={() => {
                  setRecentlyFixedGroupKeys(new Set());
                  setRecentlyFixedTrackIds(new Set());
                  loadTracks();
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 flex items-center gap-1.5 transition-all animate-fade-in shadow-xs"
                title="Dismiss recently updated items and refresh missing list"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>
                  {recentlyFixedGroupKeys.size > 0
                    ? `${recentlyFixedGroupKeys.size} ${recentlyFixedGroupKeys.size === 1 ? 'album' : 'albums'} updated`
                    : `${recentlyFixedTrackIds.size} ${recentlyFixedTrackIds.size === 1 ? 'track' : 'tracks'} updated`
                  } (reviewing)
                </span>
                <span className="font-bold underline text-emerald-300 ml-1">Remove from Missing →</span>
              </button>
            )}
          </div>

          {/* Multi-Selection Actions */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={isAllCurrentSelected ? clearSelection : selectAllCurrent}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-2 hover:bg-surface-3 text-ink-normal border border-surface-5/40 transition-colors"
            >
              {isAllCurrentSelected ? 'Deselect Page' : 'Select Page'}
            </button>

            {selectedIds.size > 0 && (
              <>
                <span className="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-1 rounded border border-amber-400/20">
                  {selectedIds.size} Selected
                </span>

                <button
                  onClick={handleBatchSyncArt}
                  disabled={syncingFolderArt || syncingGroupId}
                  className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-white shadow-sm flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
                  title="Sync artwork across tracks in all selected albums/groups"
                >
                  <svg className={`w-3.5 h-3.5 ${syncingFolderArt ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    {syncingFolderArt ? (
                      <path d="M21 12a9 9 0 11-6.219-8.56"/>
                    ) : (
                      <>
                        <polyline points="23 4 23 10 17 10"/>
                        <polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                      </>
                    )}
                  </svg>
                  <span>
                    {syncingFolderArt 
                      ? 'Syncing Art...' 
                      : selectedGroups.length > 0 
                      ? `Sync Art (${selectedGroups.length} ${selectedGroups.length === 1 ? 'Album' : 'Albums'})` 
                      : `Sync Art (${selectedIds.size})`}
                  </span>
                </button>

                <button
                  onClick={handleBatchAiPull}
                  className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-surface-0 shadow-sm flex items-center gap-1.5 transition-all active:scale-95"
                  title="Search and pull official artwork for all selected tracks"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                  <span>Pull AI Covers ({selectedIds.size})</span>
                </button>

                <button
                  onClick={handleBatchRemoveCover}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1.5 transition-all"
                  title="Remove embedded artwork from all selected tracks"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                  <span>Remove Art ({selectedIds.size})</span>
                </button>

                <button
                  onClick={handleOpenSelectedInEditor}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-3 hover:bg-surface-4 text-ink-rich border border-surface-5/50 flex items-center gap-1.5 transition-all"
                  title="Bulk edit selected tracks in editor modal"
                >
                  <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <span>Edit in Editor</span>
                </button>

                <button
                  onClick={clearSelection}
                  className="text-xs text-ink-muted hover:text-ink-rich p-1"
                  title="Clear selection"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* Live Artwork Sync Progress Banner */}
        {coverSyncProgress && (
          <div className="p-3.5 bg-surface-2/90 border border-amber-500/40 rounded-xl shadow-lg flex flex-col gap-2 animate-fade-in">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span className="font-bold text-amber-400 shrink-0">Scanning Library Artwork</span>
                <span className="text-ink-muted shrink-0">·</span>
                <span className="text-ink-normal truncate font-mono text-[11px]">
                  {coverSyncProgress.filename || coverSyncProgress.status || 'Inspecting files...'}
                </span>
              </div>
              <div className="flex items-center gap-2.5 font-mono shrink-0 ml-2">
                <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  {coverSyncProgress.found || 0} covers found
                </span>
                <span className="text-ink-muted">|</span>
                <span className="text-ink-rich font-bold">
                  {coverSyncProgress.current} / {coverSyncProgress.total} ({coverSyncProgress.total > 0 ? Math.round((coverSyncProgress.current / coverSyncProgress.total) * 100) : 0}%)
                </span>
              </div>
            </div>
            {/* Progress bar track */}
            <div className="w-full bg-surface-4 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-400 h-full transition-all duration-300 rounded-full"
                style={{ width: `${coverSyncProgress.total > 0 ? Math.min(100, Math.round((coverSyncProgress.current / coverSyncProgress.total) * 100)) : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Global Toast / Feedback */}
        {feedbackMsg && (
          <div className={`text-xs px-3 py-1.5 rounded-lg border flex items-center justify-between animate-fade-in ${
            feedbackMsg.type === 'success' 
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
              : 'bg-red-500/10 text-red-400 border-red-500/20'
          }`}>
            <span>{typeof feedbackMsg.text === 'string' ? feedbackMsg.text : JSON.stringify(feedbackMsg.text)}</span>
            <button onClick={() => setFeedbackMsg(null)} className="opacity-70 hover:opacity-100 ml-2">×</button>
          </div>
        )}
      </div>

      {/* Main Grid View */}
      <div className="bg-surface-1/40 border border-surface-5/30 rounded-2xl p-4 sm:p-6 shadow-sm min-h-[300px]">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-ink-muted">
            <svg className="w-8 h-8 text-amber-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
            <p className="text-xs font-semibold">Loading Album Art Gallery...</p>
          </div>
        ) : tracks.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-2 text-ink-muted border border-dashed border-surface-5/30 rounded-2xl p-6 text-center">
            <svg className="w-12 h-12 text-ink-muted/40 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <p className="text-sm font-bold text-ink-normal">No tracks found</p>
            <p className="text-xs text-ink-muted max-w-sm">
              {debouncedSearch ? 'Try a different search query or clear the filter.' : 'Your library has no tracks matching this view.'}
            </p>
          </div>
        ) : groupBy !== 'none' && filteredGroups ? (
          /* ── Grouped View (e.g. Group by Album, Artist, or Folder) ── */
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 sm:gap-4">
              {filteredGroups.map(group => {
                const repTrack = group.representative_track || group.representativeTrack || (group.tracks && group.tracks[0]) || {};
                const previewTrack = (hoveredTrack?.groupKey === group.key) ? hoveredTrack.track : null;
                const displayedTrack = previewTrack || repTrack;
                const isPreviewing = Boolean(previewTrack);
                const previewTrackIndex = previewTrack ? group.tracks?.findIndex(t => t.id === previewTrack.id) : -1;
                const trackNum = previewTrackIndex >= 0 ? previewTrackIndex + 1 : (previewTrack?.track_number || '');
                const isGroupAllSelected = group.tracks?.length > 0 && group.tracks.every(t => selectedIds.has(t.id));
                const isGroupPartiallySelected = !isGroupAllSelected && group.tracks?.some(t => selectedIds.has(t.id));
                const hasCoverCount = group.has_cover_count !== undefined ? group.has_cover_count : (group.hasCoverCount || 0);
                const trackCount = group.track_count !== undefined ? group.track_count : (group.tracks?.length || 0);
                const allHaveCover = hasCoverCount === trackCount && trackCount > 0;
                const anyHaveCover = hasCoverCount > 0;
                const isExpanded = expandedGroups.has(group.key);
                const currentTimestamp = coverTimestamps[displayedTrack.id] || null;

                return (
                  <div
                    key={group.key}
                    onMouseLeave={() => {
                      if (hoveredTrack?.groupKey === group.key) {
                        setHoveredTrack(null);
                      }
                    }}
                    className={`group relative bg-surface-1 rounded-2xl border transition-all duration-200 flex flex-col overflow-hidden hover:shadow-lg ${
                      isGroupAllSelected
                        ? 'border-amber-400 ring-2 ring-amber-400/30 bg-surface-2'
                        : isGroupPartiallySelected
                        ? 'border-amber-400/60 bg-surface-2/40'
                        : isPreviewing
                        ? 'border-amber-400/70 shadow-amber-400/10'
                        : 'border-surface-5/40 hover:border-amber-400/40 hover:bg-surface-2/50'
                    }`}
                  >
                    {/* Square Representative Image (Reactively updates when hovering over any track) */}
                    <div className="relative aspect-square w-full bg-surface-3 overflow-hidden flex items-center justify-center">
                      <TrackCoverSquare
                        key={`${group.key}-${displayedTrack.id}`}
                        track={displayedTrack}
                        timestamp={currentTimestamp}
                        onCoverLoaded={(id) => setVerifiedCovers(prev => ({ ...prev, [id]: true }))}
                        onCoverError={(id) => setVerifiedCovers(prev => ({ ...prev, [id]: false }))}
                      />

                      {/* Active Track Hover Preview Badge Overlay with Instant Sync Button */}
                      {isPreviewing && (
                        <div className="absolute inset-x-1.5 bottom-1.5 z-20 animate-fadeIn pointer-events-auto">
                          <div className="bg-black/90 backdrop-blur-md px-2 py-1 rounded-lg border border-amber-400/60 shadow-2xl flex items-center justify-between gap-1.5 text-white">
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                              <span className="text-[10px] font-bold text-amber-300 truncate">
                                {trackNum ? `#${trackNum} ` : ''}{previewTrack.title || previewTrack.filename}
                              </span>
                            </div>
                            {previewTrack.has_cover ? (
                              <button
                                type="button"
                                onClick={(e) => handleSyncGroupArt(group, previewTrack, e)}
                                disabled={syncingGroupId === group.key}
                                className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-white text-[9px] font-bold shadow-md shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-50 shrink-0 cursor-pointer"
                                title={`Sync Track ${trackNum} artwork to all tracks in this album`}
                              >
                                <svg className={`w-2.5 h-2.5 ${syncingGroupId === group.key ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <polyline points="23 4 23 10 17 10"/>
                                  <polyline points="1 20 1 14 7 14"/>
                                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                                </svg>
                                <span>{syncingGroupId === group.key ? 'Syncing...' : 'Sync to Album'}</span>
                              </button>
                            ) : (
                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded font-mono shrink-0 uppercase bg-red-500/90 text-white">
                                No Art
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Group Checkbox */}
                      <div
                        onClick={(e) => toggleSelectGroup(group, e)}
                        className={`absolute top-2 left-2 w-5 h-5 rounded-md border transition-all flex items-center justify-center z-10 cursor-pointer ${
                          isGroupAllSelected
                            ? 'bg-amber-400 border-amber-400 text-surface-0 shadow-sm'
                            : isGroupPartiallySelected
                            ? 'bg-amber-400/80 border-amber-400 text-surface-0'
                            : 'bg-black/50 backdrop-blur-xs border-white/40 text-transparent hover:border-white/80'
                        }`}
                        title={isGroupAllSelected ? "Deselect entire group" : "Select all tracks in this group"}
                      >
                        <svg className="w-3.5 h-3.5 stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          {isGroupPartiallySelected && !isGroupAllSelected ? (
                            <line x1="5" y1="12" x2="19" y2="12" strokeWidth="3" />
                          ) : (
                            <polyline points="20 6 9 17 4 12" />
                          )}
                        </svg>
                      </div>

                      {/* Status Badge */}
                      <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
                        {recentlyFixedGroupKeys.has(group.key) && anyHaveCover ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm backdrop-blur-xs uppercase font-mono bg-emerald-500 text-white ring-2 ring-emerald-400/60 flex items-center gap-1">
                            <svg className="w-2.5 h-2.5 stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg>
                            <span>Cover Added ({trackCount})</span>
                          </span>
                        ) : (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm backdrop-blur-xs uppercase font-mono transition-colors ${
                            allHaveCover
                              ? 'bg-emerald-500/90 text-white'
                              : anyHaveCover
                              ? 'bg-amber-500/90 text-white'
                              : 'bg-black/70 text-ink-muted border border-surface-5/50'
                          }`}>
                            {allHaveCover
                              ? `Cover (${trackCount})`
                              : anyHaveCover
                              ? `Partial (${hasCoverCount}/${trackCount})`
                              : `No Art (${trackCount})`
                            }
                          </span>
                        )}
                      </div>

                      {/* Quick Action Overlay (AI Pull Album + Edit + Sync Art) */}
                      <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5 pt-8 bg-gradient-to-t from-black/95 via-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center gap-1.5 z-10">
                        <button
                          type="button"
                          onClick={(e) => handleOpenGroupInEditor(group, e)}
                          className="flex-1 min-w-0 h-7.5 px-1.5 rounded-lg bg-surface-1/90 hover:bg-surface-1 text-ink-rich hover:text-amber-400 text-[10px] font-bold border border-surface-5/60 shadow-md inline-flex items-center justify-center gap-1.5 transition-all active:scale-95 whitespace-nowrap overflow-hidden"
                          title="Open all tracks in editor"
                        >
                          <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                          <span className="leading-none">Edit</span>
                        </button>

                        {anyHaveCover && (
                          <button
                            type="button"
                            onClick={(e) => handleSyncGroupArt(group, null, e)}
                            disabled={syncingGroupId === group.key}
                            className="flex-1 min-w-0 h-7.5 px-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] font-bold shadow-md shadow-emerald-500/20 inline-flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 whitespace-nowrap overflow-hidden"
                            title="Sync artwork across all tracks in this group"
                          >
                            <svg className={`w-3.5 h-3.5 shrink-0 ${syncingGroupId === group.key ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              {syncingGroupId === group.key ? (
                                <path d="M21 12a9 9 0 11-6.219-8.56"/>
                              ) : (
                                <>
                                  <polyline points="23 4 23 10 17 10"/>
                                  <polyline points="1 20 1 14 7 14"/>
                                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                                </>
                              )}
                            </svg>
                            <span className="leading-none">{syncingGroupId === group.key ? 'Syncing…' : 'Sync'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => handleGroupAiPull(group, e)}
                          className="flex-1 min-w-0 h-7.5 px-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-surface-0 text-[10px] font-bold shadow-md shadow-amber-400/20 inline-flex items-center justify-center gap-1.5 transition-all active:scale-95 whitespace-nowrap overflow-hidden"
                          title="Pull official cover once for all tracks in this album"
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                          </svg>
                          <span className="leading-none">{anyHaveCover ? 'AI' : 'AI Pull'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Group Details */}
                    <div className="p-2.5 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-ink-rich truncate" title={group.title}>
                          {group.title}
                        </h4>
                        <p className="text-[11px] text-ink-normal truncate mt-0.5" title={group.subtitle}>
                          {group.subtitle || '—'}
                        </p>
                      </div>

                      {/* Quick Track Hover Strip (Zero eager image requests on load! Lightweight pills) */}
                      {!isExpanded && group.tracks && group.tracks.length > 1 && (
                        <div className="mt-2 pt-1.5 border-t border-surface-5/20 flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5" title="Hover over any track number to preview its artwork or sync to album">
                          {group.tracks.slice(0, 10).map((t, idx) => {
                            const isPillHovered = previewTrack?.id === t.id;
                            const isSyncTarget = isPillHovered && t.has_cover;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onMouseEnter={() => setHoveredTrack({ groupKey: group.key, track: t })}
                                onClick={(e) => {
                                  if (t.has_cover) {
                                    handleSyncGroupArt(group, t, e);
                                  } else {
                                    handleOpenTrackEditor(t, e);
                                  }
                                }}
                                disabled={syncingGroupId === group.key}
                                className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold flex items-center justify-center cursor-pointer transition-all shrink-0 select-none ${
                                  isSyncTarget
                                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-md scale-110 z-10 ring-1 ring-emerald-300'
                                    : isPillHovered
                                    ? 'bg-amber-400 text-surface-0 shadow-md scale-105 z-10 ring-1 ring-amber-300'
                                    : t.has_cover
                                    ? 'bg-surface-3 text-ink-rich hover:bg-amber-400/20 hover:text-amber-300 border border-surface-5/40'
                                    : 'bg-surface-4/60 text-ink-muted/50 border border-surface-5/30 hover:border-surface-5'
                                }`}
                                title={
                                  t.has_cover
                                    ? (isPillHovered ? `Click to sync Track ${idx + 1} artwork to entire album` : `Track ${idx + 1}: ${t.title || t.filename} (Has artwork - click to sync)`)
                                    : `Track ${idx + 1}: ${t.title || t.filename} (No artwork - click to edit)`
                                }
                              >
                                {isSyncTarget ? (
                                  <svg className={`w-3 h-3 ${syncingGroupId === group.key ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polyline points="23 4 23 10 17 10"/>
                                    <polyline points="1 20 1 14 7 14"/>
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                                  </svg>
                                ) : (
                                  <>
                                    <span className={`w-1 h-1 rounded-full mr-1 shrink-0 ${isPillHovered ? 'bg-surface-0' : t.has_cover ? 'bg-emerald-400' : 'bg-amber-400/50'}`} />
                                    <span>{idx + 1}</span>
                                  </>
                                )}
                              </button>
                            );
                          })}
                          {group.tracks.length > 10 && (
                            <button
                              type="button"
                              onClick={() => toggleExpandGroup(group.key)}
                              className="text-[8px] font-bold text-ink-muted hover:text-amber-400 px-1 shrink-0"
                              title="View all tracks"
                            >
                              +{group.tracks.length - 10}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Expand / Collapse Tracks Toggle */}
                      <div className="mt-2 pt-2 border-t border-surface-5/30 flex items-center justify-between text-[10px]">
                        <span className="text-ink-muted font-medium">
                          {filter === 'missing_cover' && (group.missing_cover_count !== undefined ? group.missing_cover_count : (trackCount - hasCoverCount)) > 0
                            ? `${group.missing_cover_count !== undefined ? group.missing_cover_count : (trackCount - hasCoverCount)} missing of ${trackCount}`
                            : `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`
                          }
                        </span>
                        <div className="flex items-center gap-1.5">
                          {anyHaveCover && isExpanded && (
                            <button
                              type="button"
                              onClick={(e) => handleSyncGroupArt(group, null, e)}
                              disabled={syncingGroupId === group.key}
                              className="text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1 text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/20 transition-all active:scale-95 disabled:opacity-50"
                              title="Sync artwork across all tracks in this album"
                            >
                              <svg className={`w-2.5 h-2.5 ${syncingGroupId === group.key ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="23 4 23 10 17 10"/>
                                <polyline points="1 20 1 14 7 14"/>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                              </svg>
                              <span>{syncingGroupId === group.key ? 'Syncing...' : 'Sync All'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleExpandGroup(group.key)}
                            className="text-amber-400 hover:text-amber-300 font-bold flex items-center gap-0.5"
                          >
                            <span>{isExpanded ? 'Hide' : 'Tracks'}</span>
                            <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="6 9 12 15 18 9"/>
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Expandable Tracks Drawer - Individual Click-to-Edit & Hover Preview */}
                      {isExpanded && (
                        <div 
                          className="mt-2 pt-1 border-t border-surface-5/20 space-y-1 max-h-48 overflow-y-auto custom-scrollbar"
                          onMouseLeave={() => setHoveredTrack(null)}
                        >
                          {group.tracks.map((t, idx) => {
                            const isThisTrackHovered = previewTrack?.id === t.id;
                            return (
                              <div
                                key={t.id}
                                onClick={(e) => handleOpenTrackEditor(t, e)}
                                onMouseEnter={() => setHoveredTrack({ groupKey: group.key, track: t })}
                                className={`flex items-center justify-between text-[10px] p-1.5 rounded transition-all cursor-pointer group/track ${
                                  isThisTrackHovered
                                    ? 'bg-surface-3 ring-1 ring-amber-400/50 text-amber-300'
                                    : 'hover:bg-surface-3'
                                }`}
                                title={`Click to open editor for: ${t.title || t.filename}`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div
                                    onClick={(e) => toggleSelect(t.id, e)}
                                    className="p-0.5 cursor-pointer hover:scale-110 transition-transform shrink-0"
                                    title={selectedIds.has(t.id) ? "Deselect track" : "Select track"}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(t.id)}
                                      onChange={() => {}}
                                      className="rounded border-surface-5 text-amber-400 focus:ring-amber-400 cursor-pointer w-3 h-3 pointer-events-none"
                                    />
                                  </div>
                                  
                                  {/* Lightweight Status Dot (Zero eager image requests) */}
                                  <span 
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.has_cover ? 'bg-emerald-400 shadow-xs' : 'bg-amber-400/50'}`} 
                                    title={t.has_cover ? 'Embedded artwork present' : 'Missing artwork'} 
                                  />

                                  <span className="text-ink-muted w-3 text-right font-mono text-[9px] shrink-0">{idx + 1}</span>
                                  <span className={`truncate hover:underline ${selectedIds.has(t.id) ? 'text-amber-400 font-bold' : isThisTrackHovered ? 'text-amber-300 font-semibold' : 'text-ink-rich'}`}>
                                    {t.title || t.filename}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 ml-1">
                                  {t.has_cover && (
                                    <button
                                      type="button"
                                      onClick={(e) => handleSyncGroupArt(group, t, e)}
                                      disabled={syncingGroupId === group.key}
                                      className="opacity-0 group-hover/track:opacity-100 p-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 transition-opacity"
                                      title="Sync this track's cover to all tracks in album"
                                    >
                                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <polyline points="23 4 23 10 17 10"/>
                                        <polyline points="1 20 1 14 7 14"/>
                                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                                      </svg>
                                    </button>
                                  )}
                                  <span
                                    className="opacity-0 group-hover/track:opacity-100 p-0.5 text-ink-muted hover:text-amber-400 transition-opacity"
                                    title="Edit track in Universal Tag Editor"
                                  >
                                    <svg className="w-3 h-3 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                    </svg>
                                  </span>
                                  <span className="text-ink-muted font-mono uppercase text-[9px]">{t.format}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* ── Flat Individual Tracks View ── */
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 sm:gap-4">
              {visibleTracks.map(track => {
                const isSelected = selectedIds.has(track.id);
                const isAiLoading = aiLoadingIds[track.id];
                const currentTimestamp = coverTimestamps[track.id] || null;
                const hasCover = verifiedCovers[track.id] !== undefined 
                  ? verifiedCovers[track.id] 
                  : Boolean(track.has_cover);

                return (
                  <div
                    key={track.id}
                    onClick={(e) => toggleSelect(track.id, e)}
                    className={`group relative bg-surface-1 rounded-xl border transition-all duration-200 flex flex-col overflow-hidden cursor-pointer select-none hover:shadow-lg hover:border-amber-400/40 ${
                      isSelected 
                        ? 'border-amber-400 ring-2 ring-amber-400/30 bg-surface-2' 
                        : 'border-surface-5/40 hover:bg-surface-2/60'
                    }`}
                  >
                    {/* Square Image Container */}
                    <div className="relative aspect-square w-full bg-surface-3 overflow-hidden flex items-center justify-center">
                      <TrackCoverSquare
                        track={track}
                        timestamp={currentTimestamp}
                        onCoverLoaded={(id) => setVerifiedCovers(prev => ({ ...prev, [id]: true }))}
                        onCoverError={(id) => setVerifiedCovers(prev => ({ ...prev, [id]: false }))}
                      />

                      {/* Multi-Select Checkbox */}
                      <div 
                        onClick={(e) => toggleSelect(track.id, e)}
                        className={`absolute top-2 left-2 w-5 h-5 rounded-md border transition-all flex items-center justify-center z-10 ${
                          isSelected 
                            ? 'bg-amber-400 border-amber-400 text-surface-0 shadow-sm' 
                            : 'bg-black/50 backdrop-blur-xs border-white/40 text-transparent hover:border-white/80 opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5 stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>

                      {/* Format / Status Badge */}
                      <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
                        {recentlyFixedTrackIds.has(track.id) && hasCover ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm backdrop-blur-xs uppercase font-mono bg-emerald-500 text-white ring-2 ring-emerald-400/60 flex items-center gap-1">
                            <svg className="w-2.5 h-2.5 stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg>
                            <span>Cover Added</span>
                          </span>
                        ) : (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm backdrop-blur-xs uppercase font-mono transition-colors ${
                            hasCover 
                              ? 'bg-emerald-500/85 text-white' 
                              : 'bg-black/60 text-ink-muted border border-surface-5/50'
                          }`}>
                            {hasCover ? 'Cover' : 'No Art'}
                          </span>
                        )}
                      </div>

                      {/* AI Loading Overlay */}
                      {isAiLoading && (
                        <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center text-amber-400 gap-1.5 z-20 animate-fade-in">
                          <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M21 12a9 9 0 11-6.219-8.56"/>
                          </svg>
                          <span className="text-[10px] font-bold tracking-tight text-white">Google AI...</span>
                        </div>
                      )}

                      {/* Hover Quick Action Buttons Overlay */}
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between gap-1 z-10">
                        <button
                          type="button"
                          onClick={(e) => handleOpenTrackEditor(track, e)}
                          className="px-2 py-1 rounded bg-surface-1/90 hover:bg-surface-1 text-ink-rich hover:text-amber-400 text-[10px] font-bold border border-surface-5/50 shadow-sm flex items-center gap-1 transition-all"
                          title="Open track in editor window"
                        >
                          <svg className="w-3 h-3 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                          <span>Editor</span>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => handleSingleAiPull(track, e)}
                          disabled={isAiLoading}
                          className="px-2 py-1 rounded bg-amber-400 hover:bg-amber-300 text-surface-0 text-[10px] font-bold shadow-sm flex items-center gap-1 transition-all disabled:opacity-50"
                          title="Pull official cover from Google AI"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                          </svg>
                          <span>AI Pull</span>
                        </button>
                      </div>
                    </div>

                    {/* Text Details */}
                    <div className="p-2.5 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-ink-rich truncate" title={track.title || track.filename}>
                          {track.title || track.filename}
                        </h4>
                        <p className="text-[11px] text-ink-normal truncate" title={track.artist || 'Unknown Artist'}>
                          {track.artist || 'Unknown Artist'}
                        </p>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-ink-muted">
                        <span className="truncate max-w-[70%]" title={track.album || ''}>
                          {track.album || '—'}
                        </span>
                        <span className="font-mono uppercase text-[9px] opacity-75 shrink-0">
                          {track.format}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bottom Pagination Bar directly after the tiles */}
            <div className="mt-6 pt-4 border-t border-surface-5/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-ink-muted">
              <div className="flex items-center gap-2">
                {groupBy !== 'none' ? (
                  <>
                    <span className="font-bold text-ink-rich">
                      {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalGroups)}
                    </span>
                    <span>of</span>
                    <span className="font-bold text-amber-400">{totalGroups.toLocaleString()} {groupBy === 'folder' ? 'folders' : `${groupBy}s`}</span>
                    <span className="text-surface-5">•</span>
                    <span>({totalTracksCount.toLocaleString()} ${filter === 'missing_cover' ? 'missing tracks' : 'tracks'})</span>
                    <span className="text-surface-5">•</span>
                    <span>Page {page} of {totalPages}</span>
                  </>
                ) : (
                  <>
                    <span className="font-bold text-ink-rich">
                      {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}
                    </span>
                    <span>of</span>
                    <span className="font-bold text-amber-400">{total.toLocaleString()} tracks</span>
                    <span className="text-surface-5">•</span>
                    <span>Page {page} of {totalPages}</span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Per Page Selector */}
                <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <span>Per page:</span>
                  <select
                    value={pageSize}
                    onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="bg-surface-2 border border-surface-5/50 rounded px-2 py-1 text-xs text-ink-rich outline-none font-semibold"
                  >
                    <option value="24">24</option>
                    <option value="48">48</option>
                    <option value="96">96</option>
                    <option value="192">192</option>
                  </select>
                </label>

                {/* Quick Page Jump */}
                <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <span>Go to:</span>
                  <input
                    type="number"
                    min="1"
                    max={totalPages}
                    value={page}
                    onChange={e => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val >= 1 && val <= totalPages) {
                        setPage(val);
                      }
                    }}
                    className="w-14 bg-surface-2 border border-surface-5/50 rounded px-2 py-1 text-xs text-ink-rich text-center outline-none font-bold"
                  />
                </div>

                {/* Navigation Buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage(1)}
                    disabled={page <= 1}
                    className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-1 px-3 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted"
                  >
                    ← Prev
                  </button>
                  <div className="px-3.5 py-1 rounded-lg bg-surface-3 border border-surface-4 text-xs font-black text-amber-500 tabular-nums">
                    {page} / {totalPages}
                  </div>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1 px-3 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-xs font-bold text-ink-muted"
                  >
                    Next →
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={page >= totalPages}
                    className="p-1 px-2.5 rounded-lg border border-surface-4 hover:border-amber-500/30 hover:bg-surface-3 transition-all disabled:opacity-30 text-[10px] font-black text-ink-faint uppercase tracking-tighter"
                  >
                    Last
                  </button>
                </div>
              </div>
            </div>
          </div>

      {/* Batch Google AI Progress Modal */}
      {batchModalOpen && batchProgress && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-surface-1 rounded-2xl border border-surface-5/50 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between border-b border-surface-5/30 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-amber-400/10 text-amber-400">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                </span>
                <h3 className="text-sm font-bold text-ink-rich">Batch Google AI Cover Pull</h3>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-ink-normal">
                {batchProgress.running 
                  ? `Retrieving and embedding album artwork for ${batchProgress.total} tracks...`
                  : `Batch cover retrieval completed.`
                }
              </p>

              {/* Progress status indicators */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-surface-2 border border-surface-5/30">
                  <div className="text-ink-muted text-[10px] uppercase font-bold">Successfully Updated</div>
                  <div className="text-emerald-400 font-bold text-sm mt-0.5">{batchProgress.updated} tracks</div>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-2 border border-surface-5/30">
                  <div className="text-ink-muted text-[10px] uppercase font-bold">Unresolved / Failed</div>
                  <div className="text-red-400 font-bold text-sm mt-0.5">{batchProgress.failed} tracks</div>
                </div>
              </div>

              {batchProgress.error && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  <div className="font-bold mb-0.5 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <span>Status Details</span>
                  </div>
                  <div className="text-[11px] opacity-90">{typeof batchProgress.error === 'string' ? batchProgress.error : JSON.stringify(batchProgress.error)}</div>
                </div>
              )}

              {batchProgress.running && (
                <div className="flex items-center justify-center gap-2 py-3 text-amber-400 text-xs font-semibold">
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 11-6.219-8.56"/>
                  </svg>
                  <span>Querying Google AI & Embedding Art...</span>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                disabled={batchProgress.running}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-surface-0 disabled:opacity-50 shadow"
              >
                {batchProgress.running ? 'Processing...' : 'Done'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editor Modal Integration */}
      {editingTracks && (
        <TrackMetadataModal
          tracks={editingTracks}
          initialAction={editorInitialAction}
          onClose={() => {
            setEditingTracks(null);
            setEditorInitialAction(null);
          }}
          onUpdated={handleEditorUpdated}
        />
      )}

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
