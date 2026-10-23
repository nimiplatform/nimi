import { appId } from './app-identity.js';
import { getNimiLocalAppClient } from './local-app-client.js';

export { appId, appTitle } from './app-identity.js';

export const runtimeAccountLoginEnabled = false;
export type RuntimeAuthMode = 'local-app';

export type RuntimePlatformReadyProjection = {
  readonly status: 'ready';
  readonly mode: RuntimeAuthMode;
  readonly appHost: {
    readonly state: 'session-bound';
    readonly reasonCode: string;
    readonly actionHint: string;
  };
};

export type RuntimePlatformUnavailableProjection = {
  readonly status: 'unavailable' | 'action-required';
  readonly mode: RuntimeAuthMode;
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint?: string;
  readonly retryable?: boolean;
};

export type RuntimePlatformProjection =
  | RuntimePlatformReadyProjection
  | RuntimePlatformUnavailableProjection;

let runtimeProjection: Promise<RuntimePlatformProjection> | null = null;

export function clearRuntimePlatformProjection(): void {
  runtimeProjection = null;
}

export function getRuntimePlatformProjection(): Promise<RuntimePlatformProjection> {
  runtimeProjection ??= resolveAppHostProjection();
  return runtimeProjection;
}

async function resolveAppHostProjection(): Promise<RuntimePlatformProjection> {
  try {
    const status = await getNimiLocalAppClient().auth.status();
    if (!status.sessionBound) {
      return {
        status: status.state === 'unavailable' ? 'unavailable' : 'action-required',
        mode: 'local-app',
        reasonCode: status.reasonCode,
        actionHint: status.actionHint,
        retryable: status.retryable,
        message: '',
      };
    }
    return {
      status: 'ready',
      mode: 'local-app',
      appHost: {
        state: 'session-bound',
        reasonCode: status.reasonCode,
        actionHint: status.actionHint,
      },
    };
  } catch (error) {
    return unavailableFromError(error);
  }
}

export function unavailableFromError(error: unknown): RuntimePlatformUnavailableProjection {
  const record = typeof error === 'object' && error !== null
    ? error as { reasonCode?: unknown; code?: unknown; actionHint?: unknown; retryable?: unknown; message?: unknown }
    : {};
  const reasonCode = normalizeText(record.reasonCode) || normalizeText(record.code) || 'connection-check-failed';
  return {
    status: 'action-required',
    mode: 'local-app',
    reasonCode,
    actionHint: normalizeText(record.actionHint) || undefined,
    retryable: typeof record.retryable === 'boolean' ? record.retryable : undefined,
    message: normalizeText(record.message) || (typeof error === 'string' ? error : ''),
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
