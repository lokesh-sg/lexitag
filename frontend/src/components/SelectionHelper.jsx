import React, { useState, useEffect, useRef } from 'react';
import { addCleanupPattern } from '../api';

export default function SelectionHelper() {
  const [menu, setMenu] = useState(null); // { x, y, text }
  const [status, setStatus] = useState(null); // 'saving', 'success', 'error'
  const menuRef = useRef(null);

  useEffect(() => {
    const handleMouseUp = (e) => {
      // Small delay to let the selection settle
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (text && text.length > 1) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          
          // Don't show if we're clicking inside the menu itself
          if (menuRef.current && menuRef.current.contains(e.target)) return;

          setMenu({
            x: rect.left + window.scrollX + (rect.width / 2),
            y: rect.top + window.scrollY - 10,
            text
          });
          setStatus(null);
        } else {
          // If we clicked elsewhere and don't have a menuRef (or it doesn't contain the target)
          if (!menuRef.current || !menuRef.current.contains(e.target)) {
            setMenu(null);
          }
        }
      }, 50);
    };

    const handleMouseDown = (e) => {
        if (menuRef.current && menuRef.current.contains(e.target)) return;
        setMenu(null);
    };

    const handleContextMenu = (e) => {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        if (text && text.length > 1) {
            e.preventDefault(); // Show our menu instead
            const rect = e.target.getBoundingClientRect(); // Better placement for context menu
            setMenu({
                x: e.clientX + window.scrollX,
                y: e.clientY + window.scrollY,
                text
            });
            setStatus(null);
        }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  const handleAdd = async (category, isRegex = false) => {
    if (!menu) return;
    setStatus('saving');
    try {
      let finalPattern = menu.text;
      
      // If we're adding "intelligently as regex" to handle special chars like () []
      // We escape only if it has these chars AND we want it to work as a literal pattern
      if (isRegex) {
          finalPattern = menu.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }

      await addCleanupPattern(finalPattern, category, isRegex);
      setStatus('success');
      
      // Notify active views to re-run their local cleaning passes
      document.dispatchEvent(new CustomEvent('cleanup-rule-added', { 
        detail: { pattern: finalPattern, category } 
      }));

      setTimeout(() => setMenu(null), 1500);
    } catch (err) {
      console.error("Selection add fail:", err);
      const msg = err.response?.data?.detail;
      if (msg === "Pattern already exists") {
        setStatus('exists');
      } else {
        setStatus('error');
      }
      setTimeout(() => setMenu(null), 2500);
    }
  };

  if (!menu) return null;

  return (
    <div 
      ref={menuRef}
      className="fixed z-[999] -translate-x-1/2 -translate-y-full animate-in fade-in zoom-in duration-200"
      style={{ left: menu.x, top: menu.y }}
    >
      <div className="flex flex-col bg-surface-2 border border-amber-400/40 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden min-w-[160px] ring-1 ring-white/5">
        <div className="px-3 py-2 border-b border-white/5 bg-white/5">
            <div className="text-[9px] text-ink-faint uppercase font-bold tracking-widest mb-1">Clean Selection</div>
            <div className="text-[11px] font-mono text-amber-400 truncate max-w-[200px]">{menu.text}</div>
        </div>

        {status === 'saving' ? (
            <div className="px-4 py-6 flex flex-col items-center justify-center gap-2">
                 <svg className="w-5 h-5 text-amber-500 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                 <span className="text-[10px] text-ink-muted uppercase font-black">Persisting rule...</span>
            </div>
        ) : status === 'success' ? (
            <div className="px-4 py-6 flex flex-col items-center justify-center gap-2">
                 <div className="w-8 h-8 rounded-full bg-fn-success/20 flex items-center justify-center text-fn-success animate-bounce">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12"/></svg>
                 </div>
                 <span className="text-[10px] text-ink-muted uppercase font-black">Rule Active</span>
            </div>
        ) : status === 'exists' ? (
            <div className="px-4 py-6 flex flex-col items-center justify-center gap-2">
                 <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                 </div>
                 <span className="text-[10px] text-ink-muted uppercase font-black">Already in Database</span>
            </div>
        ) : status === 'error' ? (
            <div className="px-4 py-6 flex flex-col items-center justify-center gap-2">
                 <div className="w-8 h-8 rounded-full bg-fn-danger/20 flex items-center justify-center text-fn-danger">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                 </div>
                 <span className="text-[10px] text-ink-muted uppercase font-black">Submission Failed</span>
            </div>
        ) : (
            <>
                <button 
                  onClick={() => handleAdd('junk', true)}
                  className="w-full px-3 py-2.5 text-left hover:bg-white/5 transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-fn-danger/10 flex items-center justify-center text-fn-danger/70 group-hover:text-fn-danger transition-colors">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-ink-rich">Mark as Junk</span>
                        <span className="text-[8px] text-ink-faint uppercase font-medium">Auto-Escaped Regex</span>
                    </div>
                  </div>
                  <svg className="w-3 h-3 text-ink-faint group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="9 18 15 12 9 6"/></svg>
                </button>

                <button 
                  onClick={() => handleAdd('soundtrack', true)}
                  className="w-full px-3 py-2.5 text-left border-t border-white/5 hover:bg-white/5 transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-amber-400/10 flex items-center justify-center text-amber-400/70 group-hover:text-amber-400 transition-colors">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20m10-10H2"/></svg>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-ink-rich">Soundtrack Marker</span>
                        <span className="text-[8px] text-ink-faint uppercase font-medium">Smart Pattern</span>
                    </div>
                  </div>
                  <svg className="w-3 h-3 text-ink-faint group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </>
        )}
        
        <div className="bg-surface-3/50 px-2 py-1 flex justify-center border-t border-white/5">
             <div className="w-12 h-1 bg-white/10 rounded-full" />
        </div>
      </div>
      
      {/* Arrow */}
      <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 bg-surface-2 border-r border-b border-amber-400/40 rotate-45" />
    </div>
  );
}
