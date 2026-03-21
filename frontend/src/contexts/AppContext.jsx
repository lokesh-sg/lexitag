
import React, { createContext, useContext } from 'react';
import { usePlayer } from "../hooks/usePlayer";
import { useFixer } from "../hooks/useFixer";
import { useTracks } from "../hooks/useTracks";

const PlayerContext = createContext(null);
const FixerContext = createContext(null);
const TracksContext = createContext(null);

export const usePlayerContext = () => useContext(PlayerContext);
export const useFixerContext = () => useContext(FixerContext);
export const useTracksContext = () => useContext(TracksContext);

export function AppContextProvider({ children }) {
    const player = usePlayer();
    const fixer = useFixer();
    const tracks = useTracks();

    return (
        <PlayerContext.Provider value={player}>
            <FixerContext.Provider value={fixer}>
                <TracksContext.Provider value={tracks}>
                    {children}
                </TracksContext.Provider>
            </FixerContext.Provider>
        </PlayerContext.Provider>
    );
}
