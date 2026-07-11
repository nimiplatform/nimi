import { ReasonCode } from '@nimiplatform/sdk/types';
import { appId } from './app-identity.js';
import { getInstalledNimiAppBootstrap } from './installed-app-bootstrap.js';

export { appId, appTitle, scaffoldProfile } from './app-identity.js';

export const runtimeAccountLoginEnabled = false;
export type RuntimeAuthMode = 'third-party-nimi-app';

export type RuntimePlatformReadyProjection = {
  readonly status: 'ready';
  readonly mode: RuntimeAuthMode;
  readonly appHost: {
    readonly state: 'ready';
    readonly trustClass: 'production-installed' | 'local-development';
    readonly appId: string;
    readonly bootstrapArtifactId?: string;
    readonly bootstrapArtifact?: {
      readonly mimeType: string;
      readonly sizeBytes: number;
    };
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
    const bootstrap = getInstalledNimiAppBootstrap();
    const status = await bootstrap.appHost.bootstrap();
    if (status.appId !== appId) {
      throw new Error('The protected app-host identity does not match nimi.app.yaml.');
    }
    const bootstrapArtifact = status.bootstrapArtifactId
      ? await bootstrap.artifacts.readRuntimeBytes(status.bootstrapArtifactId)
      : undefined;
    return {
      status: 'ready',
      mode: 'third-party-nimi-app',
      appHost: {
        state: 'ready',
        trustClass: status.trustClass,
        appId: status.appId,
        ...(status.bootstrapArtifactId ? { bootstrapArtifactId: status.bootstrapArtifactId } : {}),
        ...(bootstrapArtifact
          ? {
              bootstrapArtifact: {
                mimeType: bootstrapArtifact.mimeType,
                sizeBytes: bootstrapArtifact.sizeBytes,
              },
            }
          : {}),
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
    mode: 'third-party-nimi-app',
    reasonCode,
    actionHint: actionHintFor(reasonCode),
    message: error instanceof Error ? error.message : 'The protected Nimi app host is unavailable.',
  };
}

function actionHintFor(reasonCode: string): string {
  switch (reasonCode) {
    case 'local-development-authorization-required':
    case 'local-development-reapproval-required':
      return 'approve_project_in_nimi_desktop';
    case 'local-development-session-revoked':
      return 'restart_official_nimi_app_dev_command';
    case 'local-development-project-changed':
      return 'restore_authorized_project_identity';
    default:
      return 'open_nimi_desktop_and_retry';
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
