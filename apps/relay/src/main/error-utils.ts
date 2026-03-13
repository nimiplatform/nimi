// Shared error normalization for IPC and stream error handling
// RL-IPC-005 — Serialize errors to structured-clone-compatible shape

export interface NormalizedError {
  reasonCode?: string;
  message: string;
  actionHint?: string;
  traceId?: string;
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    const asAny = error as unknown as Record<string, unknown>;
    return {
      reasonCode: typeof asAny.reasonCode === 'string' ? asAny.reasonCode : undefined,
      message: error.message,
      actionHint: typeof asAny.actionHint === 'string' ? asAny.actionHint : undefined,
      traceId: typeof asAny.traceId === 'string' ? asAny.traceId : undefined,
    };
  }
  return { message: String(error) };
}
