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
            <span className="lc-typing-trail" aria-hidden>
              <span />
              <span />
            </span>
            {onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-gray-400 transition hover:border-gray-400 hover:text-gray-600"
                aria-label={stopLabel}
                title={stopLabel}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><rect width="8" height="8" rx="1" /></svg>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
