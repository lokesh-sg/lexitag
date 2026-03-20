import React, { useState, useEffect } from 'react';
import { fetchRenderers, castToRenderer } from '../api';

export default function CastModal({ trackId, onClose }) {
  const [renderers, setRenderers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [casting, setCasting] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { loadRenderers(); }, []);

  async function loadRenderers() {
    setLoading(true);
    setError('');
    try { setRenderers(await fetchRenderers()); }
    catch { setError('Discovery failed'); }
    finally { setLoading(false); }
  }

  async function handleCast(r) {
    setCasting(r.udn);
    setError('');
    try { await castToRenderer(r.udn, trackId); onClose(); }
    catch { setError(`Failed to cast to ${r.name}`); }
    finally { setCasting(null); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative studio-card w-full max-w-sm p-5 shadow-elevated animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-ink-rich font-display flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
              <line x1="2" y1="20" x2="2.01" y2="20" />
            </svg>
            Cast to Device
          </h3>
          <button onClick={onClose} className="p-1 rounded text-ink-faint hover:text-ink-rich transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="py-8 flex items-center justify-center text-ink-muted text-xs gap-2">
            <svg className="w-4 h-4 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            Discovering devices…
          </div>
        ) : renderers.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-ink-muted text-xs mb-3">No UPnP/DLNA devices found</p>
            <button onClick={loadRenderers} className="btn-ghost text-xs">Retry</button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {renderers.map(r => (
              <button
                key={r.udn}
                onClick={() => handleCast(r)}
                disabled={casting === r.udn}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-surface-0/50 border border-surface-5/25 hover:border-amber-800/40 hover:bg-surface-3/40 transition-all text-left group"
              >
                <div className="w-8 h-8 rounded-md bg-surface-3 flex items-center justify-center group-hover:bg-amber-900/20 transition-colors">
                  <svg className="w-4 h-4 text-ink-faint group-hover:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="7" width="20" height="15" rx="2" ry="2" /><polyline points="17 2 12 7 7 2" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-ink-normal truncate">{r.name}</p>
                  <p className="text-[10px] text-ink-faint truncate">{r.location}</p>
                </div>
                {casting === r.udn && (
                  <svg className="w-3.5 h-3.5 animate-spin-slow text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-2.5 text-[10px] text-fn-danger text-center">{error}</p>}
      </div>
    </div>
  );
}
