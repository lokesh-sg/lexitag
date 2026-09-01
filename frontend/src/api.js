/**
 * LexiTag API client — wraps all backend calls.
 */
import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
    timeout: 30000,
});

export async function fetchHealth() {
    const { data } = await api.get('/health');
    return data;
}

// Attach Auth Token if present
api.interceptors.request.use(config => {
    const token = import.meta.env.VITE_LEXITAG_AUTH_TOKEN || window.LEXITAG_TOKEN;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ── Tracks ──

export async function scanLibrary() {
    const { data } = await api.post('/tracks/scan');
    return data;
}

export async function fetchActiveScanJobs() {
    const { data } = await api.get('/tracks/active');
    return data;
}

export async function refreshStatus() {
    const { data } = await api.post('/tracks/refresh-status');
    return data;
}

export async function fetchTracks({ page = 1, pageSize = 50, search = '', searchField = 'all', filter = '', sortBy = 'title', sortDir = 'asc' } = {}) {
    const { data } = await api.get('/tracks', {
        params: { 
            page, 
            page_size: pageSize, 
            search, 
            search_field: searchField,
            filter, 
            sort_by: sortBy, 
            sort_dir: sortDir 
        },
    });
    return data;
}

export async function fetchTrack(trackId) {
    const { data } = await api.get(`/tracks/${trackId}`);
    return data;
}

export async function fetchRawTags(trackId) {
    const { data } = await api.get(`/tracks/${trackId}/raw`);
    return data;
}

export async function updateTracks(trackIds, tags, lyrics = null, language = null, raw_tags = null, new_path = null) {
    const { data } = await api.post('/tracks/update', {
        track_ids: trackIds,
        tags,
        lyrics,
        language,
        raw_tags,
        new_path,
    });
    return data;
}

export async function localFixTracks(trackIds) {
    const { data } = await api.post('/tracks/local-fix', {
        track_ids: trackIds,
    });
    return data;
}

// ── Fixer ──

export async function startFix(trackIds, options = {}) {
    const { data } = await api.post('/fixer/fix', { 
        track_ids: trackIds,
        ...options 
    });
    return data;
}

export async function abortFix(jobId) {
    const { data } = await api.post(`/fixer/abort/${jobId}`);
    return data;
}

export async function fetchActiveFixJobs() {
    const { data } = await api.get('/fixer/active');
    return data;
}

export function subscribeToProgress(jobId, onEvent, onDone) {
    const token = import.meta.env.VITE_LEXITAG_AUTH_TOKEN || window.LEXITAG_TOKEN;
    const url = `/api/fixer/progress/${jobId}${token ? `?token=${token}` : ''}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        // Always pass event to handler if it contains progress/status info
        if (onEvent) onEvent(data);
        
        if (data.done) {
            eventSource.close();
            if (onDone) onDone();
        }
    };

    eventSource.onerror = () => {
        eventSource.close();
        if (onDone) onDone();
    };

    return () => eventSource.close();
}

// ── History ──

export async function fetchHistory({ page = 1, pageSize = 50, trackId = null, search = '' } = {}) {
    const { data } = await api.get('/history', {
        params: { page, page_size: pageSize, track_id: trackId, search },
    });
    return data;
}

export async function revertChange(historyId) {
    const { data } = await api.post(`/history/${historyId}/revert`);
    return data;
}

export async function revertBatch(batchId) {
    const { data } = await api.post(`/history/batch/${batchId}/revert`);
    return data;
}

export async function bulkRevert(historyIds) {
    const { data } = await api.post('/history/bulk-revert', { history_ids: historyIds });
    return data;
}

// ── Player / UPnP ──

export function getStreamUrl(trackId) {
    return `/api/player/stream/${trackId}`;
}

export async function fetchRenderers() {
    const { data } = await api.get('/player/upnp/renderers');
    return data.renderers || [];
}

export async function castToRenderer(rendererUdn, trackId) {
    const { data } = await api.post('/player/upnp/play', {
        renderer_udn: rendererUdn,
        track_id: trackId,
    });
    return data;
}

export async function pauseRenderer(rendererUdn) {
    const { data } = await api.post('/player/upnp/pause', null, {
        params: { renderer_udn: rendererUdn },
    });
    return data;
}

export async function resumeRenderer(rendererUdn) {
    const { data } = await api.post('/player/upnp/resume', null, {
        params: { renderer_udn: rendererUdn },
    });
    return data;
}

export async function setRendererVolume(rendererUdn, volume) {
    const { data } = await api.post('/player/upnp/volume', null, {
        params: { renderer_udn: rendererUdn, volume: volume },
    });
    return data;
}

export async function stopRenderer(rendererUdn) {
    const { data } = await api.post('/player/upnp/stop', null, {
        params: { renderer_udn: rendererUdn },
    });
    return data;
}

export async function seekRenderer(rendererUdn, seconds) {
    const { data } = await api.post('/player/upnp/seek', null, {
        params: { renderer_udn: rendererUdn, seconds: seconds },
    });
    return data;
}

// ── Settings ──

export async function fetchSystemSettings() {
    const { data } = await api.get('/settings/system');
    return data;
}

export async function updateSystemSettings(settings) {
    const { data } = await api.post('/settings/system', settings);
    return data;
}

export async function fetchLibrarySources() {
    const { data } = await api.get('/settings/sources');
    return data;
}

export async function createLibrarySource(path) {
    const { data } = await api.post('/settings/sources', { path });
    return data;
}

export async function updateLibrarySource(id, updates) {
    const { data } = await api.patch(`/settings/sources/${id}`, updates);
    return data;
}

export async function deleteLibrarySource(id) {
    const { data } = await api.delete(`/settings/sources/${id}`);
    return data;
}

export async function relocateLibrary(oldBasePath, newBasePath) {
    const { data } = await api.post('/settings/sources/relocate', { 
        old_base_path: oldBasePath, 
        new_base_path: newBasePath 
    });
    return data;
}

export async function fetchProviders() {
    const { data } = await api.get('/settings/llm/providers');
    return data;
}

export async function createProvider(provider) {
    const { data } = await api.post('/settings/llm/providers', provider);
    return data;
}

export async function updateProvider(id, updates) {
    const { data } = await api.put(`/settings/llm/providers/${id}`, updates);
    return data;
}

export async function deleteProvider(id) {
    const { data } = await api.delete(`/settings/llm/providers/${id}`);
    return data;
}

export async function activateProvider(id) {
    const { data } = await api.post(`/settings/llm/providers/${id}/activate`);
    return data;
}

export async function fetchProviderModels(id) {
    const { data } = await api.get(`/settings/llm/providers/${id}/models`);
    return data;
}
export const fetchModels = fetchProviderModels;

export async function fetchQuota() {
    const { data } = await api.get('/settings/llm/quota');
    return data;
}
export const getQuota = fetchQuota;

// ── Cleanup Patterns ──

export async function fetchCleanupPatterns() {
    const { data } = await api.get('/settings/cleanup-patterns');
    return data;
}

export async function addCleanupPattern(pattern, category = 'junk', isRegex = false) {
    const { data } = await api.post('/settings/cleanup-patterns', { pattern, category, is_regex: isRegex });
    return data;
}

export const deleteCleanupPattern = async (id) => {
  const response = await api.delete(`/settings/cleanup-patterns/${id}`);
  return response.data;
};

export const fetchCleanupSuggestions = async () => {
  const response = await api.get('/settings/cleanup-suggestions');
  return response.data;
};

export const acceptCleanupSuggestion = async (id) => {
  const response = await api.post(`/settings/cleanup-suggestions/${id}/accept`);
  return response.data;
};

export const dismissCleanupSuggestion = async (id) => {
  const response = await api.post(`/settings/cleanup-suggestions/${id}/dismiss`);
  return response.data;
};

// ── System Logs ──

export async function fetchSystemLogs(lines = 500) {
    const { data } = await api.get('/settings/logs/view', { params: { lines } });
    return data;
}

export async function toggleDebugLogging(enabled) {
    const { data } = await api.post('/settings/logs/toggle', null, { params: { enabled } });
    return data;
}

export async function clearSystemLogs() {
    const { data } = await api.post('/settings/logs/clear');
    return data;
}

export function getLogsDownloadUrl() {
    return '/api/settings/logs/download';
}

// ── Automated Library Scanner ──

export async function fetchAutoScanSettings() {
    const { data } = await api.get('/settings/auto-scan');
    return data;
}

export async function updateAutoScanSettings(config) {
    const { data } = await api.post('/settings/auto-scan', config);
    return data;
}

export default api;
