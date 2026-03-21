import { useState, useRef, useCallback, useEffect } from 'react';
import { getStreamUrl } from '../api';

export function usePlayer() {
    const audioRef = useRef(null);
    const [currentTrack, setCurrentTrack] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    
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
    }, [currentIndex, repeatMode, shuffleMode, queue, shuffledQueue]);

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
    }, [currentIndex, repeatMode, shuffleMode, queue, shuffledQueue]);

    const stop = useCallback(() => {
        const audio = audioRef.current;
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            setIsPlaying(false);
        }
    }, []);

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

    const playTrack = useCallback((track, newQueue = null, index = -1) => {
        const audio = audioRef.current;
        if (!audio) return;

        // If a new queue is provided, set it
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
    }, [currentTrack, isPlaying, shuffleMode]);

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

    const togglePlay = useCallback(() => {
        const audio = audioRef.current;
        if (!audio || !currentTrack) return;

        if (isPlaying) {
            audio.pause();
        } else {
            audio.play().catch(err => console.error('Playback error:', err));
        }
    }, [isPlaying, currentTrack]);

    const seek = useCallback((time) => {
        const audio = audioRef.current;
        if (audio) {
            audio.currentTime = time;
        }
    }, []);

    const changeVolume = useCallback((vol) => {
        const audio = audioRef.current;
        if (audio) {
            audio.volume = vol;
            setVolume(vol);
        }
    }, []);

    return {
        currentTrack, isPlaying, currentTime, duration, volume,
        queue, currentIndex, repeatMode, shuffleMode,
        playTrack, togglePlay, seek, changeVolume,
        next, prev, stop, setRepeatMode, setShuffle
    };
}
