import type { NimiElectronStandardShellHost } from './types.js';
import {
  NimiElectronAppHostError,
  type NimiElectronAppHostArtifactBytes,
} from './app-host.js';
import { NimiElectronShellHostError } from './types.js';

const MAX_ARTIFACT_ID_LENGTH = 512;

export type NimiElectronInstalledArtifactResult = {
  readonly dataBase64: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly mimeInferred: boolean;
};

export async function readElectronInstalledArtifact(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<NimiElectronInstalledArtifactResult> {
  const appHost = host?.appHost;
  if (!appHost) {
    throw new NimiElectronShellHostError({
      code: 'protected-carrier-required',
      message: 'Electron installed artifact read requires the native protected carrier',
      reasonCode: 'protected-carrier-required',
      actionHint: 'install_verified_electron_protected_carrier',
      details: { command },
    });
  }
  const keys = Object.keys(payload).sort();
  if (keys.length !== 1 || keys[0] !== 'artifactId') {
    throw invalidPayload(command);
  }
  const artifactId = typeof payload.artifactId === 'string' ? payload.artifactId.trim() : '';
  if (!artifactId || artifactId !== payload.artifactId || artifactId.length > MAX_ARTIFACT_ID_LENGTH) {
    throw invalidPayload(command);
  }
  try {
    return projectArtifact(await appHost.readArtifactBytes(artifactId));
  } catch (error) {
    if (error instanceof NimiElectronAppHostError) {
      throw mapInstalledHostError(error, command);
    }
    throw new NimiElectronShellHostError({
      code: 'runtime-service-untrusted',
      message: 'Electron installed artifact host returned an untrusted failure',
      reasonCode: 'installed-artifact-runtime-untrusted',
      actionHint: 'restart_verified_installed_app_host',
      details: { command },
    });
  }
}

function projectArtifact(artifact: NimiElectronAppHostArtifactBytes): NimiElectronInstalledArtifactResult {
  return {
    dataBase64: Buffer.from(artifact.bytes).toString('base64'),
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    mimeInferred: artifact.mimeInferred,
  };
}

function mapInstalledHostError(
  error: NimiElectronAppHostError,
  command: string,
): NimiElectronShellHostError {
  const code = installedArtifactStandardCode(error.reasonCode);
  return new NimiElectronShellHostError({
    code,
    message: error.reasonCode,
    reasonCode: error.reasonCode,
    actionHint: installedArtifactActionHint(error.reasonCode),
    source: error.reasonCode.startsWith('installed-artifact-') ? 'runtime' : 'electron',
    details: { command, retryable: error.retryable },
  });
}

function installedArtifactStandardCode(reasonCode: string) {
  switch (reasonCode) {
    case 'protected-carrier-required': return 'protected-carrier-required' as const;
    case 'runtime-service-unavailable':
    case 'installed-artifact-runtime-unavailable': return 'runtime-service-unavailable' as const;
    case 'runtime-service-untrusted':
    case 'installed-artifact-runtime-untrusted': return 'runtime-service-untrusted' as const;
    case 'runtime-service-repair-required': return 'runtime-service-repair-required' as const;
    case 'installed-artifact-invalid-input': return 'invalid-payload' as const;
    case 'installed-artifact-forbidden': return 'runtime-permission-denied' as const;
    case 'installed-artifact-not-found': return 'not-found' as const;
    case 'installed-artifact-too-large': return 'resource-exhausted' as const;
    default: return 'runtime-service-untrusted' as const;
  }
}

function installedArtifactActionHint(reasonCode: string): string {
  switch (reasonCode) {
    case 'installed-artifact-invalid-input': return 'provide_exact_runtime_artifact_id';
    case 'installed-artifact-forbidden': return 'request_installed_artifact_read_grant';
    case 'installed-artifact-not-found': return 'refresh_runtime_artifact_projection';
    case 'installed-artifact-too-large': return 'use_streaming_artifact_surface_when_admitted';
    case 'runtime-service-repair-required': return 'repair_verified_runtime_service';
    case 'protected-carrier-required': return 'install_verified_electron_protected_carrier';
    default: return 'restart_verified_installed_app_host';
  }
}

function invalidPayload(command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message: 'Electron installed artifact payload must contain only artifactId',
    reasonCode: 'electron-installed-artifact-payload-invalid',
    actionHint: 'send_only_runtime_artifact_id',
    details: { command },
  });
}
