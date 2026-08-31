import { ReasonCode } from '@nimiplatform/sdk/types';
import { appId } from './app-identity.js';
import { getNimiLocalAppClient } from './local-app-client.js';

export { appId, appTitle, scaffoldProfile } from './app-identity.js';

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
        message: messageFor(status.reasonCode),
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

function unavailableFromError(error: unknown): RuntimePlatformUnavailableProjection {
  const reasonCode = typeof error === 'object' && error !== null && 'reasonCode' in error
    ? normalizeText((error as { reasonCode?: unknown }).reasonCode) || ReasonCode.RUNTIME_UNAVAILABLE
    : ReasonCode.RUNTIME_UNAVAILABLE;
  return {
    status: 'action-required',
    mode: 'local-app',
    reasonCode,
    actionHint: actionHintFor(reasonCode),
    message: error instanceof Error ? error.message : messageFor(reasonCode),
  };
}

function messageFor(reasonCode: string): string {
  switch (reasonCode) {
    case 'local-development-registration-required':
      return 'This development project must be registered through Nimi.';
    case 'local-development-session-revoked':
      return 'Nimi access for this running App is unavailable.';
    case 'local-development-project-changed':
      return 'The project identity no longer matches its current registration.';
    default:
      return 'The protected Nimi local-app carrier is unavailable.';
  }
}

function actionHintFor(reasonCode: string): string {
  switch (reasonCode) {
    case 'local-development-registration-required':
      return 'restart_official_nimi_app_dev_command';
    case 'local-development-session-revoked':
      return 'retry_when_nimi_access_is_available';
    case 'local-development-project-changed':
      return 'restore_registered_project_identity';
    default:
      return 'open_nimi_desktop_and_retry';
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
