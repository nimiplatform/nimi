import { hasTauriInvoke } from './env.js';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeBridgeErrorPayload } from './types.js';

export class BridgeError extends Error {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly traceId: string;
  readonly retryable: boolean;

  constructor(payload: RuntimeBridgeErrorPayload) {
    super(payload.message);
    this.name = 'BridgeError';
    this.reasonCode = payload.reasonCode;
    this.actionHint = payload.actionHint;
    this.traceId = payload.traceId;
    this.retryable = payload.retryable;
  }
}

function parseBridgeError(raw: unknown): RuntimeBridgeErrorPayload | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.reasonCode === 'string') {
      return parsed as RuntimeBridgeErrorPayload;
    }
  } catch {
    // not JSON
  }
  return null;
}

export async function invoke<T = unknown>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  if (!hasTauriInvoke()) {
    throw new BridgeError({
      reasonCode: ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE,
      actionHint: 'run_in_tauri_shell',
      traceId: '',
      retryable: false,
      message: 'Tauri IPC is not available in this environment',
    });
  }

  try {
    return await window.__TAURI__!.core.invoke<T>(command, payload);
  } catch (error: unknown) {
    const parsed = parseBridgeError(error);
    if (parsed) {
      throw new BridgeError(parsed);
    }
    throw new BridgeError({
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'check_runtime_bridge_logs',
      traceId: '',
      retryable: false,
      message: String(error),
    });
  }
}
