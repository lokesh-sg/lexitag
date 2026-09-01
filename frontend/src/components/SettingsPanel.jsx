import React, { useState, useEffect, useRef } from 'react';
import { 
  fetchSystemSettings, 
  updateSystemSettings, 
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
  updateAutoScanSettings
} from '../api';

export default function SettingsPanel({ visible, onClose }) {
  const [activeTab, setActiveTab] = useState('providers');
  const [sources, setSources] = useState([]);
  const [newSourcePath, setNewSourcePath] = useState('');
  const [relocateForm, setRelocateForm] = useState({ old: '', new: '' });
  const [relocateResult, setRelocateResult] = useState(null);
  const [providers, setProviders] = useState([]);
  const [presets, setPresets] = useState({});
  const [quota, setQuota] = useState(null);
  const [cleanupPatterns, setCleanupPatterns] = useState([]);
  const [cleanupSuggestions, setCleanupSuggestions] = useState([]);
  const [newPattern, setNewPattern] = useState({ pattern: '', category: 'junk', is_regex: false });
  
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
  const [providerModels, setProviderModels] = useState({}); // { providerId: [models] }
  const [newProvider, setNewProvider] = useState({ name: '', provider: 'gemini', api_base: '', api_key: '', model: 'gemini-1.5-flash' });
  
  const [formError, setFormError] = useState(null);
  
  const quotaTimer = useRef(null);

  useEffect(() => {
    if (visible) {
      loadAll();
      if (activeTab === 'logs') loadLogs();
      quotaTimer.current = setInterval(loadQuota, 30000);
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
      const [provData, sourcesData, cleanupData, suggestionsData, autoScanData] = await Promise.all([
        fetchProviders(),
        fetchLibrarySources(),
        fetchCleanupPatterns(),
        fetchCleanupSuggestions(),
        fetchAutoScanSettings().catch(() => null)
      ]);
      setProviders(provData?.providers || []);
      setPresets(provData?.presets || {});
      setSources(sourcesData?.sources || []);
      setCleanupPatterns(cleanupData?.patterns || []);
      setCleanupSuggestions(suggestionsData?.suggestions || []);
      if (autoScanData) {
        setAutoScan(autoScanData);
      }
      loadQuota();
    } catch (err) {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

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
      loadAll();
    } catch (err) {
      setError('Failed to add source');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSource = async (id, enabled) => {
    try {
      await updateLibrarySource(id, { enabled });
      loadAll();
    } catch (err) {
      setError('Failed to update source');
    }
  };

  const handleDeleteSource = async (id) => {
    try {
      await deleteLibrarySource(id);
      loadAll();
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
      loadAll();
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

  if (!visible) return null;

  return (
    <div className="studio-card p-0 overflow-hidden animate-fade-in shadow-xl border-surface-4 ring-1 ring-black/10">
      {/* Tabs */}
      <div className="flex items-center justify-between bg-surface-2 border-b border-surface-4">
        <div className="flex">
          <button 
            onClick={() => setActiveTab('providers')}
            className={`px-5 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
              activeTab === 'providers' ? 'text-amber-400 border-b-2 border-amber-400 bg-surface-1' : 'text-ink-faint hover:text-ink-muted'
            }`}
          >
            AI Providers
          </button>
          <button 
            onClick={() => setActiveTab('cleanup')}
            className={`px-5 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
              activeTab === 'cleanup' ? 'text-amber-400 border-b-2 border-amber-400 bg-surface-1' : 'text-ink-faint hover:text-ink-muted'
            }`}
          >
            Cleanup Rules
          </button>
          <button 
            onClick={() => setActiveTab('system')}
            className={`px-5 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
              activeTab === 'system' ? 'text-amber-400 border-b-2 border-amber-400 bg-surface-1' : 'text-ink-faint hover:text-ink-muted'
            }`}
          >
            System Config
          </button>
          <button 
            onClick={() => setActiveTab('logs')}
            className={`px-5 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
              activeTab === 'logs' ? 'text-amber-400 border-b-2 border-amber-400 bg-surface-1' : 'text-ink-faint hover:text-ink-muted'
            }`}
          >
            System Logs
          </button>
        </div>
        <button 
          onClick={onClose} 
          className="p-3 text-ink-faint hover:text-ink-normal hover:bg-surface-3 transition-colors mr-1 rounded"
          title="Close Settings"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="p-5 max-h-[500px] overflow-y-auto">
        {activeTab === 'system' && (
          <div className="space-y-4 animate-scale-in">
            <div>
              <div className="flex items-center justify-between mb-4">
                <label className="block text-[11px] font-bold text-ink-muted uppercase tracking-wider">Library Sources</label>
                <div className="flex gap-2">
                   <input 
                      type="text"
                      value={newSourcePath}
                      onChange={(e) => setNewSourcePath(e.target.value)}
                      placeholder="Add absolute path..."
                      className="px-3 py-1.5 rounded bg-surface-0 border border-surface-4 text-xs text-ink-rich w-64 focus:border-amber-400/50 outline-none"
                    />
                    <button 
                      onClick={handleAddSource}
                      disabled={saving || !newSourcePath}
                      className="btn-primary !py-1 !px-3 text-[10px]"
                    >
                      Add
                    </button>
                </div>
              </div>
              
              <div className="space-y-2">
                {sources.map((source) => (
                  <div key={source.id} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${source.enabled ? 'bg-surface-0 border-surface-4' : 'bg-surface-2 border-surface-5 opacity-60'}`}>
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div 
                        onClick={() => handleToggleSource(source.id, !source.enabled)}
                        className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors duration-200 ${source.enabled ? 'bg-amber-400' : 'bg-surface-5'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-200 ${source.enabled ? 'left-5' : 'left-1'}`} />
                      </div>
                      <span className={`text-sm truncate font-medium ${source.enabled ? 'text-ink-rich' : 'text-ink-faint italic'}`}>
                        {source.path}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDeleteSource(source.id)}
                        className="p-1.5 text-fn-danger/50 hover:text-fn-danger hover:bg-fn-danger/10 rounded-md transition-all"
                        title="Remove Source"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
                {sources.length === 0 && (
                  <div className="py-12 text-center border-2 border-dashed border-surface-4 rounded-2xl opacity-30">
                    <p className="text-xs">No library sources configured.</p>
                  </div>
                )}
              </div>
              
              <p className="mt-6 text-[10px] text-ink-faint italic leading-relaxed">
                Enabled sources will be visible in the Library and History. <br/>
                Disabling a source hides its tracks without deleting any data.
              </p>

              {/* Automated Library Scanner Section */}
              <div className="mt-8 pt-6 border-t border-surface-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div className="flex flex-col">
                    <label className="block text-xs font-bold text-ink-rich uppercase tracking-wider flex items-center gap-2">
                      <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      Periodic Library Auto-Scan
                    </label>
                    <span className="text-[10px] text-ink-muted mt-0.5">
                      Automatically scan and sync music directories in the background on a schedule
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {autoScan.enabled && (
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 border border-amber-400/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
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

                <div className={`p-4 rounded-xl border transition-all ${autoScan.enabled ? 'bg-surface-2 border-amber-400/30 shadow-inner' : 'bg-surface-1/50 border-surface-4 opacity-75'}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-ink-normal font-bold uppercase tracking-wider mb-1.5">
                        Scan Frequency / Interval
                      </label>
                      <select
                        value={autoScan.interval}
                        disabled={!autoScan.enabled || autoScanSaving}
                        onChange={(e) => handleAutoScanIntervalChange(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-surface-0 border border-surface-4 text-xs text-ink-rich font-medium focus:border-amber-400/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
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
                            className="w-full px-3 py-2 rounded-lg bg-surface-0 border border-surface-4 text-xs font-mono text-ink-rich focus:border-amber-400/50 outline-none disabled:opacity-50"
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
                    <div className="mt-3 pt-3 border-t border-surface-4/60 flex items-center justify-between text-[10px] text-ink-muted">
                      <span>Last automated scan:</span>
                      <span className="font-mono text-ink-normal font-medium">{new Date(autoScan.last_scan).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Path Relocation Section — The Migration Matrix */}
              <div className="mt-8 pt-6 border-t border-surface-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col">
                    <label className="block text-[11px] font-bold text-ink-muted uppercase tracking-wider">Library Migration Matrix</label>
                    <span className="text-[9px] text-ink-faint uppercase font-bold mt-0.5">Move tracks between MacOS, Linux & Docker</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                     <span className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">Universal Healer</span>
                  </div>
                </div>
                
                <div className="p-4 rounded-xl bg-surface-2 border border-surface-4 space-y-5 shadow-inner">
                  <div className="space-y-3">
                    <label className="block text-[9px] text-ink-faint uppercase font-bold italic">Detected Source Bases (Click to use)</label>
                    <div className="flex flex-wrap gap-2">
                       {detectedBases.map(base => (
                         <div 
                           key={base}
                           onClick={() => setRelocateForm({...relocateForm, old: base})}
                           className="px-2.5 py-1.5 rounded-lg bg-surface-0 border border-surface-4 text-[10px] font-mono text-ink-normal hover:border-amber-400/50 hover:bg-surface-1 cursor-pointer transition-all flex items-center gap-2 group"
                         >
                           <svg className="w-3 h-3 text-ink-faint group-hover:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                           {base}
                         </div>
                       ))}
                       {detectedBases.length === 0 && <span className="text-[10px] text-ink-faint italic font-medium">No sources configured yet.</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] text-ink-muted font-bold uppercase tracking-tighter">Current Base Path</label>
                      <input 
                        type="text" 
                        placeholder="e.g. /Volumes/Media/Music"
                        value={relocateForm.old}
                        onChange={e => setRelocateForm({...relocateForm, old: e.target.value})}
                        className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs font-mono text-ink-rich focus:border-amber-400/50 hover:border-surface-6 outline-none shadow-sm transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] text-ink-muted font-bold uppercase tracking-tighter">New Base Path (Container)</label>
                      <input 
                        type="text" 
                        placeholder="/app/music"
                        value={relocateForm.new}
                        onChange={e => setRelocateForm({...relocateForm, new: e.target.value})}
                        className="w-full px-3 py-2.5 rounded-lg bg-surface-0 border border-surface-4 text-xs font-mono text-ink-rich focus:border-amber-400/50 hover:border-surface-6 outline-none shadow-sm transition-all"
                      />
                    </div>
                  </div>

                  {relocateResult && (
                    <div className="p-4 rounded-xl bg-fn-success/5 border border-fn-success/20 text-xs text-fn-success space-y-2 animate-scale-in">
                      <div className="flex items-center gap-2 font-black uppercase tracking-widest text-[10px]">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                        Migration Successful
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-[10px] font-bold">
                        <div className="p-2 rounded bg-fn-success/10 border border-fn-success/20">
                           <div className="text-fn-success/60 uppercase text-[9px]">Tracks Fixed</div>
                           <div className="text-lg">{relocateResult.tracks_updated}</div>
                        </div>
                        <div className="p-2 rounded bg-fn-success/10 border border-fn-success/20">
                           <div className="text-fn-success/60 uppercase text-[9px]">History Linked</div>
                           <div className="text-lg">{relocateResult.history_updated}</div>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-fn-success/80 bg-fn-success/5 p-2 rounded border border-fn-success/10 flex items-center justify-between">
                         <span>Sample Match Integrity:</span>
                         <span className="text-sm">{relocateResult.sample_match_percentage}%</span>
                      </div>
                    </div>
                  )}

                  {formError && activeTab === 'system' && !relocateResult && (
                    <div className="p-3 rounded-lg bg-fn-danger/10 border border-fn-danger/20 text-[10px] text-fn-danger font-bold flex items-center gap-2 animate-shake">
                       <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                       {formError}
                    </div>
                  )}

                  <div className="flex flex-col gap-3">
                    <p className="text-[9px] text-ink-faint leading-relaxed italic border-l-2 border-surface-4 pl-3 py-1">
                      <span className="text-amber-400 font-black uppercase mr-1">Pro Tip:</span>
                      Relocation updates purely the <strong>Metadata Mapping</strong>. 
                      Once relocated, your existing history snapshot will perfectly match your new files under the new path automatically.
                    </p>
                    <div className="flex justify-end gap-2">
                       <button 
                        onClick={handleRelocate}
                        disabled={saving || !relocateForm.old || !relocateForm.new}
                        className="btn-primary !py-2 !px-8 text-[11px] font-black uppercase tracking-widest shadow-lg shadow-amber-400/20 active:translate-y-0.5 transition-all"
                      >
                        {saving ? 'Engaging Matrix...' : 'Relocate Library'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cleanup' && (
          <div className="space-y-6 animate-scale-in">
            <div>
              <div className="flex items-center justify-between mb-4">
                <label className="block text-[11px] font-bold text-ink-muted uppercase tracking-wider">Add Cleanup Rule</label>
              </div>
              
              <div className="p-4 rounded-xl bg-surface-2 border border-surface-4 space-y-4">
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={newPattern.pattern}
                      onChange={(e) => setNewPattern({...newPattern, pattern: e.target.value})}
                      placeholder="e.g. www.site.com or (Original Soundtrack)"
                      className="flex-1 px-3 py-2 rounded bg-surface-0 border border-surface-4 text-xs text-ink-rich focus:border-amber-400/50 outline-none font-mono"
                    />
                    <select
                      value={newPattern.category}
                      onChange={(e) => setNewPattern({...newPattern, category: e.target.value})}
                      className="px-2 py-1 rounded bg-surface-0 border border-surface-4 text-[10px] font-bold uppercase text-ink-muted"
                    >
                      <option value="junk">Promotional Junk</option>
                      <option value="soundtrack">Soundtrack Marker</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        checked={newPattern.is_regex}
                        onChange={(e) => setNewPattern({...newPattern, is_regex: e.target.checked})}
                        className="w-3 h-3 accent-amber-400"
                      />
                      <span className="text-[10px] text-ink-faint group-hover:text-ink-muted transition-colors uppercase font-bold tracking-widest">Treat as Regular Expression</span>
                    </label>
                    <button 
                      onClick={handleAddCleanupPattern}
                      disabled={saving || !newPattern.pattern}
                      className="btn-primary !py-1.5 !px-5 text-[10px]"
                    >
                      Add Rule
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {cleanupSuggestions.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    Junk Discovery Candidates ({cleanupSuggestions.length})
                  </label>
                  <span className="text-[10px] text-ink-faint italic font-medium">Found during recent library scan</span>
                </div>
                
                <div className="grid grid-cols-1 gap-3">
                  {cleanupSuggestions.map((s) => (
                    <div key={s.id} className="p-4 rounded-xl bg-amber-400/5 border border-amber-400/20 shadow-sm animate-pulse-subtle group">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-amber-400 truncate">{s.pattern}</span>
                            <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-500 text-[10px] font-black uppercase">
                              {s.frequency} Tracks
                            </span>
                          </div>
                          {s.sample_value && (
                            <div className="text-[10px] text-ink-muted italic bg-surface-0/50 p-2 rounded border border-surface-4 truncate">
                              "{s.sample_value}"
                            </div>
                          )}
                          <div className="text-[9px] text-ink-faint uppercase font-bold tracking-tighter">
                            Found in: <span className="text-amber-400/80">{s.source_field || 'unknown'}</span> field
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button 
                            onClick={() => handleAcceptSuggestion(s.id)}
                            className="px-3 py-1.5 rounded bg-amber-400 text-surface-0 text-[10px] font-black uppercase hover:bg-amber-500 transition-all shadow-sm"
                          >
                            Approve
                          </button>
                          <button 
                            onClick={() => handleDismissSuggestion(s.id)}
                            className="px-3 py-1.5 rounded bg-surface-3 text-ink-muted text-[10px] font-bold uppercase hover:bg-surface-4 transition-all"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <label className="block text-[11px] font-bold text-ink-muted uppercase tracking-wider">Existing Rules ({cleanupPatterns.length})</label>
              <div className="grid grid-cols-1 gap-2">
                {cleanupPatterns.map((p) => (
                  <div key={p.id} className="group flex items-center justify-between p-2.5 rounded-lg bg-surface-0 border border-surface-4 hover:border-surface-6 transition-all">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className={`shrink-0 w-2 h-2 rounded-full ${p.category === 'soundtrack' ? 'bg-amber-400' : 'bg-fn-danger/50'}`} title={p.category} />
                      <div className="flex flex-col overflow-hidden">
                         <span className="text-xs font-mono text-ink-rich truncate">{p.pattern}</span>
                         <span className="text-[8px] uppercase tracking-tighter text-ink-faint">{p.category} {p.is_regex ? '• REGEX' : ''}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteCleanupPattern(p.id)}
                      className="p-1.5 text-ink-faint hover:text-fn-danger hover:bg-fn-danger/10 rounded-md transition-all opacity-0 group-hover:opacity-100"
                      title="Remove Rule"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-ink-faint italic leading-relaxed bg-surface-1 p-3 rounded-lg border border-surface-4">
              <span className="text-amber-400 font-bold uppercase mr-1">Tagger Pro Tip:</span>
              Rules are applied locally before AI processing and as a final forensic pass. 
              Patterns are case-insensitive. Use Regex for complex matches like URLs or specific brackets.
            </p>
          </div>
        )}

        {activeTab === 'providers' && (
          <div className="space-y-5 animate-scale-in">
            {/* Quota Glance */}
            {quota && quota.provider_name && (
              <div className="px-4 py-3 rounded-lg bg-surface-3 border border-surface-4 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-ink-faint uppercase font-bold tracking-tighter">Current Provider</div>
                  <div className="text-sm font-bold text-ink-normal">{quota.provider_name}</div>
                </div>
                {quota.remaining_requests !== null && (
                  <div className="text-right">
                    <div className="text-[10px] text-ink-faint uppercase font-bold tracking-tighter">RPM Remaining</div>
                    <div className={`text-sm font-mono font-bold ${quota.remaining_requests < 10 ? 'text-fn-danger' : 'text-fn-success'}`}>
                      {quota.remaining_requests}
                    </div>
                  </div>
                )}
                {quota.retry_after_seconds && !quota.daily_limit_reached && (
                  <div className="px-3 py-1 bg-fn-danger/10 border border-fn-danger/20 rounded text-[10px] text-fn-danger font-bold animate-pulse">
                    RATE LIMITED: {Math.ceil(quota.retry_after_seconds)}s
                  </div>
                )}
                {quota.daily_limit_reached && (
                  <div className="px-3 py-1 bg-fn-danger/20 border border-fn-danger/40 rounded text-[10px] text-fn-danger font-black animate-pulse">
                    DAILY LIMIT REACHED
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">AI Engines</h4>
              <button 
                onClick={() => setShowAddForm(!showAddForm)}
                className="btn-ghost !py-1 !px-2 text-[10px]"
              >
                {showAddForm ? 'Cancel' : '+ Add Provider'}
              </button>
            </div>

            {showAddForm && (
              <div className="p-4 rounded-xl bg-surface-2 border border-amber-400/20 space-y-3 shadow-inner">
                {formError && (
                  <div className="px-3 py-2 rounded bg-fn-danger/10 border border-fn-danger/20 text-[10px] text-fn-danger font-bold animate-shake">
                    {formError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] text-ink-faint uppercase mb-1">Engine Name</label>
                    <input 
                      type="text" placeholder="Work AI"
                      value={newProvider.name}
                      onChange={e => { setNewProvider({...newProvider, name: e.target.value}); setFormError(null); }}
                      className="w-full px-3 py-2 rounded bg-surface-0 border border-surface-4 text-xs focus:border-amber-400/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] text-ink-faint uppercase mb-1">Type</label>
                    <select 
                      value={newProvider.provider}
                      onChange={e => handleProviderTypeChange(e.target.value)}
                      className="w-full px-3 py-2 rounded bg-surface-0 border border-surface-4 text-xs"
                    >
                      {Object.keys(presets).map(p => <option key={p} value={p}>{presets[p].label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[9px] text-ink-faint uppercase mb-1">API Base URL</label>
                  <input 
                    type="text" placeholder="https://..."
                    value={newProvider.api_base}
                    onChange={e => setNewProvider({...newProvider, api_base: e.target.value})}
                    className="w-full px-3 py-2 rounded bg-surface-0 border border-surface-4 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-ink-faint uppercase mb-1">API Key</label>
                  <input 
                    type="password" placeholder="sk-..."
                    value={newProvider.api_key}
                    onChange={e => setNewProvider({...newProvider, api_key: e.target.value})}
                    className="w-full px-3 py-2 rounded bg-surface-0 border border-surface-4 text-xs font-mono"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={handleAddProvider} disabled={saving} className="btn-primary !py-1.5 !px-4 text-[11px]">Save Engine</button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {providers.map(p => (
                <div key={p.id} className={`p-4 rounded-xl border transition-all ${p.is_active ? 'bg-surface-1 border-amber-400/40 shadow-md ring-1 ring-amber-400/10' : 'bg-surface-0 border-surface-4 hover:border-surface-6'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg ${p.is_active ? 'bg-amber-400/10 text-amber-400' : 'bg-surface-3 text-ink-faint'}`}>
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-ink-rich">{p.name}</div>
                        <div className="text-[10px] text-ink-faint font-mono">{presets[p.provider]?.label || p.provider}</div>
                      </div>
                    </div>
                    {p.is_active ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-500 text-[9px] font-black uppercase tracking-widest">Active</span>
                    ) : (
                      <button onClick={() => handleActivate(p.id)} className="text-[10px] font-bold text-amber-400/80 hover:text-amber-400 transition-colors">Activate</button>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-surface-4 mt-2">
                     <div className="text-[10px] text-ink-muted flex-1 flex flex-wrap items-center gap-y-1">
                        <span className="mr-1">Key:</span>
                        {editingKeyId === p.id ? (
                          <div className="flex items-center gap-1 mr-3">
                            <input 
                              type="password"
                              placeholder="New API Key..."
                              autoFocus
                              className="bg-surface-2 border border-amber-400/50 rounded px-2 py-0.5 text-[10px] font-mono outline-none w-32"
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
                              className="text-[10px] px-2 py-0.5 rounded bg-fn-success/10 text-fn-success border border-fn-success/30 hover:bg-fn-success/20 transition-colors shrink-0"
                            >
                              Save
                            </button>
                            <button 
                              onClick={() => setEditingKeyId(null)}
                              className="text-[10px] px-1 py-0.5 text-ink-muted hover:text-ink-normal transition-colors shrink-0"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <span 
                            onClick={() => setEditingKeyId(p.id)}
                            className="text-fn-success mr-3 cursor-pointer hover:text-amber-400 underline decoration-dotted underline-offset-2"
                            title="Click to edit API Key"
                          >
                            Set ✓
                          </span>
                        )}
                        <span className="mr-1">Model:</span> {editingId === p.id ? (
                          <div className="inline-flex gap-1 mt-1 w-full max-w-[280px]">
                            {providerModels[p.id] ? (
                              <select
                                autoFocus
                                className="flex-1 bg-surface-2 border border-amber-400/50 rounded px-2 py-0.5 text-[10px] font-mono outline-none"
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
                                  className="flex-1 bg-surface-2 border border-amber-400/50 rounded px-2 py-0.5 text-[10px] font-mono outline-none"
                                />
                                <button 
                                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleRefreshModels(p.id); }}
                                  disabled={fetchingModelsId === p.id}
                                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                                    fetchingModelsId === p.id 
                                    ? 'bg-surface-3 text-ink-muted border-surface-4' 
                                    : 'bg-amber-400/10 text-amber-400 border-amber-400/30 hover:bg-amber-400/20'
                                  }`}
                                >
                                  {fetchingModelsId === p.id ? '...' : 'Fetch'}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span 
                            onClick={() => setEditingId(p.id)}
                            className="font-mono hover:text-amber-400 cursor-pointer underline decoration-dotted underline-offset-2 ml-1"
                          >
                            {p.model || 'Default'}
                          </span>
                        )}
                     </div>
                     {deleteConfirmId === p.id ? (
                        <div className="flex gap-2 items-center">
                          <span className="text-[10px] text-fn-danger font-bold">Really delete?</span>
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(p.id); setDeleteConfirmId(null); }} className="text-[10px] font-bold text-white bg-fn-danger px-1.5 py-0.5 rounded hover:bg-red-600 transition-colors">Yes</button>
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteConfirmId(null); }} className="text-[10px] font-bold text-ink-muted hover:text-ink-normal px-1.5 py-0.5 transition-colors">No</button>
                        </div>
                     ) : (
                       <button 
                         onClick={(e) => {
                           e.preventDefault();
                           e.stopPropagation();
                           setDeleteConfirmId(p.id);
                         }} 
                         className="text-[10px] text-fn-danger/70 hover:text-fn-danger font-bold underline underline-offset-4 decoration-fn-danger/20"
                       >
                         Delete
                       </button>
                     )}
                  </div>
                </div>
              ))}
              {providers.length === 0 && !loading && (
                <div className="text-center py-10 opacity-40 grayscale">
                  <p className="text-xs">No providers configured yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-4 animate-scale-in">
            {/* Header & Controls */}
            <div className="p-4 rounded-xl bg-surface-2 border border-surface-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-bold text-ink-rich uppercase tracking-wider flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  System & Application Logs
                </h4>
                <p className="text-[10px] text-ink-faint mt-0.5">
                  Track forensic errors, API calls, and background worker executions in real-time.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {/* Debug Logging Toggle */}
                <button
                  onClick={handleToggleDebug}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border ${
                    logLevel === 'DEBUG'
                      ? 'bg-amber-400/10 text-amber-400 border-amber-400/40 shadow-sm'
                      : 'bg-surface-1 text-ink-muted border-surface-4 hover:border-surface-6'
                  }`}
                  title="Toggle Verbose Debug Logging"
                >
                  <div className={`w-2 h-2 rounded-full ${logLevel === 'DEBUG' ? 'bg-amber-400 animate-ping' : 'bg-ink-faint'}`} />
                  Debug Mode: {logLevel === 'DEBUG' ? 'ON' : 'OFF'}
                </button>

                {/* Direct Download Log File */}
                <a
                  href={getLogsDownloadUrl()}
                  download
                  className="btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5 text-black font-bold"
                  title="Download full log file to your device"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download Log File
                </a>

                {/* Refresh Logs */}
                <button
                  onClick={loadLogs}
                  disabled={logsLoading}
                  className="p-1.5 rounded-lg bg-surface-1 border border-surface-4 text-ink-muted hover:text-ink-rich hover:bg-surface-3 transition-colors"
                  title="Refresh Log View"
                >
                  <svg className={`w-4 h-4 ${logsLoading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>

                {/* Clear Logs */}
                <button
                  onClick={handleClearLogs}
                  className="p-1.5 rounded-lg bg-surface-1 border border-surface-4 text-fn-danger/70 hover:text-fn-danger hover:bg-fn-danger/10 transition-colors"
                  title="Clear Log File"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Terminal Log Console */}
            <div className="p-4 rounded-xl bg-black/90 border border-surface-4 font-mono text-[11px] leading-relaxed text-zinc-300 max-h-[350px] overflow-y-auto shadow-inner space-y-1 select-text">
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
                <div className="py-12 text-center text-zinc-500 italic">
                  No log entries recorded yet. System log is clean.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
