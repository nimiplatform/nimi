import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 128;

export type AdvisorComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  recordRoute: string | null;
};

export function AdvisorComposer({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  isStreaming,
  recordRoute,
}: AdvisorComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${h}px`;
    // Only show scrollbar when content actually exceeds max height
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="shrink-0 px-5 pb-5 pt-2">
      <div className="mx-auto max-w-2xl">
        {/* Record data link — shown when navigated from a reminder */}
        {recordRoute && (
          <div className="mb-2">
            <Link
              to={recordRoute}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-emerald-50/60 px-3 py-1.5 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100/60"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              去记录数据
            </Link>
          </div>
        )}

        {/* Frosted glass composer shell */}
        <div className="rounded-[28px] nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border border-[var(--nimi-material-glass-thick-border)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] shadow-[0_24px_50px_rgba(15,23,42,0.08)]" data-nimi-material="glass-thick" data-nimi-tone="card">
          <div className="flex items-end gap-2 p-2">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              placeholder="输入问题..."
              disabled={disabled}
              rows={1}
              className="advisor-composer-textarea min-h-[48px] flex-1 resize-none rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-300 disabled:opacity-50"
              style={{ maxHeight: MAX_HEIGHT, overflowY: 'hidden' }}
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-500 transition-all hover:bg-red-100 active:scale-95"
                aria-label="停止"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!value.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 via-teal-400 to-emerald-500 text-white shadow-[0_12px_30px_rgba(16,185,129,0.24)] transition-all hover:shadow-[0_16px_36px_rgba(16,185,129,0.32)] active:scale-95 disabled:opacity-40 disabled:shadow-none"
                aria-label="发送"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
