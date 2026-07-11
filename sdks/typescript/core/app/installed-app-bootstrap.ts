import { createNimiError } from '../../types';

const MAX_INLINE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_ARTIFACT_ID_LENGTH = 512;

export type InstalledNimiAppArtifactBytes = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly mimeInferred: boolean;
};

export type InstalledNimiAppArtifactReader = {
  readonly readRuntimeBytes: (artifactId: string) => Promise<InstalledNimiAppArtifactBytes>;
};

export type InstalledNimiAppStandardShellSurface = {
  readonly appHost: {
    readonly bootstrap: () => Promise<NimiAppHostBootstrapStatus>;
  };
  readonly artifacts: InstalledNimiAppArtifactReader;
};

export type NimiAppHostBootstrapStatus = {
  readonly state: 'ready';
  readonly trustClass: 'production-installed' | 'local-development';
  readonly appId: string;
  readonly bootstrapArtifactId?: string;
  readonly expiresAtUnixMs: number;
};

export type InstalledNimiAppBootstrapInput = {
  readonly standardShell: InstalledNimiAppStandardShellSurface;
};

export type InstalledNimiAppBootstrap = {
  readonly appHost: {
    readonly bootstrap: () => Promise<NimiAppHostBootstrapStatus>;
  };
  readonly artifacts: InstalledNimiAppArtifactReader;
};

export function createInstalledNimiAppBootstrap(
  input: InstalledNimiAppBootstrapInput,
): InstalledNimiAppBootstrap {
  const record = asRecord(input);
  if (!record || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['standardShell'])) {
    throw sdkInstalledError(
      'Installed app bootstrap input may contain only standardShell.',
      'SDK_INSTALLED_APP_BOOTSTRAP_INPUT_FORBIDDEN',
      'remove_renderer_owned_installed_authority',
    );
  }
  const standardShell = asRecord(record.standardShell);
  const appHost = asRecord(standardShell?.appHost);
  const bootstrap = appHost?.bootstrap;
  const artifacts = asRecord(standardShell?.artifacts);
  const readRuntimeBytes = artifacts?.readRuntimeBytes;
  if (typeof bootstrap !== 'function' || typeof readRuntimeBytes !== 'function') {
    throw sdkInstalledError(
      'Installed app bootstrap requires the typed protected artifact carrier.',
      'SDK_INSTALLED_APP_PROTECTED_CARRIER_REQUIRED',
      'install_verified_installed_app_standard_shell',
    );
  }
  return Object.freeze({
    appHost: Object.freeze({
      bootstrap: async () => projectAppHostBootstrap(await bootstrap.call(appHost)),
    }),
    artifacts: Object.freeze({
      readRuntimeBytes: async (artifactId: string) => {
        const normalized = normalizeArtifactId(artifactId);
        const result = await readRuntimeBytes.call(artifacts, normalized);
        return projectArtifactBytes(result);
      },
    }),
  });
}

function projectAppHostBootstrap(value: unknown): NimiAppHostBootstrapStatus {
  const record = asRecord(value);
  const trustClass = record?.trustClass;
  const appId = typeof record?.appId === 'string' ? record.appId : '';
  const bootstrapArtifactId = typeof record?.bootstrapArtifactId === 'string'
    ? record.bootstrapArtifactId
    : undefined;
  const expiresAtUnixMs = Number(record?.expiresAtUnixMs);
  const expectedKeys = trustClass === 'local-development'
    ? ['appId', 'bootstrapArtifactId', 'expiresAtUnixMs', 'state', 'trustClass']
    : ['appId', 'expiresAtUnixMs', 'state', 'trustClass'];
  if (
    !record
    || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)
    || record.state !== 'ready'
    || (trustClass !== 'production-installed' && trustClass !== 'local-development')
    || !appId
    || appId.trim() !== appId
    || !Number.isSafeInteger(expiresAtUnixMs)
    || expiresAtUnixMs <= 0
    || (trustClass === 'local-development') !== Boolean(bootstrapArtifactId)
    || (bootstrapArtifactId !== undefined && bootstrapArtifactId.trim() !== bootstrapArtifactId)
  ) {
    throw sdkInstalledError(
      'App-host bootstrap carrier returned an invalid projection.',
      'SDK_APP_HOST_BOOTSTRAP_PROJECTION_INVALID',
      'repair_verified_app_host_carrier',
    );
  }
  return Object.freeze({
    state: 'ready' as const,
    trustClass,
    appId,
    ...(bootstrapArtifactId ? { bootstrapArtifactId } : {}),
    expiresAtUnixMs,
  });
}

function normalizeArtifactId(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || normalized.length > MAX_ARTIFACT_ID_LENGTH) {
    throw sdkInstalledError(
      'Installed artifact id is invalid.',
      'SDK_INSTALLED_ARTIFACT_ID_INVALID',
      'provide_exact_runtime_artifact_id',
    );
  }
  return normalized;
}

function projectArtifactBytes(value: unknown): InstalledNimiAppArtifactBytes {
  const record = asRecord(value);
  const bytes = record?.bytes;
  const mimeType = typeof record?.mimeType === 'string' ? record.mimeType : '';
  const sizeBytes = Number(record?.sizeBytes);
  if (
    !isUint8Array(bytes)
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || sizeBytes > MAX_INLINE_ARTIFACT_BYTES
    || bytes.byteLength !== sizeBytes
    || !mimeType
    || mimeType.trim() !== mimeType
    || !mimeType.includes('/')
    || typeof record?.mimeInferred !== 'boolean'
  ) {
    throw sdkInstalledError(
      'Installed artifact carrier returned an invalid projection.',
      'SDK_INSTALLED_ARTIFACT_PROJECTION_INVALID',
      'repair_verified_installed_app_carrier',
    );
  }
  return {
    bytes: Uint8Array.from(bytes),
    mimeType,
    sizeBytes,
    mimeInferred: record.mimeInferred,
  };
}

function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sdkInstalledError(message: string, reasonCode: string, actionHint: string): Error {
  return createNimiError({ message, reasonCode, actionHint, source: 'sdk' });
}
