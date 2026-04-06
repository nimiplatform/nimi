// Relay error handler — adapted from local-chat error-handler.ts
// Removed: mod SDK data imports, diagnostics import

import type { ChatMessage, LocalChatTarget, LocalChatTurnAudit } from './types.js';

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

function buildTurnAudit(input: {
  selectedTarget: LocalChatTarget;
  latencyMs: number;
  error: string;
}): LocalChatTurnAudit {
  return {
    id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    targetId: input.selectedTarget.id,
    worldId: input.selectedTarget.worldId || null,
    latencyMs: input.latencyMs,
    error: input.error,
    createdAt: new Date().toISOString(),
  };
}

export function buildErrorTurnPayload(input: {
  selectedTarget: LocalChatTarget;
  error: unknown;
  latencyMs: number;
}): {
  message: string;
  errorMessage: ChatMessage;
  turnAudit: LocalChatTurnAudit;
} {
  const message = toErrorMessage(input.error);
  return {
    message,
    errorMessage: {
      id: `msg-${Date.now().toString(36)}-error`,
      role: 'assistant',
      kind: 'text',
      content: `Error: ${message}`,
      timestamp: new Date(),
    },
    turnAudit: buildTurnAudit({
      selectedTarget: input.selectedTarget,
      latencyMs: input.latencyMs,
      error: message,
    }),
  };
}
