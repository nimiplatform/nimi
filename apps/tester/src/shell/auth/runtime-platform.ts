import { ReasonCode } from '@nimiplatform/sdk/types';
import type { NimiAppAuthProjection, NimiAppLocalSessionProjection } from '@nimiplatform/sdk/app';
import { getTesterLocalAppClient } from '../local-app-runtime-platform.js';

export { appId, appTitle, scaffoldProfile } from './app-identity.js';

export const runtimeAccountLoginEnabled = false;

export type RuntimeAuthMode = 'local-app';

export type RuntimePlatformReadyProjection = {
  readonly status: 'ready';
  readonly mode: RuntimeAuthMode;
  readonly localAppSession: NimiAppLocalSessionProjection;
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
  runtimeProjection ??= resolveLocalAppProjection();
  return runtimeProjection;
}

async function resolveLocalAppProjection(): Promise<RuntimePlatformProjection> {
  try {
    const status = await getTesterLocalAppClient().auth.status();
    if (!status.sessionBound) {
      return unavailableFromAuth(status);
    }
    return {
      status: 'ready',
      mode: 'local-app',
      localAppSession: status,
    };
  } catch (error) {
    return unavailableFromError(error);
  }
}

function unavailableFromAuth(status: NimiAppAuthProjection): RuntimePlatformUnavailableProjection {
  return {
    status: status.state === 'unavailable' ? 'unavailable' : 'action-required',
    mode: 'local-app',
    reasonCode: status.reasonCode,
    actionHint: status.actionHint,
    message: messageForState(status.state, status.reasonCode),
  };
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
    message: messageFor(reasonCode),
  };
}

function messageForState(state: NimiAppAuthProjection['state'], reasonCode: string): string {
  switch (state) {
    case 'action-required':
      return 'Protected App Access is currently unavailable.';
    case 'revoked':
      return 'This protected local-app session ended.';
    case 'project-changed':
      return 'The project identity no longer matches the admitted local development project.';
    case 'process-replaced':
      return 'This process was replaced; restart the app through the verified Desktop supervisor.';
    case 'account-changed':
      return 'The Nimi account changed; reopen the protected local-app session.';
    case 'runtime-restarted':
      return 'Runtime restarted; reopen the protected local-app session.';
    default:
      return messageFor(reasonCode);
  }
}

function messageFor(reasonCode: string): string {
  switch (reasonCode) {
    case 'runtime-service-unavailable':
      return 'Nimi Desktop could not reach its protected Runtime service.';
    case 'runtime-service-untrusted':
      return 'This process is not connected through the trusted Nimi Desktop local-app carrier.';
    case 'runtime-unauthenticated':
      return 'The protected local-app session must be reopened through Nimi Desktop.';
    case 'process-replaced':
      return 'This process no longer matches the admitted local-app process.';
    case 'account-changed':
      return 'The active Nimi account changed; reopen the protected local-app session.';
    case 'runtime-restarted':
      return 'Runtime restarted; reopen the protected local-app session.';
    case 'revoked':
      return 'This protected local-app session ended.';
    case 'project-changed':
      return 'The local development project no longer matches its current registration.';
    case 'local-app-operation-unavailable':
      return 'Protected App Access is unavailable until Runtime admits a fresh access session.';
    case 'local-development-registration-not-found':
      return 'This local development registration no longer exists.';
    case 'local-development-project-changed':
      return 'The project identity no longer matches the registered development project.';
    default:
      return 'The protected Nimi local-app carrier is unavailable.';
  }
}

function actionHintFor(reasonCode: string): string {
  switch (reasonCode) {
    case 'runtime-service-untrusted':
    case 'process-replaced':
      return 'restart_through_verified_desktop_supervisor';
    case 'runtime-unauthenticated':
    case 'runtime-restarted':
      return 'reopen_local_app_session';
    case 'account-changed':
      return 'reopen_local_app_session';
    case 'revoked':
      return 'reopen_local_app_session';
    case 'project-changed':
      return 'register_local_development_project';
    case 'local-app-operation-unavailable':
      return 'wait_for_app_access_admission';
    case 'local-development-registration-not-found':
    case 'local-development-project-changed':
      return 'register_local_development_project';
    default:
      return 'start_fixed_runtime_service';
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
