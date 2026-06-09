import React from 'react';

/**
 * Reusable premium confirmation modal for LexiTag Studio.
 * 
 * @param {string} title - The title of the modal (optional).
 * @param {string} message - The main confirmation message.
 * @param {string} confirmLabel - Label for the confirm button.
 * @param {string} cancelLabel - Label for the cancel button.
 * @param {function} onConfirm - Called when confirm button is clicked.
 * @param {function} onCancel - Called when cancel or backdrop is clicked.
 */
export default function ConfirmModal({ 
  title = "Confirm Action", 
  message, 
  confirmLabel = "OK", 
  cancelLabel = "Cancel", 
  type = "confirm",  // "confirm" or "alert"
  variant = "info",  // "info", "success", "danger"
  onConfirm, 
  onCancel 
}) {
  const icons = {
    info: (
      <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
    success: (
      <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    danger: (
      <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    )
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-surface-0/60 backdrop-blur-sm animate-fade-in" 
        onClick={onCancel} 
      />

      {/* Modal Card */}
      <div className="relative studio-card w-full max-w-sm p-6 shadow-elevated animate-slide-up border-amber-500/20 bg-surface-1">
        <div className="mb-4">
          <h3 className="text-sm font-bold text-ink-rich uppercase tracking-wider font-display mb-1 flex items-center gap-2">
            {icons[variant] || icons.info}
            {title}
          </h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            {message}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          {type === 'confirm' && (
            <button 
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-xs font-bold text-ink-muted hover:text-ink-normal hover:bg-surface-3 transition-all"
            >
              {cancelLabel}
            </button>
          )}
          <button 
            onClick={onConfirm}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-amber-400 text-surface-0 hover:bg-amber-300 active:scale-95 shadow-lg shadow-amber-400/20 transition-all"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
