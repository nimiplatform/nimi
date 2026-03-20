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

/**
 * Convert an error to a proper Error instance for IPC serialization.
 * Electron's ipcMain.handle only serializes Error instances correctly;
 * plain objects become "[object Object]" in the renderer.
 */
export function toIpcError(error: unknown): Error {
  const normalized = normalizeError(error);
  const parts = [normalized.message];
  if (normalized.reasonCode) parts.push(`[${normalized.reasonCode}]`);
  if (normalized.actionHint) parts.push(`(${normalized.actionHint})`);
  const err = new Error(parts.join(' '));
  if (normalized.reasonCode) {
    Object.assign(err, { reasonCode: normalized.reasonCode });
  }
  if (normalized.actionHint) {
    Object.assign(err, { actionHint: normalized.actionHint });
  }
  if (normalized.traceId) {
    Object.assign(err, { traceId: normalized.traceId });
  }
  return err;
}
