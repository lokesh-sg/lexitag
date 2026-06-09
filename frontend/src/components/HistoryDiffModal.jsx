import React, { useState } from 'react';

export default function HistoryDiffModal({ entry, onClose }) {
  const [diffOnly, setDiffOnly] = useState(false);
  
  const rawBefore = entry.raw_before || {};
  const rawAfter = entry.raw_after || {};
  
  // Create a unified list of keys from both before and after
  const allKeys = Array.from(new Set([...Object.keys(rawBefore), ...Object.keys(rawAfter)])).sort();
  
  // Filter if diffOnly is active
  const displayedKeys = diffOnly 
    ? allKeys.filter(k => String(rawBefore[k]) !== String(rawAfter[k]))
    : allKeys;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" onClick={onClose}>
      <div className="studio-card max-w-5xl w-full max-h-[90vh] flex flex-col animate-scale-in border-surface-6 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-surface-4 flex items-center justify-between bg-surface-2">
          <div>
            <h3 className="text-lg font-bold text-ink-rich">Raw Tag Comparison</h3>
            <p className="text-[10px] text-ink-faint font-mono truncate max-w-md">{entry.track_path}</p>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer group">
               <div className="relative">
                 <input 
                   type="checkbox" 
                   className="sr-only" 
                   checked={diffOnly}
                   onChange={(e) => setDiffOnly(e.target.checked)}
                 />
                 <div className={`w-8 h-4 rounded-full transition-colors ${diffOnly ? 'bg-amber-400' : 'bg-surface-5'}`} />
                 <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${diffOnly ? 'translate-x-4' : ''}`} />
               </div>
               <span className="text-[10px] font-bold text-ink-muted group-hover:text-ink-normal uppercase tracking-wider">Show Changes Only</span>
            </label>
            <button 
              onClick={onClose} 
              className="p-2 rounded-lg hover:bg-surface-4 text-ink-muted transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 bg-surface-1">
          <div className="grid grid-cols-2 gap-8 h-full">
            {/* Before */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-fn-danger shadow-glow-danger" />
                <h4 className="text-[11px] font-black uppercase text-fn-danger tracking-[0.2em]">Original State</h4>
              </div>
              <div className="max-h-[500px] overflow-y-auto pr-2 space-y-1.5 font-mono text-[11px]">
                {displayedKeys.length > 0 ? (
                  displayedKeys.map(k => {
                    const v = rawBefore[k];
                    const hasValue = k in rawBefore;
                    const isRemoved = hasValue && !(k in rawAfter);
                    
                    return (
                      <div key={k} className={`p-2.5 rounded-lg bg-surface-2 border group transition-all hover:border-surface-6 ${isRemoved ? 'border-fn-danger/30 bg-fn-danger/5' : 'border-surface-4'}`}>
                        <div className="text-amber-500/80 mb-1 font-bold flex justify-between">
                          <span>{k}</span>
                          {isRemoved && <span className="text-[8px] text-fn-danger">REMOVED</span>}
                        </div>
                        <div className="text-ink-muted break-all leading-relaxed whitespace-pre-wrap">
                          {hasValue ? String(v) : <span className="text-ink-faint italic">[Not Present]</span>}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-20 text-center text-ink-faint border border-dashed border-surface-4 rounded-xl italic">
                    {diffOnly ? 'No differences found' : 'No tags captured'}
                  </div>
                )}
              </div>
            </div>

            {/* After */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-fn-success shadow-glow-success" />
                <h4 className="text-[11px] font-black uppercase text-fn-success tracking-[0.2em]">Cleaned State</h4>
              </div>
              <div className="max-h-[500px] overflow-y-auto pr-2 space-y-1.5 font-mono text-[11px]">
                {displayedKeys.length > 0 ? (
                  displayedKeys.map(k => {
                    const v = rawAfter[k];
                    const beforeVal = rawBefore[k];
                    const isNew = !(k in rawBefore);
                    const isChanged = k in rawBefore && String(beforeVal) !== String(v);
                    const isRemoved = !(k in rawAfter);

                    return (
                      <div key={k} className={`p-2.5 rounded-lg border transition-all hover:bg-surface-2 ${
                        isRemoved ? 'bg-fn-danger/5 border-fn-danger/20 opacity-60' :
                        isNew ? 'bg-fn-success/10 border-fn-success/40' :
                        isChanged ? 'bg-fn-success/5 border-fn-success/20' : 
                        'bg-surface-2 border-surface-4'
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className={`${(isChanged || isNew) ? 'text-fn-success' : 'text-amber-500/80'} font-bold`}>{k}</div>
                          {isRemoved && <span className="text-[9px] uppercase font-black text-fn-danger pr-1">STRIPPED</span>}
                          {isNew && <span className="text-[9px] uppercase font-black text-fn-success pr-1">ADDED</span>}
                          {isChanged && !isRemoved && !isNew && <span className="text-[9px] uppercase font-black text-fn-success pr-1">CLEANED</span>}
                        </div>
                        <div className={`${(isChanged || isNew) ? 'text-ink-rich' : 'text-ink-muted'} break-all leading-relaxed whitespace-pre-wrap`}>
                          {isRemoved ? <span className="italic text-fn-danger/50">[Stripped/Deleted]</span> : String(v)}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-20 text-center text-ink-faint border border-dashed border-surface-4 rounded-xl italic">
                    {diffOnly ? 'No differences found' : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        <div className="px-6 py-4 bg-surface-2 border-t border-surface-4 flex items-center justify-between">
          <p className="text-[10px] text-ink-faint italic font-medium">Standard frames are automatically re-mapped to modern containers.</p>
          <button onClick={onClose} className="btn-secondary !px-8">Close Details</button>
        </div>
      </div>
    </div>
  );
}
