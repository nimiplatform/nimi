export type CanonicalTypingBubbleProps = {
  agentAvatarUrl?: string | null;
  agentName: string;
  agentRoleLabel?: string;
  thinkingLabel?: string;
};

export function CanonicalTypingBubble({
  agentAvatarUrl = null,
  agentName,
  agentRoleLabel = 'Assistant',
  thinkingLabel = 'Thinking…',
}: CanonicalTypingBubbleProps) {
  const agentInitial = (String(agentName || 'A').trim().charAt(0) || 'A').toUpperCase();

  return (
    <div className="flex gap-2" role="status" aria-live="polite" aria-label={agentRoleLabel}>
      {agentAvatarUrl ? (
        <img
          src={agentAvatarUrl}
          alt={agentName || agentRoleLabel}
          className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-black/5"
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-xs font-semibold text-white ring-1 ring-black/5">
          {agentInitial}
        </div>
      )}
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
          </div>
        </div>
      </div>
    </div>
  );
}
