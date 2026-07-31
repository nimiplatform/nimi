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
.conversation-root {
  /* ── message entry ── */
  --conv-slide-up-duration: 0.32s;
  --conv-drift-in-duration: 0.38s;
}

@keyframes conv-slide-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes conv-drift-in {
  from { opacity: 0; transform: translate(-4px, 10px) scale(0.985); }
  to   { opacity: 1; transform: translate(0, 0) scale(1); }
}

@keyframes conv-breathe {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--nimi-status-success) 0%, transparent); }
  50%      { box-shadow: 0 0 24px 4px color-mix(in srgb, var(--nimi-status-success) 12%, transparent); }
}

@keyframes conv-send-press {
  0%   { transform: scale(1); }
  40%  { transform: scale(0.92); }
  100% { transform: scale(1); }
}

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

@keyframes conv-typing-dot {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40%           { opacity: 1;   transform: scale(1); }
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

@keyframes lc-current-turn-glow {
  0%, 100% { opacity: 0.75; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.01); }
}

@keyframes lc-current-turn-aura {
  0%, 100% { opacity: 0.55; transform: scale(0.98); }
  50% { opacity: 0.9; transform: scale(1.03); }
}

@keyframes lc-current-turn-edge {
  0%, 100% { opacity: 0.32; }
  50% { opacity: 0.66; }
}

@keyframes lc-bubble-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-8px); }
}

@keyframes hf-ripple {
  0%   { transform: scale(1); opacity: 0.55; }
  100% { transform: scale(1.8); opacity: 0; }
}

@keyframes hf-ripple-glow {
  0%, 100% { opacity: 0.35; }
  50%      { opacity: 0.65; }
}

/* ── utility classes ── */
.conversation-root .conv-animate-slide-up {
  animation: conv-slide-up var(--conv-slide-up-duration) cubic-bezier(0.22, 1, 0.36, 1) both;
}

.conversation-root .conv-animate-drift-in {
  animation: conv-drift-in var(--conv-drift-in-duration) cubic-bezier(0.22, 1, 0.36, 1) both;
}

.conversation-root .conv-animate-breathe {
  animation: conv-breathe 4.8s ease-in-out infinite;
}

.conversation-root .conv-animate-send-press {
  animation: conv-send-press 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.conversation-root .conv-animate-fade-in {
  animation: conv-fade-in 0.24s ease both;
}

.conversation-root .lc-media-skeleton {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(135deg, var(--nimi-surface-card), color-mix(in srgb, var(--nimi-status-success) 10%, var(--nimi-surface-panel))),
    linear-gradient(120deg, color-mix(in srgb, var(--nimi-status-success) 16%, transparent), color-mix(in srgb, var(--nimi-status-info) 10%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nimi-border-subtle) 66%, transparent);
}

.conversation-root .lc-current-turn-shell {
  position: relative;
}

.conversation-root .lc-current-turn-halo {
  position: absolute;
  inset: -10px -8px;
  border-radius: 34px;
  background: radial-gradient(circle at top, color-mix(in srgb, var(--nimi-status-success) 28%, transparent), transparent 70%);
  opacity: 0.8;
  animation: lc-current-turn-aura 6.4s ease-in-out infinite;
}

.conversation-root .lc-current-turn-halo-pending {
  background: radial-gradient(circle at top, color-mix(in srgb, var(--nimi-status-success) 18%, transparent), transparent 72%);
}

.conversation-root .lc-current-turn-card {
  position: relative;
  overflow: hidden;
  box-shadow: 0 24px 56px color-mix(in srgb, var(--nimi-text-primary) 8%, transparent);
}

.conversation-root .lc-current-turn-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(135deg, color-mix(in srgb, var(--nimi-surface-card) 18%, transparent), transparent 60%);
  animation: lc-current-turn-glow 6.4s ease-in-out infinite;
}

.conversation-root .lc-current-turn-card::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nimi-status-success) 18%, transparent);
  animation: lc-current-turn-edge 6.4s ease-in-out infinite;
}

.conversation-root .lc-current-turn-card > * {
  position: relative;
  z-index: 1;
}

.conversation-root .lc-current-turn-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  background: color-mix(in srgb, var(--nimi-status-success) 10%, var(--nimi-surface-card));
  border: 1px solid color-mix(in srgb, var(--nimi-status-success) 34%, var(--nimi-border-subtle));
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
  .conversation-root .conv-animate-slide-up,
  .conversation-root .conv-animate-drift-in,
  .conversation-root .conv-animate-breathe,
  .conversation-root .conv-animate-send-press,
  .conversation-root .conv-animate-fade-in,
  .conversation-root .chat-msg-entry,
  .conversation-root .lc-typing-dot,
  .conversation-root .lc-current-turn-halo,
  .conversation-root .lc-current-turn-card::before,
  .conversation-root .lc-current-turn-card::after,
  .conversation-root .hf-ripple-ring,
  .conversation-root .hf-ripple-glow {
    animation: none !important;
  }
}
`,
      }}
    />
  );
}
