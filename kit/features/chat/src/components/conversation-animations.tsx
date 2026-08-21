/**
 * Conversation animation styles injected into the DOM once.
 * All keyframes are scoped under `.conversation-root` to avoid global pollution.
 * Respects `prefers-reduced-motion: reduce`.
 */
export function ConversationAnimationStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
@keyframes conv-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes chat-slide-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes chat-drift-in {
  from { opacity: 0; transform: translate(8px, 10px); }
  to { opacity: 1; transform: translate(0, 0); }
}

@keyframes chat-scale-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes voice-bar {
  0%, 100% { height: 4px; opacity: 0.55; }
  35% { height: 15px; opacity: 1; }
  70% { height: 8px; opacity: 0.72; }
}

@keyframes typing-dot-bounce {
  0%, 100% { transform: translateY(0); opacity: 0.55; }
  40% { transform: translateY(-3px); opacity: 1; }
}

/* ── utility classes ── */
.conversation-root .conv-animate-fade-in {
  animation: conv-fade-in var(--nimi-motion-base) var(--nimi-motion-ease-standard) both;
}

.conversation-root .lc-media-skeleton {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(135deg, var(--nimi-surface-card), color-mix(in srgb, var(--nimi-status-success) 10%, var(--nimi-surface-panel))),
    linear-gradient(120deg, color-mix(in srgb, var(--nimi-status-success) 16%, transparent), color-mix(in srgb, var(--nimi-status-info) 10%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nimi-border-subtle) 66%, transparent);
}

.conversation-root .lc-typing-bubble {
  position: relative;
  border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--nimi-border-subtle) 92%, transparent);
  background: linear-gradient(135deg, var(--nimi-surface-card), var(--nimi-surface-panel));
  box-shadow: 0 12px 32px color-mix(in srgb, var(--nimi-text-primary) 8%, transparent);
}

.conversation-root .lc-typing-bubble::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(135deg, color-mix(in srgb, var(--nimi-status-success) 10%, transparent), transparent 65%);
}

.conversation-root .lc-typing-label {
  color: var(--nimi-text-secondary);
}

.conversation-root .lc-typing-dot {
  background: linear-gradient(180deg, color-mix(in srgb, var(--nimi-status-success) 90%, transparent), color-mix(in srgb, var(--nimi-action-primary-bg) 70%, transparent));
}


/* ── reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .conversation-root .conv-animate-fade-in,
  .conversation-root .chat-msg-entry,
  .conversation-root .chat-voice-bar,
  .conversation-root .lc-typing-dot {
    animation: none !important;
  }
}
`,
      }}
    />
  );
}
