import React, { useState, useEffect, useRef } from 'react';
import { useTracksContext, useFixerContext } from '../contexts/AppContext';
import ConfirmModal from './ConfirmModal';
import { 
  fetchProviders, 
  createProvider, 
  updateProvider, 
  deleteProvider, 
  activateProvider, 
  fetchProviderModels,
  fetchQuota,
  fetchLibrarySources,
  createLibrarySource,
  updateLibrarySource,
  deleteLibrarySource,
  relocateLibrary,
  fetchCleanupPatterns,
  addCleanupPattern,
  deleteCleanupPattern,
  fetchCleanupSuggestions,
  acceptCleanupSuggestion,
  dismissCleanupSuggestion,
  fetchSystemLogs,
  toggleDebugLogging,
  clearSystemLogs,
  getLogsDownloadUrl,
  fetchAutoScanSettings,
  updateAutoScanSettings,
  fetchFsWatcherSettings,
  updateFsWatcherSettings,
  fetchDatabaseStats,
  cleanupDatabase
} from '../api';

const SECTIONS = [
  {
    id: 'sources',
    label: 'Library & Auto-Scan',
    subtitle: 'Folders, live monitor & timed scan',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'database',
    label: 'Database & Storage',
    subtitle: 'Old path cleanup & path relocation',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    id: 'providers',
    label: 'AI Providers',
    subtitle: 'LLM engines, API keys & quotas',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    id: 'cleanup',
    label: 'Cleanup Rules',
    subtitle: 'Junk patterns & discovered tags',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
    ),
  },
  {
    id: 'maintenance',
    label: 'Maintenance Tools',
    subtitle: 'Global library batch utilities',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    id: 'logs',
    label: 'System Logs',
    subtitle: 'Live console & debug telemetry',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
];

export default function SettingsPanel({ visible = true }) {
  const tracks = useTracksContext();
  const fixer = useFixerContext();

  const [activeTab, setActiveTab] = useState('sources');
  const [sources, setSources] = useState([]);
  const [newSourcePath, setNewSourcePath] = useState('');
  const [relocateForm, setRelocateForm] = useState({ old: '', new: '' });
  const [relocateResult, setRelocateResult] = useState(null);
  const [dbStats, setDbStats] = useState(null);
  const [dbCleaning, setDbCleaning] = useState(false);
  const [dbCleanResult, setDbCleanResult] = useState(null);
  const [confirmClearPath, setConfirmClearPath] = useState(null);
  const [includeHistoryOnClear, setIncludeHistoryOnClear] = useState(true);
  const [providers, setProviders] = useState([]);
  const [presets, setPresets] = useState({});
  const [quota, setQuota] = useState(null);
  const [cleanupPatterns, setCleanupPatterns] = useState([]);
  const [cleanupSuggestions, setCleanupSuggestions] = useState([]);
  const [newPattern, setNewPattern] = useState({ pattern: '', category: 'junk', is_regex: false });
  const [modal, setModal] = useState(null);

  // Auto-Scan Scheduler State
  const [autoScan, setAutoScan] = useState({
    enabled: false,
    interval: '24h',
    custom_minutes: 60,
    interval_seconds: 86400,
    last_scan: null,
    next_scan_in_seconds: null,
    is_scanning: false
  });
  const [autoScanSaving, setAutoScanSaving] = useState(false);

  // Real-Time Filesystem Watcher State
  const [fsWatcher, setFsWatcher] = useState({
    enabled: false,
    mode: 'add_delete',
    poll_seconds: 10,
    snapshot_ready: false,
    watched_files_count: 0,
    watched_dirs: [],
    stats: {
      added_count: 0,
      modified_count: 0,
      deleted_count: 0,
      suppressed_self_count: 0,
      last_event_at: null,
      last_check_at: null,
    },
    recent_events: []
  });
  const [fsWatcherSaving, setFsWatcherSaving] = useState(false);

  const [logs, setLogs] = useState([]);
  const [logLevel, setLogLevel] = useState('INFO');
  const [logsLoading, setLogsLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingKeyId, setEditingKeyId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [fetchingModelsId, setFetchingModelsId] = useState(null);
  const [providerModels, setProviderModels] = useState({});
  const [newProvider, setNewProvider] = useState({ name: '', provider: 'gemini', api_base: '', api_key: '', model: 'gemini-1.5-flash' });

  const [formError, setFormError] = useState(null);

  const quotaTimer = useRef(null);

  useEffect(() => {
    if (visible) {
      loadAll();
      if (activeTab === 'logs') loadLogs();
      quotaTimer.current = setInterval(() => {
        loadQuota();
        if (activeTab === 'sources') {
          fetchFsWatcherSettings().then(d => d && setFsWatcher(d)).catch(() => {});
        }
      }, 10000);
    } else {
      clearInterval(quotaTimer.current);
    }
    return () => clearInterval(quotaTimer.current);
  }, [visible, activeTab]);

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const data = await fetchSystemLogs(500);
      setLogs(data.logs || []);
      setLogLevel(data.level || 'INFO');
    } catch (err) {
      setError('Failed to fetch system logs');
    } finally {
      setLogsLoading(false);
    }
  }

  async function handleToggleDebug() {
    try {
      const res = await toggleDebugLogging(logLevel !== 'DEBUG');
      setLogLevel(res.level);
      loadLogs();
    } catch (err) {
      setError('Failed to toggle debug logging');
    }
  }

  async function handleClearLogs() {
    try {
      await clearSystemLogs();
      loadLogs();
    } catch (err) {
      setError('Failed to clear logs');
    }
  }

  async function loadAll() {
    setLoading(true);
    setFormError(null);
    try {
      const [provData, sourcesData, cleanupData, suggestionsData, autoScanData, fsWatcherData, dbStatsData] = await Promise.all([
        fetchProviders(),
        fetchLibrarySources(),
        fetchCleanupPatterns(),
        fetchCleanupSuggestions(),
        fetchAutoScanSettings().catch(() => null),
        fetchFsWatcherSettings().catch(() => null),
        fetchDatabaseStats().catch(() => null)
      ]);
      setProviders(provData?.providers || []);
      setPresets(provData?.presets || {});
      setSources(sourcesData?.sources || []);
      setCleanupPatterns(cleanupData?.patterns || []);
      setCleanupSuggestions(suggestionsData?.suggestions || []);
      if (autoScanData) {
        setAutoScan(autoScanData);
      }
      if (fsWatcherData) {
        setFsWatcher(fsWatcherData);
      }
      if (dbStatsData) {
        setDbStats(dbStatsData);
      }
      loadQuota();
    } catch (err) {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  const handleUpdateFsWatcher = async (updates) => {
    const nextConfig = {
      enabled: updates.enabled !== undefined ? updates.enabled : fsWatcher.enabled,
      mode: updates.mode !== undefined ? updates.mode : fsWatcher.mode,
      poll_seconds: updates.poll_seconds !== undefined ? updates.poll_seconds : fsWatcher.poll_seconds,
    };
    setFsWatcherSaving(true);
    try {
      const updated = await updateFsWatcherSettings(nextConfig);
      setFsWatcher(updated);
      if (nextConfig.enabled) {
        setTimeout(async () => {
          const fresh = await fetchFsWatcherSettings().catch(() => null);
          if (fresh) setFsWatcher(fresh);
        }, 2500);
      }
    } catch (err) {
      setError('Failed to update filesystem watcher settings');
    } finally {
      setFsWatcherSaving(false);
    }
  };

  const handleDbCleanup = async (action, pathPrefix = null) => {
    setDbCleaning(true);
    setDbCleanResult(null);
    setFormError(null);
    try {
      const res = await cleanupDatabase({
        action,
        pathPrefix,
        includeHistory: includeHistoryOnClear
      });
      setDbCleanResult(res);
      setConfirmClearPath(null);
      if (res.stats) {
        setDbStats(res.stats);
      }
      const refreshed = await fetchDatabaseStats().catch(() => null);
      if (refreshed) setDbStats(refreshed);
      if (tracks?.reload) tracks.reload();
      // Re-fetch once more after background VACUUM finishes compacting the DB file size
      setTimeout(async () => {
        const postVacuum = await fetchDatabaseStats().catch(() => null);
        if (postVacuum) setDbStats(postVacuum);
      }, 2500);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Database cleanup failed';
      setFormError(Array.isArray(msg) ? msg[0].msg : msg);
    } finally {
      setDbCleaning(false);
    }
  };

  const handleToggleAutoScan = async (enabled) => {
    setAutoScanSaving(true);
    try {
      const updated = await updateAutoScanSettings({
        enabled,
        interval: autoScan.interval,
        custom_minutes: autoScan.custom_minutes
      });
      setAutoScan(updated);
    } catch (err) {
      setError('Failed to update auto-scan schedule');
    } finally {
      setAutoScanSaving(false);
    }
  };

  const handleAutoScanIntervalChange = async (interval) => {
    setAutoScanSaving(true);
    try {
      const updated = await updateAutoScanSettings({
        enabled: autoScan.enabled,
        interval,
        custom_minutes: autoScan.custom_minutes
      });
      setAutoScan(updated);
    } catch (err) {
      setError('Failed to update interval');
    } finally {
      setAutoScanSaving(false);
    }
  };

  const handleAutoScanCustomMinutesChange = async (minutes) => {
    const mins = Math.max(1, parseInt(minutes) || 1);
    setAutoScan(prev => ({ ...prev, custom_minutes: mins }));
    setAutoScanSaving(true);
    try {
      const updated = await updateAutoScanSettings({
        enabled: autoScan.enabled,
        interval: 'custom',
        custom_minutes: mins
      });
      setAutoScan(updated);
    } catch (err) {
      setError('Failed to update custom minutes');
    } finally {
      setAutoScanSaving(false);
    }
  };

  const handleAddSource = async () => {
    if (!newSourcePath.trim()) return;
    setSaving(true);
    try {
      await createLibrarySource(newSourcePath);
      setNewSourcePath('');
      await loadAll();
      if (tracks?.reload) tracks.reload();
    } catch (err) {
      setError('Failed to add source');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSource = async (id, enabled) => {
    try {
      await updateLibrarySource(id, { enabled });
      await loadAll();
      if (tracks?.reload) tracks.reload();
    } catch (err) {
      setError('Failed to update source');
    }
  };

  const handleDeleteSource = async (id) => {
    try {
      await deleteLibrarySource(id);
      await loadAll();
      if (tracks?.reload) tracks.reload();
    } catch (err) {
      setError('Failed to delete source');
    }
  };

  const handleRelocate = async () => {
    if (!relocateForm.old || !relocateForm.new) return;
    setSaving(true);
    setRelocateResult(null);
    setFormError(null);
    try {
      const res = await relocateLibrary(relocateForm.old, relocateForm.new);
      setRelocateResult(res);
      setRelocateForm({ old: '', new: '' });
      await loadAll();
      if (tracks?.reload) tracks.reload();
    } catch (err) {
      const msg = err.response?.data?.detail || 'Relocation failed';
      setFormError(Array.isArray(msg) ? msg[0].msg : msg);
    } finally {
      setSaving(false);
    }
  };

  const detectedBases = [...new Set(sources.map(s => {
    const parts = s.path.split('/');
    if (parts.length > 3) return parts.slice(0, 4).join('/');
    return s.path;
  }))];

  const handleAddCleanupPattern = async () => {
    if (!newPattern.pattern.trim()) return;
    setSaving(true);
    try {
      await addCleanupPattern(newPattern.pattern, newPattern.category, newPattern.is_regex);
      setNewPattern({ pattern: '', category: 'junk', is_regex: false });
      loadAll();
    } catch (err) {
      setError('Failed to add pattern');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCleanupPattern = async (id) => {
    try {
      await deleteCleanupPattern(id);
      loadAll();
    } catch (err) {
      setError('Failed to delete pattern');
    }
  };

  const handleAcceptSuggestion = async (id) => {
    try {
      await acceptCleanupSuggestion(id);
      loadAll();
    } catch (err) {
      setError('Failed to accept suggestion');
    }
  };

  const handleDismissSuggestion = async (id) => {
    try {
      await dismissCleanupSuggestion(id);
      loadAll();
    } catch (err) {
      setError('Failed to dismiss suggestion');
    }
  };

  async function loadQuota() {
    try {
      const q = await fetchQuota();
      setQuota(q);
    } catch (err) { /* silent */ }
  }

  const handleProviderTypeChange = (type) => {
    const preset = presets[type] || {};
    setNewProvider({
      ...newProvider,
      provider: type,
      api_base: preset.api_base || '',
      model: preset.default_model || ''
    });
    setFormError(null);
  };

  const handleAddProvider = async () => {
    if (!newProvider.name.trim()) return setFormError('Engine Name is required');
    if (!newProvider.api_key.trim()) return setFormError('API Key is required');
    
    setSaving(true);
    setFormError(null);
    try {
      await createProvider(newProvider);
      setShowAddForm(false);
      setNewProvider({ name: '', provider: 'gemini', api_base: '', api_key: '', model: '' });
      loadAll();
    } catch (err) {
      const msg = err.response?.data?.detail || 'Add failed';
      setFormError(Array.isArray(msg) ? msg[0].msg : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id) => {
    try {
      await activateProvider(id);
      loadAll();
    } catch (err) { setError('Activation failed'); }
  };

  const handleUpdateModel = async (id, model) => {
    try {
      if (!model) return;
      await updateProvider(id, { model });
      setEditingId(null);
      loadAll();
    } catch (err) { setError('Update failed'); }
  };

  const handleUpdateKey = async (id, api_key) => {
    try {
      if (!api_key) { setEditingKeyId(null); return; }
      await updateProvider(id, { api_key });
      setEditingKeyId(null);
      loadAll();
    } catch (err) { setError('Failed to update key'); }
  };

  const handleRefreshModels = async (id) => {
    setFetchingModelsId(id);
    try {
      const { models } = await fetchProviderModels(id);
      if (models && models.length > 0) {
        setProviderModels(prev => ({ ...prev, [id]: models }));
      } else {
        setError('No models found for this provider/key');
      }
    } catch (err) {
      setError('Failed to fetch models: Check API Key/Base');
    } finally {
      setFetchingModelsId(null);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteProvider(id);
      loadAll();
    } catch (err) { setError('Delete failed'); }
  };

  const handleSyncLanguageAll = () => {
    if (!fixer) return;
    const isAdding = fixer.isFixing;
    setModal({
      type: 'confirm',
      title: isAdding ? 'Add to Current Queue' : 'Sync Entire Library Language',
      message: isAdding 
        ? `You already have an active fix job. The entire library will be added to the queue.`
        : `Are you sure you want to run a global language sync across your ENTIRE library (${tracks?.total || 0} tracks)? This bypasses LLM and standard local formatting and strictly injects the stored language to the genre tags.`,
      onConfirm: async () => {
        setModal(null);
        try {
          await fixer.fix([], { language_only: true, all_tracks: true }, tracks?.reload);
        } catch (e) {}
      }
    });
  };

  if (!visible) return null;

  return (
    <div className="space-y-6 animate-fade-in pb-16">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-ink-rich font-display tracking-tight">Studio Settings &amp; Administration</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Configure library directories, clean up database records, manage AI providers, and run global maintenance tools.
          </p>
        </div>
        {dbStats && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="px-3 py-1.5 rounded-xl bg-surface-2 border border-surface-4 text-xs font-mono text-ink-normal flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-fn-success" />
              DB: <strong className="text-ink-rich">{dbStats.db_size_mb} MB</strong> ({dbStats.total_tracks.toLocaleString()} records)
            </span>
          </div>
        )}
      </div>

      {/* Main Layout: Sidebar + Content Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Navigation Sidebar */}
        <aside className="lg:col-span-3 studio-card p-1.5 sm:p-2 bg-surface-1 border-surface-4 flex lg:flex-col gap-1 overflow-x-auto no-scrollbar max-w-full">
          {SECTIONS.map((sec) => {
            const isActive = activeTab === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => setActiveTab(sec.id)}
                className={`flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3.5 py-2 sm:py-3 rounded-xl text-left transition-all shrink-0 lg:w-full ${
                  isActive
                    ? 'bg-amber-400/15 text-amber-400 border border-amber-400/30 shadow-sm'
                    : 'text-ink-muted hover:text-ink-rich hover:bg-surface-2 border border-transparent'
                }`}
              >
                <div className={`p-1.5 sm:p-2 rounded-lg shrink-0 ${isActive ? 'bg-amber-400 text-surface-0' : 'bg-surface-2 text-ink-faint'}`}>
                  {sec.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold tracking-wide whitespace-nowrap lg:whitespace-normal flex items-center gap-1.5">
                    <span>{sec.label}</span>
                    {sec.id === 'cleanup' && cleanupSuggestions.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-surface-0 text-[9px] font-black">
                        {cleanupSuggestions.length}
                      </span>
                    )}
                    {sec.id === 'database' && dbStats && (dbStats.stale_tracks > 0 || dbStats.missing_tracks > 0) && (
                      <span className="px-1.5 py-0.2 rounded-full bg-fn-danger/20 text-fn-danger border border-fn-danger/30 text-[9px] font-black">
                        {dbStats.stale_tracks + dbStats.missing_tracks}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-ink-faint truncate hidden lg:block mt-0.5">
                    {sec.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Right Content Area */}
        <div className="lg:col-span-9 studio-card p-3.5 sm:p-6 bg-surface-1 border-surface-4 min-h-[420px] sm:min-h-[520px]">
          {/* TAB 1: LIBRARY & AUTO-SCAN */}
          {activeTab === 'sources' && (
            <div className="space-y-8 animate-scale-in">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-ink-rich uppercase tracking-wider">Library Source Directories</h3>
                    <p className="text-xs text-ink-muted mt-0.5">
                      Enabled sources are indexed and displayed across the Library, Album Art Gallery, and History views.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={newSourcePath}
                      onChange={(e) => setNewSourcePath(e.target.value)}
                      placeholder="/app/music/..."
                      className="px-3 py-2 rounded-lg bg-surface-0 border border-surface-4 text-xs text-ink-rich w-full sm:w-64 font-mono focus:border-amber-400/50 outline-none"
                    />
                    <button 
                      onClick={handleAddSource}
                      disabled={saving || !newSourcePath}
                      className="btn-primary !py-2 !px-4 text-xs shrink-0"
                    >
                      Add Folder
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {sources.map((source) => (
                    <div key={source.id} className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${source.enabled ? 'bg-surface-0 border-surface-4' : 'bg-surface-2 border-surface-5 opacity-60'}`}>
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div 
                          onClick={() => handleToggleSource(source.id, !source.enabled)}
                          className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors duration-200 shrink-0 ${source.enabled ? 'bg-amber-400' : 'bg-surface-5'}`}
                        >
                          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-200 ${source.enabled ? 'left-6' : 'left-1'}`} />
                        </div>
                        <span className={`text-sm font-mono truncate font-medium ${source.enabled ? 'text-ink-rich' : 'text-ink-faint italic'}`}>
                          {source.path}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteSource(source.id)}
                        className="p-2 text-fn-danger/60 hover:text-fn-danger hover:bg-fn-danger/10 rounded-lg transition-all"
                        title="Remove Source"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  ))}
                  {sources.length === 0 && (
                    <div className="py-12 text-center border-2 border-dashed border-surface-4 rounded-2xl opacity-40">
                      <p className="text-xs">No library sources configured.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Real-Time Filesystem Monitor Section */}
              <div className="pt-6 border-t border-surface-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div className="flex flex-col">
                    <h3 className="text-sm font-bold text-ink-rich uppercase tracking-wider flex items-center gap-2">
                      <svg className="w-4 h-4 text-fn-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                      </svg>
                      Real-Time Filesystem Monitor (Live Watch)
                    </h3>
                    <span className="text-xs text-ink-muted mt-0.5">
                      Actively watches enabled library folders and immediately adds/removes audio files when changes occur on disk
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {fsWatcher.enabled && (
                      <span className="px-2.5 py-1 rounded-full bg-fn-success/15 text-fn-success border border-fn-success/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-fn-success animate-pulse" />
                        {fsWatcher.snapshot_ready
                          ? `Watching ${fsWatcher.watched_files_count.toLocaleString()} Audio Files`
                          : 'Building Snapshot...'}
                      </span>
                    )}
                    <div
                      onClick={() => !fsWatcherSaving && handleUpdateFsWatcher({ enabled: !fsWatcher.enabled })}
                      className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors duration-200 shrink-0 ${fsWatcher.enabled ? 'bg-fn-success' : 'bg-surface-5'}`}
                      title="Toggle Real-Time Filesystem Monitor"
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 ${fsWatcher.enabled ? 'left-6' : 'left-1'}`} />
                    </div>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border transition-all space-y-4 ${fsWatcher.enabled ? 'bg-surface-2 border-fn-success/30 shadow-inner' : 'bg-surface-2/40 border-surface-4 opacity-75'}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-ink-normal font-bold uppercase tracking-wider mb-1.5">
                        Monitoring Mode (External Server Protection)
                      </label>
                      <select
                        value={fsWatcher.mode}
                        disabled={!fsWatcher.enabled || fsWatcherSaving}
                        onChange={(e) => handleUpdateFsWatcher({ mode: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs text-ink-rich font-medium focus:border-fn-success/50 outline-none disabled:opacity-50"
                      >
                        <option value="add_delete">Add &amp; Delete Only (Recommended — Safe for Jellyfin / Navidrome)</option>
                        <option value="all">Add, Delete &amp; External Modifications (Re-scan on mtime/size change)</option>
                      </select>
                      <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
                        {fsWatcher.mode === 'add_delete'
                          ? 'Strictly indexes newly added audio files and removes deleted ones. External metadata touches by Jellyfin/Navidrome will not trigger re-scans.'
                          : 'Indexes added/deleted files AND re-scans existing audio files if modified externally. LexiTag internal edits are automatically ignored.'}
                      </p>
                    </div>

                    <div>
                      <label className="block text-[10px] text-ink-normal font-bold uppercase tracking-wider mb-1.5">
                        Filesystem Check Frequency
                      </label>
                      <select
                        value={fsWatcher.poll_seconds}
                        disabled={!fsWatcher.enabled || fsWatcherSaving}
                        onChange={(e) => handleUpdateFsWatcher({ poll_seconds: Number(e.target.value) })}
                        className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs text-ink-rich font-medium focus:border-fn-success/50 outline-none disabled:opacity-50"
                      >
                        <option value={5}>Every 5 Seconds (Instant Response)</option>
                        <option value={10}>Every 10 Seconds (Recommended Balanced)</option>
                        <option value={30}>Every 30 Seconds (Low I/O)</option>
                        <option value={60}>Every 60 Seconds</option>
                      </select>
                      <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
                        Strictly monitors audio files (<span className="font-mono text-ink-muted">.mp3, .flac, .m4a, .wav, .ogg, .opus, .aac, .wma</span>). Ignores <span className="font-mono text-ink-muted">cover.jpg, .png, .lrc, .nfo</span> &amp; LexiTag&apos;s own writes.
                      </p>
                    </div>
                  </div>

                  {/* Live Watcher Counters */}
                  {fsWatcher.enabled && (
                    <div className="pt-3 border-t border-surface-4/60 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="p-2.5 rounded-lg bg-surface-0 border border-surface-4">
                          <div className="text-[9px] text-ink-faint uppercase font-bold">Auto-Added</div>
                          <div className="text-sm font-mono font-bold text-fn-success mt-0.5">
                            +{fsWatcher.stats?.added_count || 0}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-surface-0 border border-surface-4">
                          <div className="text-[9px] text-ink-faint uppercase font-bold">Ext. Modified</div>
                          <div className="text-sm font-mono font-bold text-amber-400 mt-0.5">
                            ~{fsWatcher.stats?.modified_count || 0}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-surface-0 border border-surface-4">
                          <div className="text-[9px] text-ink-faint uppercase font-bold">Auto-Removed</div>
                          <div className="text-sm font-mono font-bold text-fn-danger mt-0.5">
                            -{fsWatcher.stats?.deleted_count || 0}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-surface-0 border border-surface-4" title="LexiTag's own tag/cover/rename writes automatically suppressed">
                          <div className="text-[9px] text-ink-faint uppercase font-bold">Self-Writes Ignored</div>
                          <div className="text-sm font-mono font-bold text-ink-normal mt-0.5">
                            {fsWatcher.stats?.suppressed_self_count || 0}
                          </div>
                        </div>
                      </div>

                      {fsWatcher.recent_events && fsWatcher.recent_events.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-surface-0 border border-surface-4 max-h-32 overflow-y-auto space-y-1">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-ink-faint mb-1">Recent Filesystem Events</div>
                          {fsWatcher.recent_events.slice(0, 6).map((ev, idx) => (
                            <div key={idx} className="flex items-center justify-between text-[11px] font-mono gap-2">
                              <div className="flex items-center gap-2 truncate">
                                <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                                  ev.type === 'added' ? 'bg-fn-success/15 text-fn-success' :
                                  ev.type === 'deleted' ? 'bg-fn-danger/15 text-fn-danger' :
                                  'bg-amber-400/15 text-amber-400'
                                }`}>
                                  {ev.type}
                                </span>
                                <span className="text-ink-rich truncate">{ev.filename}</span>
                              </div>
                              <span className="text-[10px] text-ink-faint shrink-0">{ev.timestamp}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Automated Library Scanner Section */}
              <div className="pt-6 border-t border-surface-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div className="flex flex-col">
                    <h3 className="text-sm font-bold text-ink-rich uppercase tracking-wider flex items-center gap-2">
                      <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      Periodic Library Auto-Scan
                    </h3>
                    <span className="text-xs text-ink-muted mt-0.5">
                      Automatically scan and sync music directories in the background on a schedule
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {autoScan.enabled && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-400/15 text-amber-400 border border-amber-400/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        {autoScan.next_scan_in_seconds !== null ? (
                          `Next in: ${
                            autoScan.next_scan_in_seconds >= 3600 
                              ? `${Math.floor(autoScan.next_scan_in_seconds / 3600)}h ${Math.floor((autoScan.next_scan_in_seconds % 3600) / 60)}m`
                              : `${Math.floor(autoScan.next_scan_in_seconds / 60)}m ${autoScan.next_scan_in_seconds % 60}s`
                          }`
                        ) : 'Active'}
                      </span>
                    )}
                    <div 
                      onClick={() => !autoScanSaving && handleToggleAutoScan(!autoScan.enabled)}
                      className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors duration-200 shrink-0 ${autoScan.enabled ? 'bg-amber-400' : 'bg-surface-5'}`}
                      title="Toggle Auto-Scan"
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 ${autoScan.enabled ? 'left-6' : 'left-1'}`} />
                    </div>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border transition-all ${autoScan.enabled ? 'bg-surface-2 border-amber-400/30 shadow-inner' : 'bg-surface-2/40 border-surface-4 opacity-75'}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-ink-normal font-bold uppercase tracking-wider mb-1.5">
                        Scan Frequency / Interval
                      </label>
                      <select
                        value={autoScan.interval}
                        disabled={!autoScan.enabled || autoScanSaving}
                        onChange={(e) => handleAutoScanIntervalChange(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs text-ink-rich font-medium focus:border-amber-400/50 outline-none disabled:opacity-50"
                      >
                        <option value="1h">Every 1 Hour</option>
                        <option value="6h">Every 6 Hours</option>
                        <option value="12h">Every 12 Hours</option>
                        <option value="24h">Every 24 Hours (Daily)</option>
                        <option value="7d">Every 7 Days (Weekly)</option>
                        <option value="custom">Custom Timing...</option>
                      </select>
                    </div>

                    {autoScan.interval === 'custom' && (
                      <div className="animate-fade-in">
                        <label className="block text-[10px] text-ink-normal font-bold uppercase tracking-wider mb-1.5">
                          Custom Interval (Minutes)
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            max="10080"
                            disabled={!autoScan.enabled || autoScanSaving}
                            value={autoScan.custom_minutes}
                            onChange={(e) => handleAutoScanCustomMinutesChange(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs font-mono text-ink-rich focus:border-amber-400/50 outline-none disabled:opacity-50"
                            placeholder="e.g. 45"
                          />
                          <span className="text-xs text-ink-muted font-medium whitespace-nowrap">
                            ({autoScan.custom_minutes >= 60 ? `${(autoScan.custom_minutes / 60).toFixed(1)} hrs` : `${autoScan.custom_minutes} mins`})
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {autoScan.last_scan && (
                    <div className="mt-3 pt-3 border-t border-surface-4/60 flex items-center justify-between text-xs text-ink-muted">
                      <span>Last automated scan:</span>
                      <span className="font-mono text-ink-normal font-medium">{new Date(autoScan.last_scan).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DATABASE & STORAGE (OLD PATH CLEANUP + RELOCATION) */}
          {activeTab === 'database' && (
            <div className="space-y-8 animate-scale-in">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div className="flex flex-col">
                    <h3 className="text-sm font-bold text-ink-rich uppercase tracking-wider flex items-center gap-2">
                      <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <ellipse cx="12" cy="5" rx="9" ry="3" />
                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                      </svg>
                      Database &amp; Old Path Cleanup
                    </h3>
                    <span className="text-xs text-ink-muted mt-0.5">
                      Inspect indexed directory locations in the database and purge old or orphaned path records
                    </span>
                  </div>
                  {dbStats && (
                    <span className="px-3 py-1 rounded-lg bg-surface-2 border border-surface-4 text-xs font-mono text-ink-normal break-all">
                      {dbStats.db_path} ({dbStats.db_size_mb} MB)
                    </span>
                  )}
                </div>

                {dbStats ? (
                  <div className="p-4 sm:p-5 rounded-xl bg-surface-2 border border-surface-4 space-y-5 shadow-inner">
                    {/* Summary Counters */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 rounded-lg bg-surface-0 border border-surface-4">
                        <div className="text-[10px] text-ink-faint uppercase font-bold">Total DB Tracks</div>
                        <div className="text-lg font-mono font-bold text-ink-rich mt-0.5">{dbStats.total_tracks.toLocaleString()}</div>
                      </div>
                      <div className="p-3 rounded-lg bg-surface-0 border border-surface-4">
                        <div className="text-[10px] text-fn-success uppercase font-bold">Active Source Tracks</div>
                        <div className="text-lg font-mono font-bold text-fn-success mt-0.5">
                          {(dbStats.total_tracks - dbStats.stale_tracks - dbStats.missing_tracks).toLocaleString()}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-surface-0 border border-surface-4">
                        <div className="text-[10px] text-amber-400 uppercase font-bold">Old / Stale Path Tracks</div>
                        <div className="text-lg font-mono font-bold text-amber-400 mt-0.5">{dbStats.stale_tracks.toLocaleString()}</div>
                      </div>
                      <div className="p-3 rounded-lg bg-surface-0 border border-surface-4">
                        <div className="text-[10px] text-fn-danger uppercase font-bold">Missing / Ghost Files</div>
                        <div className="text-lg font-mono font-bold text-fn-danger mt-0.5">{dbStats.missing_tracks.toLocaleString()}</div>
                      </div>
                    </div>

                    {/* History Toggle & Global Bulk Actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={includeHistoryOnClear}
                          onChange={(e) => setIncludeHistoryOnClear(e.target.checked)}
                          className="w-4 h-4 accent-amber-400"
                        />
                        <span className="text-xs text-ink-muted group-hover:text-ink-rich font-bold uppercase tracking-wider">
                          Also clear related Tag History ({dbStats.total_history.toLocaleString()} total records)
                        </span>
                      </label>

                      <div className="flex flex-wrap items-center gap-2">
                        {dbStats.missing_tracks > 0 && (
                          <button
                            onClick={() => handleDbCleanup('clear_missing')}
                            disabled={dbCleaning}
                            className="px-3.5 py-2 rounded-lg bg-surface-0 border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                          >
                            {dbCleaning ? 'Cleaning...' : `Purge Missing (${dbStats.missing_tracks.toLocaleString()})`}
                          </button>
                        )}
                        {dbStats.stale_tracks > 0 && (
                          confirmClearPath === '__ALL_STALE__' ? (
                            <div className="flex items-center gap-2 bg-fn-danger/10 border border-fn-danger/30 px-3 py-1.5 rounded-lg">
                              <span className="text-xs text-fn-danger font-bold">
                                {dbCleaning ? 'Purging records...' : `Clear all ${dbStats.stale_tracks.toLocaleString()} old records?`}
                              </span>
                              <button
                                onClick={() => handleDbCleanup('clear_stale_paths')}
                                disabled={dbCleaning}
                                className="px-2.5 py-1 rounded bg-fn-danger text-white text-xs font-black uppercase hover:bg-red-600 disabled:opacity-50"
                              >
                                {dbCleaning ? 'Purging...' : 'Confirm'}
                              </button>
                              {!dbCleaning && (
                                <button
                                  onClick={() => setConfirmClearPath(null)}
                                  className="px-2 py-1 text-xs text-ink-muted hover:text-ink-rich font-bold"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmClearPath('__ALL_STALE__')}
                              disabled={dbCleaning}
                              className="px-3.5 py-2 rounded-lg bg-fn-danger/15 border border-fn-danger/40 text-fn-danger hover:bg-fn-danger/25 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50"
                            >
                              Clear All Old Locations ({dbStats.stale_tracks.toLocaleString()})
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    {/* Per-Location Breakdown */}
                    <div className="space-y-2.5 pt-2">
                      <div className="text-xs font-bold text-ink-muted uppercase tracking-wider">
                        Database Locations Breakdown ({dbStats.locations?.length || 0})
                      </div>
                      <div className="space-y-2.5">
                        {(dbStats.locations || []).map((loc) => (
                          <div
                            key={loc.path_prefix}
                            className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
                              loc.is_enabled_source
                                ? 'bg-surface-0 border-fn-success/30'
                                : 'bg-surface-1 border-amber-400/30'
                            }`}
                          >
                            <div className="space-y-1.5 min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm font-bold text-ink-rich break-all">
                                  {loc.path_prefix}
                                </span>
                                {loc.is_enabled_source ? (
                                  <span className="px-2 py-0.5 rounded-full bg-fn-success/15 text-fn-success border border-fn-success/30 text-[10px] font-black uppercase tracking-wider">
                                    Active Source
                                  </span>
                                ) : loc.is_configured_source ? (
                                  <span className="px-2 py-0.5 rounded-full bg-surface-3 text-ink-muted text-[10px] font-bold uppercase tracking-wider">
                                    Disabled Source
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-400 border border-amber-400/30 text-[10px] font-black uppercase tracking-wider">
                                    Old / Unconfigured Path
                                  </span>
                                )}
                                {!loc.exists_on_disk && (
                                  <span className="px-2 py-0.5 rounded-full bg-fn-danger/15 text-fn-danger text-[10px] font-bold uppercase">
                                    Folder Not Found on Disk
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted font-mono">
                                <span>Tracks: <strong className="text-ink-rich">{loc.total_tracks.toLocaleString()}</strong></span>
                                {loc.missing_tracks > 0 && (
                                  <span className="text-fn-danger">Missing: <strong>{loc.missing_tracks.toLocaleString()}</strong></span>
                                )}
                                <span>History Entries: <strong className="text-ink-rich">{loc.history_count.toLocaleString()}</strong></span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {loc.missing_tracks > 0 && loc.is_enabled_source && (
                                <button
                                  onClick={() => handleDbCleanup('clear_missing', loc.path_prefix)}
                                  disabled={dbCleaning}
                                  className="px-3 py-1.5 rounded-lg bg-surface-2 border border-amber-400/30 text-amber-400 hover:bg-amber-400/10 text-xs font-bold uppercase transition-all"
                                  title="Remove only missing/deleted files from this active source"
                                >
                                  Clear {loc.missing_tracks} Missing
                                </button>
                              )}

                              {confirmClearPath === loc.path_prefix ? (
                                <div className="flex items-center gap-2 bg-fn-danger/10 border border-fn-danger/30 px-3 py-1.5 rounded-lg">
                                  <span className="text-xs text-fn-danger font-bold">
                                    {dbCleaning ? 'Purging...' : 'Purge from DB?'}
                                  </span>
                                  <button
                                    onClick={() => handleDbCleanup('clear_path', loc.path_prefix)}
                                    disabled={dbCleaning}
                                    className="px-2.5 py-1 rounded bg-fn-danger text-white text-xs font-black uppercase hover:bg-red-600 disabled:opacity-50"
                                  >
                                    {dbCleaning ? '...' : 'Yes'}
                                  </button>
                                  {!dbCleaning && (
                                    <button
                                      onClick={() => setConfirmClearPath(null)}
                                      className="px-2 py-1 text-xs text-ink-muted hover:text-ink-rich font-bold"
                                    >
                                      No
                                    </button>
                                  )}
                                </div>
                              ) : (
                                (loc.total_tracks > 0 || loc.history_count > 0) && (
                                  <button
                                    onClick={() => setConfirmClearPath(loc.path_prefix)}
                                    disabled={dbCleaning}
                                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border ${
                                      loc.is_enabled_source
                                        ? 'bg-surface-2 border-surface-4 text-ink-muted hover:text-fn-danger hover:border-fn-danger/40'
                                        : 'bg-fn-danger/10 border-fn-danger/30 text-fn-danger hover:bg-fn-danger/20'
                                    }`}
                                  >
                                    Clear Location
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {dbCleanResult && (
                      <div className="p-3.5 rounded-xl bg-fn-success/10 border border-fn-success/30 text-xs text-fn-success flex items-center justify-between animate-scale-in">
                        <div className="flex items-center gap-2 font-bold">
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                          <span>
                            Purged <strong>{dbCleanResult.tracks_deleted.toLocaleString()}</strong> tracks and <strong>{dbCleanResult.history_deleted.toLocaleString()}</strong> history entries. Database compacted!
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-8 rounded-xl bg-surface-2 border border-surface-4 text-center text-xs text-ink-faint">
                    Loading database path statistics...
                  </div>
                )}
              </div>

              {/* Path Relocation Section — The Migration Matrix */}
              <div className="pt-6 border-t border-surface-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col">
                    <h3 className="text-sm font-bold text-ink-rich uppercase tracking-wider">Library Migration Matrix</h3>
                    <span className="text-xs text-ink-muted mt-0.5">Remap existing database track and history paths when moving folders between hosts or containers</span>
                  </div>
                </div>
                
                <div className="p-5 rounded-xl bg-surface-2 border border-surface-4 space-y-5 shadow-inner">
                  <div className="space-y-2">
                    <label className="block text-[10px] text-ink-faint uppercase font-bold">Detected Source Bases (Click to autofill)</label>
                    <div className="flex flex-wrap gap-2">
                      {detectedBases.map(base => (
                        <div 
                          key={base}
                          onClick={() => setRelocateForm({...relocateForm, old: base})}
                          className="px-3 py-1.5 rounded-lg bg-surface-0 border border-surface-4 text-xs font-mono text-ink-normal hover:border-amber-400/50 hover:bg-surface-1 cursor-pointer transition-all flex items-center gap-2 group"
                        >
                          <svg className="w-3.5 h-3.5 text-ink-faint group-hover:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                          {base}
                        </div>
                      ))}
                      {detectedBases.length === 0 && <span className="text-xs text-ink-faint italic">No sources configured yet.</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs text-ink-muted font-bold uppercase">Old Base Path</label>
                      <input 
                        type="text" 
                        placeholder="e.g. /Volumes/Media/Music"
                        value={relocateForm.old}
                        onChange={e => setRelocateForm({...relocateForm, old: e.target.value})}
                        className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs font-mono text-ink-rich focus:border-amber-400/50 outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-ink-muted font-bold uppercase">New Base Path (Container)</label>
                      <input 
                        type="text" 
                        placeholder="/app/music"
                        value={relocateForm.new}
                        onChange={e => setRelocateForm({...relocateForm, new: e.target.value})}
                        className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs font-mono text-ink-rich focus:border-amber-400/50 outline-none"
                      />
                    </div>
                  </div>

                  {relocateResult && (
                    <div className="p-4 rounded-xl bg-fn-success/5 border border-fn-success/20 text-xs text-fn-success space-y-2">
                      <div className="font-bold">
                        Relocated {relocateResult.tracks_updated} tracks and {relocateResult.history_updated} history entries ({relocateResult.sample_match_percentage}% sample match).
                      </div>
                    </div>
                  )}

                  {formError && activeTab === 'database' && !relocateResult && (
                    <div className="p-3 rounded-lg bg-fn-danger/10 border border-fn-danger/20 text-xs text-fn-danger font-bold">
                      {formError}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button 
                      onClick={handleRelocate}
                      disabled={saving || !relocateForm.old || !relocateForm.new}
                      className="btn-primary !py-2 !px-6 text-xs font-bold uppercase tracking-wider"
                    >
                      {saving ? 'Relocating...' : 'Relocate Library Paths'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AI PROVIDERS */}
          {activeTab === 'providers' && (
            <div className="space-y-6 animate-scale-in">
              {quota && quota.provider_name && (
                <div className="p-4 rounded-xl bg-surface-2 border border-surface-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] text-ink-faint uppercase font-bold">Active Engine</div>
                    <div className="text-base font-bold text-ink-rich">{quota.provider_name}</div>
                  </div>
                  {quota.remaining_requests !== null && (
                    <div className="text-right">
                      <div className="text-[10px] text-ink-faint uppercase font-bold">RPM Remaining</div>
                      <div className={`text-base font-mono font-bold ${quota.remaining_requests < 10 ? 'text-fn-danger' : 'text-fn-success'}`}>
                        {quota.remaining_requests}
                      </div>
                    </div>
                  )}
                  {quota.retry_after_seconds && !quota.daily_limit_reached && (
                    <div className="px-3 py-1 bg-fn-danger/10 border border-fn-danger/20 rounded text-xs text-fn-danger font-bold animate-pulse">
                      RATE LIMITED: {Math.ceil(quota.retry_after_seconds)}s
                    </div>
                  )}
                  {quota.daily_limit_reached && (
                    <div className="px-3 py-1 bg-fn-danger/20 border border-fn-danger/40 rounded text-xs text-fn-danger font-black animate-pulse">
                      DAILY LIMIT REACHED
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-ink-rich uppercase tracking-wider">Configured AI Engines</h3>
                  <p className="text-xs text-ink-muted mt-0.5">Manage Gemini, OpenAI-compatible, or Anthropic providers for metadata &amp; lyrics enrichment.</p>
                </div>
                <button 
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="btn-primary !py-2 !px-4 text-xs self-start sm:self-auto shrink-0"
                >
                  {showAddForm ? 'Cancel' : '+ Add Provider'}
                </button>
              </div>

              {showAddForm && (
                <div className="p-4 sm:p-5 rounded-xl bg-surface-2 border border-amber-400/30 space-y-4 shadow-inner">
                  {formError && (
                    <div className="px-3 py-2 rounded bg-fn-danger/10 border border-fn-danger/20 text-xs text-fn-danger font-bold">
                      {formError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-ink-muted font-bold uppercase mb-1">Engine Name</label>
                      <input 
                        type="text" placeholder="e.g. Primary Gemini"
                        value={newProvider.name}
                        onChange={e => { setNewProvider({...newProvider, name: e.target.value}); setFormError(null); }}
                        className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs focus:border-amber-400/50 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-muted font-bold uppercase mb-1">Provider Type</label>
                      <select 
                        value={newProvider.provider}
                        onChange={e => handleProviderTypeChange(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs"
                      >
                        {Object.keys(presets).map(p => <option key={p} value={p}>{presets[p].label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted font-bold uppercase mb-1">API Base URL</label>
                    <input 
                      type="text" placeholder="https://..."
                      value={newProvider.api_base}
                      onChange={e => setNewProvider({...newProvider, api_base: e.target.value})}
                      className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted font-bold uppercase mb-1">API Key</label>
                    <input 
                      type="password" placeholder="AIza... or sk-..."
                      value={newProvider.api_key}
                      onChange={e => setNewProvider({...newProvider, api_key: e.target.value})}
                      className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs font-mono"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={handleAddProvider} disabled={saving} className="btn-primary !py-2 !px-5 text-xs">Save Engine</button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {providers.map(p => (
                  <div key={p.id} className={`p-3.5 sm:p-4 rounded-xl border transition-all ${p.is_active ? 'bg-surface-0 border-amber-400/40 shadow-md ring-1 ring-amber-400/10' : 'bg-surface-0 border-surface-4 hover:border-surface-6'}`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2 rounded-lg shrink-0 ${p.is_active ? 'bg-amber-400/15 text-amber-400' : 'bg-surface-3 text-ink-faint'}`}>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-ink-rich truncate">{p.name}</div>
                          <div className="text-xs text-ink-faint font-mono truncate">{presets[p.provider]?.label || p.provider}</div>
                        </div>
                      </div>
                      {p.is_active ? (
                        <span className="px-2.5 py-1 rounded-full bg-amber-400/20 text-amber-400 text-[10px] font-black uppercase tracking-widest shrink-0">Active</span>
                      ) : (
                        <button onClick={() => handleActivate(p.id)} className="px-3 py-1 rounded-lg bg-surface-2 hover:bg-amber-400/15 text-xs font-bold text-amber-400 border border-amber-400/30 transition-colors shrink-0">Activate</button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-surface-4 mt-3">
                      <div className="text-xs text-ink-muted flex-1 flex flex-wrap items-center gap-y-1 min-w-0">
                        <span className="mr-1">Key:</span>
                        {editingKeyId === p.id ? (
                          <div className="flex items-center gap-1.5 mr-4">
                            <input 
                              type="password"
                              placeholder="New API Key..."
                              autoFocus
                              className="bg-surface-2 border border-amber-400/50 rounded px-2.5 py-1 text-xs font-mono outline-none w-32 sm:w-40"
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleUpdateKey(p.id, e.target.value);
                                if (e.key === 'Escape') setEditingKeyId(null);
                              }}
                            />
                            <button 
                              onClick={(e) => {
                                const input = e.currentTarget.previousElementSibling;
                                if (input.value) handleUpdateKey(p.id, input.value);
                                else setEditingKeyId(null);
                              }}
                              className="text-xs px-2.5 py-1 rounded bg-fn-success/10 text-fn-success border border-fn-success/30 hover:bg-fn-success/20"
                            >
                              Save
                            </button>
                            <button onClick={() => setEditingKeyId(null)} className="text-xs px-1.5 py-1 text-ink-muted hover:text-ink-normal">✕</button>
                          </div>
                        ) : (
                          <span 
                            onClick={() => setEditingKeyId(p.id)}
                            className="text-fn-success mr-4 cursor-pointer hover:text-amber-400 underline decoration-dotted underline-offset-2 font-semibold"
                            title="Click to edit API Key"
                          >
                            Encrypted ✓
                          </span>
                        )}
                        <span className="mr-1">Model:</span>
                        {editingId === p.id ? (
                          <div className="inline-flex gap-1.5 mt-1 w-full max-w-[300px]">
                            {providerModels[p.id] ? (
                              <select
                                autoFocus
                                className="flex-1 bg-surface-2 border border-amber-400/50 rounded px-2.5 py-1 text-xs font-mono outline-none"
                                value={p.model}
                                onChange={(e) => handleUpdateModel(p.id, e.target.value)}
                                onBlur={() => setEditingId(null)}
                              >
                                <option value={p.model}>{p.model} (current)</option>
                                {providerModels[p.id]
                                  .filter(m => m !== p.model)
                                  .map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            ) : (
                              <div className="flex items-center gap-2 flex-1">
                                <input 
                                  type="text" 
                                  defaultValue={p.model} 
                                  onBlur={(e) => handleUpdateModel(p.id, e.target.value)}
                                  autoFocus
                                  className="flex-1 bg-surface-2 border border-amber-400/50 rounded px-2.5 py-1 text-xs font-mono outline-none"
                                />
                                <button 
                                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleRefreshModels(p.id); }}
                                  disabled={fetchingModelsId === p.id}
                                  className="text-xs px-2.5 py-1 rounded border bg-amber-400/10 text-amber-400 border-amber-400/30 hover:bg-amber-400/20"
                                >
                                  {fetchingModelsId === p.id ? '...' : 'Fetch'}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span 
                            onClick={() => setEditingId(p.id)}
                            className="font-mono text-ink-rich hover:text-amber-400 cursor-pointer underline decoration-dotted underline-offset-2 ml-1 break-all"
                          >
                            {p.model || 'Default'}
                          </span>
                        )}
                      </div>
                      {deleteConfirmId === p.id ? (
                        <div className="flex gap-2 items-center shrink-0">
                          <span className="text-xs text-fn-danger font-bold">Delete?</span>
                          <button onClick={() => { handleDelete(p.id); setDeleteConfirmId(null); }} className="text-xs font-bold text-white bg-fn-danger px-2 py-0.5 rounded">Yes</button>
                          <button onClick={() => setDeleteConfirmId(null)} className="text-xs font-bold text-ink-muted px-2 py-0.5">No</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(p.id)} className="text-xs text-fn-danger/70 hover:text-fn-danger font-bold shrink-0">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: CLEANUP RULES */}
          {activeTab === 'cleanup' && (
            <div className="space-y-6 animate-scale-in">
              <div>
                <h3 className="text-sm font-bold text-ink-rich uppercase tracking-wider mb-1">Add Metadata Cleanup Rule</h3>
                <p className="text-xs text-ink-muted mb-4">
                  Rules are stripped locally before AI enrichment and again in a post-AI pass to prevent watermark re-injection.
                </p>
                
                <div className="p-4 rounded-xl bg-surface-2 border border-surface-4 space-y-4">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input 
                      type="text"
                      value={newPattern.pattern}
                      onChange={(e) => setNewPattern({...newPattern, pattern: e.target.value})}
                      placeholder="e.g. www.site.com or (Original Soundtrack)"
                      className="flex-1 px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs text-ink-rich focus:border-amber-400/50 outline-none font-mono"
                    />
                    <select
                      value={newPattern.category}
                      onChange={(e) => setNewPattern({...newPattern, category: e.target.value})}
                      className="px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs font-bold uppercase text-ink-muted"
                    >
                      <option value="junk">Promotional Junk</option>
                      <option value="soundtrack">Soundtrack Marker</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        checked={newPattern.is_regex}
                        onChange={(e) => setNewPattern({...newPattern, is_regex: e.target.checked})}
                        className="w-3.5 h-3.5 accent-amber-400"
                      />
                      <span className="text-xs text-ink-muted group-hover:text-ink-rich transition-colors font-semibold">Treat as Regular Expression</span>
                    </label>
                    <button 
                      onClick={handleAddCleanupPattern}
                      disabled={saving || !newPattern.pattern}
                      className="btn-primary !py-2 !px-5 text-xs"
                    >
                      Add Rule
                    </button>
                  </div>
                </div>
              </div>

              {cleanupSuggestions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <label className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                      Junk Discovery Candidates ({cleanupSuggestions.length})
                    </label>
                    <span className="text-xs text-ink-faint italic">Found during recent library scan</span>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {cleanupSuggestions.map((s) => (
                      <div key={s.id} className="p-3.5 sm:p-4 rounded-xl bg-amber-400/5 border border-amber-400/20 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-mono font-bold text-amber-400 break-all">{s.pattern}</span>
                            <span className="px-2 py-0.5 rounded bg-amber-400/20 text-amber-500 text-[10px] font-black uppercase shrink-0">
                              {s.frequency} Tracks
                            </span>
                          </div>
                          {s.sample_value && (
                            <div className="text-xs text-ink-muted italic bg-surface-0/50 p-2 rounded border border-surface-4 truncate">
                              "{s.sample_value}"
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0 self-end sm:self-auto">
                          <button 
                            onClick={() => handleAcceptSuggestion(s.id)}
                            className="px-3 py-1.5 rounded-lg bg-amber-400 text-surface-0 text-xs font-black uppercase hover:bg-amber-500"
                          >
                            Approve
                          </button>
                          <button 
                            onClick={() => handleDismissSuggestion(s.id)}
                            className="px-3 py-1.5 rounded-lg bg-surface-3 text-ink-muted text-xs font-bold uppercase hover:bg-surface-4"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <label className="block text-xs font-bold text-ink-muted uppercase tracking-wider">Active Cleanup Rules ({cleanupPatterns.length})</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {cleanupPatterns.map((p) => (
                    <div key={p.id} className="group flex items-center justify-between p-3 rounded-xl bg-surface-0 border border-surface-4 hover:border-surface-6 transition-all">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className={`shrink-0 w-2.5 h-2.5 rounded-full ${p.category === 'soundtrack' ? 'bg-amber-400' : 'bg-fn-danger/70'}`} title={p.category} />
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-xs font-mono text-ink-rich truncate">{p.pattern}</span>
                          <span className="text-[9px] uppercase tracking-wider text-ink-faint">{p.category} {p.is_regex ? '• REGEX' : ''}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteCleanupPattern(p.id)}
                        className="p-1.5 text-ink-faint hover:text-fn-danger hover:bg-fn-danger/10 rounded-md transition-all"
                        title="Remove Rule"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: MAINTENANCE TOOLS */}
          {activeTab === 'maintenance' && (
            <div className="space-y-6 animate-scale-in">
              <div>
                <h3 className="text-sm font-bold text-ink-rich uppercase tracking-wider">Global Library Maintenance</h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Run library-wide indexing, fast status evaluations, and global tag synchronization operations.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Full Library Scan Card */}
                <div className="p-5 rounded-xl bg-surface-2 border border-surface-4 flex flex-col justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M4 4v5h.582M20 20v-5h-.581M4.582 9A8 8 0 0 1 19.42 15" />
                      </svg>
                      Full Library Disk Scan
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed">
                      Walks all enabled Library Source folders on disk, indexes new audio files, detects sidecar <code className="text-amber-400">.lrc</code> files, and marks deleted files as missing.
                    </p>
                  </div>
                  <button
                    onClick={() => tracks?.scan && tracks.scan()}
                    disabled={tracks?.scanning}
                    className="btn-primary !py-2.5 !px-4 text-xs font-bold uppercase tracking-wider self-start disabled:opacity-50"
                  >
                    {tracks?.scanning && tracks?.scanProgress?.type !== 'refresh' ? 'Scan in Progress...' : 'Start Full Scan'}
                  </button>
                </div>

                {/* Fast Junk Status Refresh Card */}
                <div className="p-5 rounded-xl bg-surface-2 border border-surface-4 flex flex-col justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      Fast Junk &amp; Cover Status Refresh
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed">
                      Re-evaluates all active tracks in your enabled sources against your latest Cleanup Rules and checks cover art presence without a full directory walk.
                    </p>
                  </div>
                  <button
                    onClick={() => tracks?.refresh && tracks.refresh()}
                    disabled={tracks?.scanning}
                    className="px-4 py-2.5 rounded-lg bg-surface-0 border border-amber-400/40 text-amber-400 hover:bg-amber-400/15 text-xs font-bold uppercase tracking-wider self-start transition-all disabled:opacity-50"
                  >
                    {tracks?.scanning && tracks?.scanProgress?.type === 'refresh' ? 'Refresh in Progress...' : 'Run Status Refresh'}
                  </button>
                </div>

                {/* Global Language to Genre Sync Card */}
                <div className="p-5 rounded-xl bg-surface-2 border border-surface-4 flex flex-col justify-between gap-4 md:col-span-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M2 12h20" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      Sync Language to Genre Across Entire Library (All Lang)
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed">
                      Appends each track&apos;s detected language tag into its Genre field across your entire active library ({tracks?.total?.toLocaleString() || 0} tracks) without invoking AI or altering other metadata fields.
                    </p>
                  </div>
                  <button
                    onClick={handleSyncLanguageAll}
                    className="px-4 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 text-xs font-bold uppercase tracking-wider self-start transition-all"
                  >
                    Sync All Library Languages ({tracks?.total?.toLocaleString() || 0} Tracks)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: SYSTEM LOGS */}
          {activeTab === 'logs' && (
            <div className="space-y-4 animate-scale-in">
              <div className="p-4 rounded-xl bg-surface-2 border border-surface-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-ink-rich uppercase tracking-wider flex items-center gap-2">
                    <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                    System &amp; Application Logs
                  </h4>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Inspect backend events, AI calls, and background tasks in real time.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={handleToggleDebug}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border ${
                      logLevel === 'DEBUG'
                        ? 'bg-amber-400/10 text-amber-400 border-amber-400/40'
                        : 'bg-surface-1 text-ink-muted border-surface-4 hover:border-surface-6'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${logLevel === 'DEBUG' ? 'bg-amber-400 animate-ping' : 'bg-ink-faint'}`} />
                    Debug Mode: {logLevel === 'DEBUG' ? 'ON' : 'OFF'}
                  </button>

                  <a
                    href={getLogsDownloadUrl()}
                    download
                    className="btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5 text-black font-bold"
                  >
                    Download Log
                  </a>

                  <button
                    onClick={loadLogs}
                    disabled={logsLoading}
                    className="p-2 rounded-lg bg-surface-1 border border-surface-4 text-ink-muted hover:text-ink-rich hover:bg-surface-3 transition-colors"
                    title="Refresh Log View"
                  >
                    <svg className={`w-4 h-4 ${logsLoading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>

                  <button
                    onClick={handleClearLogs}
                    className="p-2 rounded-lg bg-surface-1 border border-surface-4 text-fn-danger/70 hover:text-fn-danger hover:bg-fn-danger/10 transition-colors"
                    title="Clear Log File"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-black/90 border border-surface-4 font-mono text-xs leading-relaxed text-zinc-300 max-h-[520px] overflow-y-auto shadow-inner space-y-1 select-text">
                {logs.length > 0 ? (
                  logs.map((line, idx) => {
                    let colorClass = "text-zinc-300";
                    if (line.includes("[ERROR]") || line.includes("Error") || line.includes("FAILED")) colorClass = "text-red-400 font-bold bg-red-950/30 px-1 rounded";
                    else if (line.includes("[WARNING]") || line.includes("Warning")) colorClass = "text-amber-300 font-medium";
                    else if (line.includes("[DEBUG]")) colorClass = "text-cyan-400";
                    else if (line.includes("[INFO]") || line.includes("SUCCESS")) colorClass = "text-emerald-400";

                    return (
                      <div key={idx} className={`${colorClass} whitespace-pre-wrap break-all border-b border-white/5 pb-0.5`}>
                        {line}
                      </div>
                    );
                  })
                ) : (
                  <div className="py-16 text-center text-zinc-500 italic">
                    No log entries recorded yet. System log is clean.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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
