import React from 'react';

const STEPS = ['read', 'backup', 'sanitize', 'lyrics', 'language', 'write'];
const LABELS = { read: 'Read', backup: 'Backup', sanitize: 'Clean', lyrics: 'Lyrics', language: 'Lang', write: 'Write' };

export default function ProgressBar({ step, status, stageDurations = {} }) {
  const idx = STEPS.indexOf(step);
  const complete = step === 'write' && status === 'done';
  const err = status === 'error';

  const pct = complete ? 100 :
    err ? ((idx / STEPS.length) * 100) :
    (((idx + (status === 'done' ? 1 : 0.5)) / STEPS.length) * 100);

  return (
    <div className="space-y-1.5">
      {/* Step indicators */}
      <div className="flex items-center gap-0.5">
        {STEPS.map((s, i) => {
          const done = i < idx || (i === idx && status === 'done');
          const active = i === idx && status === 'running';
          const waiting = i === idx && status === 'waiting';
          const failed = i === idx && err;

          return (
            <div key={s} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                  failed ? 'bg-fn-danger' :
                  done ? 'bg-fn-success' :
                  waiting ? 'bg-amber-400 animate-pulse' :
                  active ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]' :
                  'bg-surface-5'
                }`} />
                <span className={`text-[8px] mt-0.5 font-medium whitespace-nowrap ${
                  failed ? 'text-fn-danger' :
                  done ? 'text-fn-success' :
                  waiting || active ? 'text-amber-400' :
                  'text-ink-faint'
                }`}>
                  {LABELS[s]}
                  {stageDurations[s] > 0 && (
                    <span className="opacity-40 ml-0.5 text-[7px] font-mono">({stageDurations[s].toFixed(1)}s)</span>
                  )}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 mx-0.5 transition-colors duration-300 ${
                  done ? 'bg-fn-success/40' : 'bg-surface-5/40'
                }`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Bar */}
      <div className="progress-track">
        <div
          className={`progress-fill ${err ? '!bg-gradient-to-r !from-fn-danger !to-fn-warn' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
