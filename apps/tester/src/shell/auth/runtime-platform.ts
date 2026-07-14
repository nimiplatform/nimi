import { ReasonCode } from '@nimiplatform/sdk/types';
import type { NimiAppAuthProjection, NimiAppLocalSessionProjection } from '@nimiplatform/sdk/app';
import { testerLocalAppRuntimePlatform } from '../local-app-runtime-platform.js';

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
    const status = await testerLocalAppRuntimePlatform.auth.status();
    if (!status.sessionBound) {
      return unavailableFromAuth(status);
    }
    if (status.operationAllowed !== (status.state === 'session-bound-granted')) {
      throw new Error('The local-app session projection contains inconsistent grant state.');
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
      return 'This local development project needs approval in Nimi Desktop.';
    case 'revoked':
      return 'This local-app authorization was revoked in Nimi Desktop.';
    case 'project-changed':
      return 'The project identity no longer matches the admitted local development project.';
    case 'process-replaced':
      return 'This process was replaced; restart the app through the verified Desktop supervisor.';
    case 'account-changed':
      return 'The Nimi account changed; authorize this project for the current account.';
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
      return 'The active Nimi account changed; the local-app session must be authorized again.';
    case 'runtime-restarted':
      return 'Runtime restarted; reopen the protected local-app session.';
    case 'revoked':
      return 'This local-app authorization was revoked.';
    case 'project-changed':
      return 'The local development project no longer matches its admitted identity.';
    case 'local-development-authorization-required':
    case 'local-development-reapproval-required':
      return 'This development project needs your approval in Nimi Desktop.';
    case 'local-development-session-revoked':
      return 'This development authorization was revoked in Nimi Desktop.';
    case 'local-development-project-changed':
      return 'The project identity no longer matches the approved development project.';
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
      return 'reauthorize_for_current_account';
    case 'revoked':
      return 'request_local_app_operation_grant';
    case 'project-changed':
      return 'readmit_local_development_project';
    case 'local-development-authorization-required':
    case 'local-development-reapproval-required':
      return 'complete_local_app_authorization';
    case 'local-development-session-revoked':
      return 'request_local_app_operation_grant';
    case 'local-development-project-changed':
      return 'readmit_local_development_project';
    default:
      return 'start_fixed_runtime_service';
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
