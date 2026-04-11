export type CanonicalTypingBubbleProps = {
  agentAvatarUrl?: string | null;
  agentName: string;
  agentRoleLabel?: string;
  thinkingLabel?: string;
  onStop?: () => void;
  stopLabel?: string;
};

export function CanonicalTypingBubble({
  agentName,
  agentRoleLabel = 'Assistant',
  thinkingLabel = 'Thinking…',
  onStop,
  stopLabel = 'Stop generating',
}: CanonicalTypingBubbleProps) {
  return (
    <div className="flex gap-2" role="status" aria-live="polite" aria-label={agentRoleLabel}>
      <div className="max-w-[72%]">
        <div className="lc-typing-bubble px-4 py-3">
          <div className="lc-typing-row flex items-center gap-3">
            <div className="flex items-center gap-1.5" aria-hidden>
              <span className="lc-typing-dot h-2.5 w-2.5 rounded-full" style={{ animation: 'typing-dot-bounce 1.15s ease-in-out 0ms infinite' }} />
              <span className="lc-typing-dot h-2.5 w-2.5 rounded-full" style={{ animation: 'typing-dot-bounce 1.15s ease-in-out 120ms infinite' }} />
              <span className="lc-typing-dot h-2.5 w-2.5 rounded-full" style={{ animation: 'typing-dot-bounce 1.15s ease-in-out 240ms infinite' }} />
            </div>
            <span className="lc-typing-label text-sm font-medium">
              {thinkingLabel}
            </span>
            {onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-400 shadow-sm transition-all duration-150 hover:border-red-300 hover:bg-red-50 hover:text-red-500 hover:shadow-md active:scale-95"
                aria-label={stopLabel}
                title={stopLabel}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
