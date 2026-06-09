
import { useState, useCallback, useEffect } from 'react';
import { startFix, subscribeToProgress, fetchActiveFixJobs, abortFix } from '../api';

export function useFixer() {
    const [isFixing, setIsFixing] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [progress, setProgress] = useState([]);
    const [totalTracks, setTotalTracks] = useState(0);
    const [error, setError] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [jobStartTime, setJobStartTime] = useState(null);
    const [isAborting, setIsAborting] = useState(false);

    const dismiss = useCallback(() => {
        setIsVisible(false);
        setIsFixing(false);
        setIsAborting(false);
        setJobId(null);
        setProgress([]);
        setError(null);
    }, []);

    const attachToJob = useCallback((job_id, trackCount, onComplete) => {
        setJobId(job_id);
        if (trackCount) setTotalTracks(trackCount);
        setIsFixing(true);
        setIsVisible(true);

        return subscribeToProgress(
            job_id,
            (event) => {
                const now = Date.now();
                if (!event.track_id) return; // Skip non-track events (like 'done: true' signals)

                setProgress(prev => {
                    const existing = prev.findIndex(p => p.track_id === event.track_id);
                    if (existing >= 0) {
                        const updated = [...prev];
                        const oldDurations = updated[existing].stageDurations || {};
                        const newDurations = event.status === 'done' ? { ...oldDurations, [event.step]: event.duration } : oldDurations;
                        updated[existing] = { ...updated[existing], ...event, stageDurations: newDurations, updated_at: now };
                        return updated;
                    }
                    const initialDurations = event.status === 'done' ? { [event.step]: event.duration } : {};
                    return [...prev, { ...event, stageDurations: initialDurations, updated_at: now }];
                });
            },
            () => {
                setIsFixing(false);
                setIsAborting(false);
                setJobId(null);
                if (onComplete) onComplete();
            },
        );
    }, []);

    const fix = useCallback(async (trackIds, options = {}, onComplete) => {
        if (typeof options === 'function') {
            onComplete = options;
            options = {};
        }

        // Check if we already have an active job. 
        // If so, we'll append to it instead of starting a new one.
        const currentJobId = jobId;
        const fixOptions = currentJobId ? { ...options, job_id: currentJobId } : options;

        setIsFixing(true);
        setIsVisible(true);
        setError(null);

        // Only clear progress if it's a completely NEW job
        if (!currentJobId) {
            setProgress([]);
            setJobStartTime(Date.now());
        }

        try {
            const result = await startFix(trackIds, fixOptions);
            const { job_id, track_count, appended } = result;
            
            setTotalTracks(track_count);
            
            if (!appended) {
                setJobStartTime(Date.now());
                attachToJob(job_id, track_count, onComplete);
            }
            return result; // Return for the caller to handle immediate feedback
        } catch (err) {
            console.error('Fixer failed:', err);
            const msg = err.response?.data?.detail || err.message || 'Operation failed';
            setError(Array.isArray(msg) ? msg[0].msg : msg);
            if (!currentJobId) setIsFixing(false);
            throw err;
        }
    }, [jobId, attachToJob]);

    // Re-attach to active jobs on mount
    useEffect(() => {
        let cleanup = null;
        const checkActive = async () => {
            try {
                const { jobs } = await fetchActiveFixJobs();
                if (jobs && jobs.length > 0) {
                    // Attach to the first active job found
                    cleanup = attachToJob(jobs[0].job_id, jobs[0].track_count);
                }
            } catch (err) {
                console.warn('Could not fetch active jobs:', err);
            }
        };
        checkActive();
        return () => { if (cleanup) cleanup(); };
    }, [attachToJob]);

    const abort = useCallback(async () => {
        if (!jobId || isAborting) return;
        setIsAborting(true);
        try {
            await abortFix(jobId);
        } catch (err) {
            console.error('Abort failed:', err);
            setIsAborting(false);
        }
    }, [jobId, isAborting]);

    return { isFixing, isAborting, isVisible, progress, totalTracks, error, jobId, jobStartTime, fix, dismiss, abort };
}
