import { useState, useRef, useCallback, useEffect } from 'react';
import { 
    getStreamUrl, 
    castToRenderer, 
    pauseRenderer, 
    resumeRenderer, 
    stopRenderer,
    setRendererVolume,
    seekRenderer
} from '../api';

export function usePlayer() {
    const audioRef = useRef(null);
    const [currentTrack, setCurrentTrack] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    
    // --- Cast State ---
    const [isCasting, setIsCasting] = useState(false);
    const [activeRenderer, setActiveRenderer] = useState(null);
    
    // --- Advanced Player State ---
    const [queue, setQueue] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [repeatMode, setRepeatMode] = useState('none'); // 'none', 'one', 'all'
    const [shuffleMode, setShuffleMode] = useState(false);
    const [shuffledQueue, setShuffledQueue] = useState([]);

    useEffect(() => {
        const audio = new Audio();
        audio.volume = volume;
        audioRef.current = audio;

        const onTimeUpdate = () => setCurrentTime(audio.currentTime);
        const onDurationChange = () => setDuration(audio.duration || 0);
        const onEnded = () => handleTrackEnded(); // Updated to handle progression
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);

        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('durationchange', onDurationChange);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);

        return () => {
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('durationchange', onDurationChange);
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.pause();
            audio.src = '';
        };
    }, []);

    // Helper to get effective queue
    const getActiveQueue = useCallback(() => (shuffleMode ? shuffledQueue : queue), [shuffleMode, shuffledQueue, queue]);

    const playTrack = useCallback(async (track, newQueue = null, index = -1) => {
        const audio = audioRef.current;
        if (!audio) return;

        // If casting, trigger remote play instead of local
        if (isCasting && activeRenderer) {
            try {
                setCurrentTrack(track);
                await castToRenderer(activeRenderer.udn, track.id);
                setIsPlaying(true);
                return;
            } catch (err) { console.error('Casting play error:', err); }
        }

        // --- Standard Local Play Logic ---
        if (newQueue) {
            setQueue(newQueue);
            if (shuffleMode) {
                const shuffled = [...newQueue].sort(() => Math.random() - 0.5);
                setShuffledQueue(shuffled);
                const idx = shuffled.findIndex(t => t.id === track.id);
                setCurrentIndex(idx);
            } else {
                const idx = index !== -1 ? index : newQueue.findIndex(t => t.id === track.id);
                setCurrentIndex(idx);
            }
        }

        if (currentTrack?.id === track.id && audio.src) {
            if (isPlaying) audio.pause();
            else audio.play().catch(e => console.error(e));
            return;
        }

        setCurrentTrack(track);
        audio.src = getStreamUrl(track.id);
        audio.play().catch(err => console.error('Playback error:', err));
    }, [currentTrack, isPlaying, shuffleMode, isCasting, activeRenderer]);

    // Play next track logic
    const next = useCallback(() => {
        const activeQueue = getActiveQueue();
        if (activeQueue.length === 0) return;

        let nextIdx = currentIndex + 1;
        if (nextIdx >= activeQueue.length) {
            if (repeatMode === 'all') nextIdx = 0;
            else return; // Stop at end
        }
        playTrack(activeQueue[nextIdx], activeQueue, nextIdx);
    }, [currentIndex, repeatMode, shuffleMode, queue, shuffledQueue, playTrack]);

    // Play previous track logic
    const prev = useCallback(() => {
        const activeQueue = getActiveQueue();
        if (activeQueue.length === 0) return;

        // If we've played > 3s, just restart the track
        if (audioRef.current && audioRef.current.currentTime > 3) {
            audioRef.current.currentTime = 0;
            return;
        }

        let prevIdx = currentIndex - 1;
        if (prevIdx < 0) {
            if (repeatMode === 'all') prevIdx = activeQueue.length - 1;
            else prevIdx = 0;
        }
        playTrack(activeQueue[prevIdx], activeQueue, prevIdx);
    }, [currentIndex, repeatMode, shuffleMode, queue, shuffledQueue, playTrack]);

    const stop = useCallback(async () => {
        if (isCasting && activeRenderer) {
            try {
                await stopRenderer(activeRenderer.udn);
                setIsPlaying(false);
                setIsCasting(false);
            } catch (e) { console.error('UPnP Stop error:', e); }
            return;
        }

        const audio = audioRef.current;
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            setIsPlaying(false);
        }
    }, [isCasting, activeRenderer]);

    const handleTrackEnded = useCallback(() => {
        if (repeatMode === 'one') {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play();
            }
        } else {
            next();
        }
    }, [repeatMode, next]);

    const startCast = useCallback(async (renderer) => {
        if (!currentTrack) return;
        try {
            // 1. Set state
            setIsCasting(true);
            setActiveRenderer(renderer);

            // 2. Silence local audio instantly
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.src = "";
            }

            // 3. Trigger remote play
            await castToRenderer(renderer.udn, currentTrack.id);
            setIsPlaying(true);
        } catch (err) {
            console.error('Cast Error:', err);
            setIsCasting(false);
        }
    }, [currentTrack]);

    const stopCast = useCallback(async () => {
        if (activeRenderer) {
            try {
                await stopRenderer(activeRenderer.udn);
            } catch (e) { console.error('UPnP Stop error:', e); }
        }
        setIsCasting(false);
        setActiveRenderer(null);
        
        // Resume locally if track exists
        if (currentTrack && audioRef.current) {
            audioRef.current.src = getStreamUrl(currentTrack.id);
            audioRef.current.play().catch(() => {});
            setIsPlaying(true);
        }
    }, [activeRenderer, currentTrack]);

    const setShuffle = useCallback((mode) => {
        setShuffleMode(mode);
        if (mode && queue.length > 0) {
            const shuffled = [...queue].sort(() => Math.random() - 0.5);
            setShuffledQueue(shuffled);
            if (currentTrack) {
                setCurrentIndex(shuffled.findIndex(t => t.id === currentTrack.id));
            }
        } else if (!mode && queue.length > 0) {
            if (currentTrack) {
                setCurrentIndex(queue.findIndex(t => t.id === currentTrack.id));
            }
        }
    }, [queue, currentTrack]);

    const togglePlay = useCallback(async () => {
        if (isCasting && activeRenderer) {
            try {
                if (isPlaying) {
                    await pauseRenderer(activeRenderer.udn);
                    setIsPlaying(false);
                } else {
                    await resumeRenderer(activeRenderer.udn);
                    setIsPlaying(true);
                }
            } catch (err) { console.error('UPnP Toggle error:', err); }
            return;
        }

        const audio = audioRef.current;
        if (!audio || !currentTrack) return;

        if (isPlaying) {
            audio.pause();
        } else {
            audio.play().catch(err => console.error('Playback error:', err));
        }
    }, [isPlaying, currentTrack, isCasting, activeRenderer]);

    const seek = useCallback(async (time) => {
        if (isCasting && activeRenderer) {
            try {
                await seekRenderer(activeRenderer.udn, time);
                setCurrentTime(time);
            } catch (e) { console.error('UPnP Seek error:', e); }
            return;
        }

        const audio = audioRef.current;
        if (audio) {
            audio.currentTime = time;
        }
    }, [isCasting, activeRenderer]);

    const changeVolume = useCallback(async (vol) => {
        if (isCasting && activeRenderer) {
            try {
                // Backend expects 0-100
                await setRendererVolume(activeRenderer.udn, Math.round(vol * 100));
                setVolume(vol);
            } catch (e) { console.error('UPnP Volume error:', e); }
            return;
        }

        const audio = audioRef.current;
        if (audio) {
            audio.volume = vol;
            setVolume(vol);
        }
    }, [isCasting, activeRenderer]);

    return {
        currentTrack, isPlaying, currentTime, duration, volume,
        queue, currentIndex, repeatMode, shuffleMode,
        isCasting, activeRenderer, setIsCasting,
        playTrack, togglePlay, seek, changeVolume, startCast, stopCast,
        next, prev, stop, setRepeatMode, setShuffle
    };
}
