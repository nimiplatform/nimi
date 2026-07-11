import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { BridgeError, invokeChecked } from './invoke.js';
import { assertRecord, parseRequiredString } from './types.js';
import type { JsonObject, JsonValue } from './types.js';

const MAX_INLINE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const APP_HOST_BOOTSTRAP_COMMAND = 'nimi.app-host.bootstrap';

export type InstalledNimiAppStandardShellSurface = {
  readonly appHost: {
    readonly bootstrap: () => Promise<NimiAppHostBootstrapStatus>;
  };
  readonly artifacts: {
    readonly readRuntimeBytes: (artifactId: string) => Promise<InstalledNimiAppArtifactBytes>;
  };
  readonly aiConfig: {
    readonly get: (scopeRef: string) => Promise<JsonObject>;
    readonly set: (scopeRef: string, config: JsonObject) => Promise<JsonObject>;
  };
  readonly config: {
    readonly get: () => Promise<JsonObject>;
    readonly set: (config: JsonObject) => Promise<JsonObject>;
  };
  readonly data: {
    readonly resolvePath: (relativePath: string) => Promise<string>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<JsonValue>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<JsonValue>;
    readonly removeJson: (relativePath: string) => Promise<InstalledNimiAppStorageRemoveJsonResult>;
  };
  readonly localAssets: {
    readonly resolveUrl: (relativePath: string) => Promise<string>;
  };
};

export type NimiAppHostBootstrapStatus = {
  readonly state: 'ready';
  readonly trustClass: 'production-installed' | 'local-development';
  readonly appId: string;
  readonly bootstrapArtifactId?: string;
  readonly expiresAtUnixMs: number;
};

export type InstalledNimiAppArtifactBytes = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly mimeInferred: boolean;
};

export type InstalledNimiAppStorageRemoveJsonResult = {
  readonly path: string;
  readonly removed: boolean;
};

export function createInstalledNimiAppStandardShellSurface(): InstalledNimiAppStandardShellSurface {
  return {
    appHost: {
      bootstrap: readAppHostBootstrap,
    },
    artifacts: {
      readRuntimeBytes: readInstalledRuntimeArtifactBytes,
    },
    aiConfig: {
      get: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['ai-config.get']),
      set: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']),
    },
    config: {
      get: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['config.get']),
      set: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['config.set']),
    },
    data: {
      resolvePath: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']),
    },
    storage: {
      readJson: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']),
      writeJson: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']),
      removeJson: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson']),
    },
    localAssets: {
      resolveUrl: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']),
    },
  };
}

async function readAppHostBootstrap(): Promise<NimiAppHostBootstrapStatus> {
  return invokeChecked(APP_HOST_BOOTSTRAP_COMMAND, {}, parseAppHostBootstrap);
}

function parseAppHostBootstrap(value: unknown): NimiAppHostBootstrapStatus {
  const record = assertRecord(value, `${APP_HOST_BOOTSTRAP_COMMAND} returned invalid payload`);
  const expectedKeys = record.trustClass === 'local-development'
    ? ['appId', 'bootstrapArtifactId', 'expiresAtUnixMs', 'state', 'trustClass']
    : ['appId', 'expiresAtUnixMs', 'state', 'trustClass'];
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${APP_HOST_BOOTSTRAP_COMMAND}: result fields must match app-host bootstrap`);
  }
  const state = parseRequiredString(record.state, 'state', APP_HOST_BOOTSTRAP_COMMAND);
  const trustClass = parseRequiredString(record.trustClass, 'trustClass', APP_HOST_BOOTSTRAP_COMMAND);
  const appId = parseRequiredString(record.appId, 'appId', APP_HOST_BOOTSTRAP_COMMAND);
  const expiresAtUnixMs = Number(record.expiresAtUnixMs);
  const bootstrapArtifactId = record.bootstrapArtifactId === undefined
    ? undefined
    : parseRequiredString(record.bootstrapArtifactId, 'bootstrapArtifactId', APP_HOST_BOOTSTRAP_COMMAND);
  if (
    state !== 'ready'
    || (trustClass !== 'production-installed' && trustClass !== 'local-development')
    || appId.trim() !== appId
    || !Number.isSafeInteger(expiresAtUnixMs)
    || expiresAtUnixMs <= 0
    || (trustClass === 'local-development') !== Boolean(bootstrapArtifactId)
  ) {
    throw new Error(`${APP_HOST_BOOTSTRAP_COMMAND}: bootstrap projection is invalid`);
  }
  return {
    state,
    trustClass,
    appId,
    ...(bootstrapArtifactId ? { bootstrapArtifactId } : {}),
    expiresAtUnixMs,
  };
}

async function readInstalledRuntimeArtifactBytes(
  artifactId: string,
): Promise<InstalledNimiAppArtifactBytes> {
  const normalized = typeof artifactId === 'string' ? artifactId.trim() : '';
  if (!normalized || normalized !== artifactId || normalized.length > 512) {
    throw new BridgeError('Installed artifact id is invalid.', NIMI_STANDARD_SHELL_COMMANDS['artifacts.readRuntimeBytes'], {
      code: 'invalid-payload',
      reasonCode: 'renderer-installed-artifact-id-invalid',
      actionHint: 'provide_exact_runtime_artifact_id',
      source: 'renderer',
    });
  }
  const command = NIMI_STANDARD_SHELL_COMMANDS['artifacts.readRuntimeBytes'];
  return invokeChecked(
    command,
    { payload: { artifactId: normalized } },
    (value) => parseInstalledArtifactBytes(value, command),
  );
}

function parseInstalledArtifactBytes(value: unknown, command: string): InstalledNimiAppArtifactBytes {
  const record = assertRecord(value, `${command} returned invalid payload`);
  const keys = Object.keys(record).sort();
  const expectedKeys = ['dataBase64', 'mimeInferred', 'mimeType', 'sizeBytes'];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${command}: result fields must match the installed artifact projection`);
  }
  const dataBase64 = parseRequiredString(record.dataBase64, 'dataBase64', command);
  const mimeType = parseRequiredString(record.mimeType, 'mimeType', command);
  const sizeBytes = Number(record.sizeBytes);
  if (
    !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || sizeBytes > MAX_INLINE_ARTIFACT_BYTES
    || mimeType.trim() !== mimeType
    || !mimeType.includes('/')
    || typeof record.mimeInferred !== 'boolean'
  ) {
    throw new Error(`${command}: artifact metadata is invalid`);
  }
  const bytes = decodeCanonicalBase64(dataBase64, command);
  if (bytes.byteLength !== sizeBytes) {
    throw new Error(`${command}: artifact size does not match decoded bytes`);
  }
  return {
    bytes,
    mimeType,
    sizeBytes,
    mimeInferred: record.mimeInferred,
  };
}

function decodeCanonicalBase64(value: string, command: string): Uint8Array {
  try {
    const decoded = globalThis.atob(value);
    if (globalThis.btoa(decoded) !== value) {
      throw new Error('non-canonical base64');
    }
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    throw new Error(`${command}: dataBase64 must be canonical base64`);
  }
}

function rejectInstalledAppCarrier<T>(command: string): Promise<T> {
  return Promise.reject(installedAppCarrierRequired(command));
}

function installedAppCarrierRequired(command: string): BridgeError {
  return new BridgeError(
    'Installed Nimi App standard-shell operations require explicit A.4 operation admission.',
    command,
    {
      code: 'capability-unavailable',
      reasonCode: 'renderer-installed-app-carrier-required',
      actionHint: 'wait_for_a4_installed_operation_admission',
      source: 'renderer',
      details: { command },
    },
  );
}
