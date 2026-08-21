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
              <span className="lc-typing-dot h-2.5 w-2.5 rounded-full" style={{ animation: 'typing-dot-bounce var(--nimi-motion-ambient) var(--nimi-motion-ease-standard) infinite' }} />
              <span className="lc-typing-dot h-2.5 w-2.5 rounded-full" style={{ animation: 'typing-dot-bounce var(--nimi-motion-ambient) var(--nimi-motion-ease-standard) var(--nimi-motion-fast) infinite' }} />
              <span className="lc-typing-dot h-2.5 w-2.5 rounded-full" style={{ animation: 'typing-dot-bounce var(--nimi-motion-ambient) var(--nimi-motion-ease-standard) var(--nimi-motion-base) infinite' }} />
            </div>
            <span className="lc-typing-label text-sm font-medium">
              {thinkingLabel}
            </span>
            {onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)] shadow-sm transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:border-[var(--nimi-status-danger-soft-border)] hover:bg-[var(--nimi-status-danger-soft-bg)] hover:text-[var(--nimi-status-danger)] hover:shadow-md active:scale-[var(--nimi-motion-pressed-scale)]"
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
