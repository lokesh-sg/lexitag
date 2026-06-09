
import { useState, useCallback, useEffect } from 'react';
import { fetchTracks, scanLibrary, fetchActiveScanJobs } from '../api';

export function useTracks() {
    const [tracks, setTracks] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [search, setSearch] = useState('');
    const [searchField, setSearchField] = useState('all');
    const [filter, setFilter] = useState('');
    const [sortBy, setSortBy] = useState('title');
    const [sortDir, setSortDir] = useState('asc');
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(null); // { current: N, total: M, filename: '...' }

    const loadTracks = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchTracks({ page, pageSize, search, searchField, filter, sortBy, sortDir });
            setTracks(data.tracks || []);
            setTotal(data.total || 0);
        } catch (err) {
            console.error('Failed to load tracks:', err);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, search, searchField, filter, sortBy, sortDir]);

    const _subscribeToScanProgress = useCallback((jobId, onComplete) => {
        const eventSource = new EventSource(`/api/tracks/scan/progress/${jobId}`);
        let lastRefresh = Date.now();

        setScanning(true);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.done) {
                eventSource.close();
                setScanning(false);
                setScanProgress(null);
                loadTracks();
                if (onComplete) onComplete({ success: true });
            } else {
                setScanProgress(data);
                
                // Real-time update: reload tracks every 5 seconds during scan
                if (Date.now() - lastRefresh > 5000) {
                    loadTracks();
                    lastRefresh = Date.now();
                }
            }
        };

        eventSource.onerror = (err) => {
            console.error('[useTracks] SSE Error:', err);
            eventSource.close();
            setScanning(false);
            setScanProgress(null);
        };

        return () => eventSource.close();
    }, [loadTracks]);

    const scan = useCallback(async () => {
        setScanning(true);
        setScanProgress({ current: 0, total: 100, filename: 'Initializing...' });
        
        try {
            const { job_id } = await scanLibrary();
            return new Promise((resolve) => _subscribeToScanProgress(job_id, resolve));
        } catch (err) {
            console.error('Scan initiation failed:', err);
            setScanning(false);
            setScanProgress(null);
            throw err;
        }
    }, [_subscribeToScanProgress]);

    const refresh = useCallback(async () => {
        const { refreshStatus } = await import('../api');
        setScanning(true);
        setScanProgress({ current: 0, total: 100, filename: 'Querying DB...', type: 'refresh' });
        
        try {
            const { job_id } = await refreshStatus();
            return new Promise((resolve) => _subscribeToScanProgress(job_id, resolve));
        } catch (err) {
            console.error('Refresh initiation failed:', err);
            setScanning(false);
            setScanProgress(null);
            throw err;
        }
    }, [_subscribeToScanProgress]);

    const handleSort = useCallback((field) => {
        setSortBy(prev => {
            if (prev === field) {
                setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                return field;
            }
            // For dates and counts, default to DESC (most recent/highest first)
            const descFields = ['last_fixed_at', 'last_scanned', 'local_fix_count', 'llm_fix_count', 'year'];
            setSortDir(descFields.includes(field) ? 'desc' : 'asc');
            return field;
        });
    }, []);

    // Re-attach to active scans on mount
    useEffect(() => {
        let cleanup = null;
        const checkActive = async () => {
            try {
                const { jobs } = await fetchActiveScanJobs();
                if (jobs && jobs.length > 0) {
                    cleanup = _subscribeToScanProgress(jobs[0].job_id);
                }
            } catch (err) {
                console.warn('Could not fetch active scan jobs:', err);
            }
        };
        checkActive();
        return () => { if (cleanup) cleanup(); };
    }, [_subscribeToScanProgress]);

    useEffect(() => {
        loadTracks();
    }, [loadTracks]);

    return {
        tracks, total, page, setPage, pageSize, setPageSize,
        search, setSearch, searchField, setSearchField, filter, setFilter,
        sortBy, sortDir, handleSort,
        loading, scanning, scanProgress, scan, refresh, reload: loadTracks,
    };
}
