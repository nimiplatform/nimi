import type { JsonObject } from '../types';

export type NimiRuntimeBridgeConfigDefaults = Readonly<{
  schemaVersion: number;
  grpcAddr: string;
  httpAddr: string;
}>;

export type NimiRuntimeBridgeConfigJson = JsonObject;
export type NimiRuntimeBridgeConfigProjectionResult = {
  nextConfig: NimiRuntimeBridgeConfigJson;
  changed: boolean;
};
export type NimiRuntimeBridgeRealmConfigDefaults = {
  realmBaseUrl?: unknown;
  jwtIssuer?: unknown;
  jwtAudience?: unknown;
  jwksUrl?: unknown;
  revocationUrl?: unknown;
};

// Mirrors Runtime host bridge config schema defaults. Desktop may edit the
// local bridge config file, but these default values are Runtime-owned.
export const NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS = {
  schemaVersion: 1,
  grpcAddr: '127.0.0.1:46371',
  httpAddr: '127.0.0.1:46372',
} as const satisfies NimiRuntimeBridgeConfigDefaults;

export function normalizeNimiRuntimeBridgeEndpoint(value: unknown, fallback = ''): string {
  return (String(value || '').trim() || fallback).replace(/\/+$/, '');
}

export function buildNimiRuntimeBridgeLoopbackEndpoint(port: number | null): string {
  return port ? `http://127.0.0.1:${port}/v1` : '';
}

export function extractNimiRuntimeBridgeEndpointPort(endpoint: unknown): number | null {
  const normalized = normalizeNimiRuntimeBridgeEndpoint(endpoint);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return readNumber(url.port);
  } catch {
    const match = normalized.match(/:(\d+)(?:\/|$)/);
    return match ? readNumber(match[1]) : null;
  }
}

export function projectNimiRuntimeBridgeLocalEndpoint(configRaw: NimiRuntimeBridgeConfigJson): string {
  const engines = asRecord(asRecord(configRaw).engines);
  const llamaEngine = asRecord(engines.llama);
  const enabled = readBoolean(llamaEngine.enabled);
  if (enabled === false) {
    return '';
  }
  return buildNimiRuntimeBridgeLoopbackEndpoint(readNumber(llamaEngine.port));
}

export function buildNimiRuntimeBridgeConfigWithLocalEndpoint(
  baseConfigRaw: NimiRuntimeBridgeConfigJson,
  localEndpoint: unknown,
): NimiRuntimeBridgeConfigJson {
  const configRecord = cloneConfig(baseConfigRaw);
  configRecord.schemaVersion = NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS.schemaVersion;
  configRecord.grpcAddr = readString(configRecord.grpcAddr) || NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS.grpcAddr;
  configRecord.httpAddr = readString(configRecord.httpAddr) || NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS.httpAddr;

  const existingEngines = asRecord(configRecord.engines);
  const currentLlamaEngine = asRecord(existingEngines.llama);
  const port = extractNimiRuntimeBridgeEndpointPort(localEndpoint);
  existingEngines.llama = {
    ...currentLlamaEngine,
    enabled: port ? true : currentLlamaEngine.enabled,
    port: port ?? currentLlamaEngine.port,
  };
  configRecord.engines = existingEngines;

  const existingProviders = asRecord(configRecord.providers);
  if ('local' in existingProviders) {
    delete existingProviders.local;
  }
  configRecord.providers = existingProviders;

  return configRecord;
}

export function serializeNimiRuntimeBridgeLocalEndpointProjection(localEndpoint: unknown): string {
  return JSON.stringify({
    localEndpoint: normalizeNimiRuntimeBridgeEndpoint(localEndpoint),
  });
}

export function mergeNimiRuntimeBridgeDataRootConfig(
  baseConfig: NimiRuntimeBridgeConfigJson,
  dataRootPath: unknown,
  localModelsPath: unknown,
  localStatePath?: unknown,
): NimiRuntimeBridgeConfigProjectionResult {
  const currentConfig = asRecord(baseConfig);
  const currentDataRootRef = readString(currentConfig.dataRootRef);
  const currentManagedRoots = asRecord(currentConfig.managedRoots);
  const nextLocalModelsPath = readString(localModelsPath);
  const nextDataRootRef = readString(dataRootPath);
  const currentLocalStatePath = readString(currentConfig.localStatePath);
  const nextLocalStatePath = readString(localStatePath);
  const nextManagedRoots = {
    ...currentManagedRoots,
    ...(nextLocalModelsPath ? { models: nextLocalModelsPath } : {}),
    ...(nextDataRootRef ? {
      dependencies: `${nextDataRootRef}/dependencies`,
      environments: `${nextDataRootRef}/environments`,
      logs: `${nextDataRootRef}/logs`,
      audit: `${nextDataRootRef}/audit`,
    } : {}),
  };

  const hasLegacyLocalModelsPath = readString(currentConfig.localModelsPath) !== '';
  const shouldUpdateDataRootRef = Boolean(nextDataRootRef) && currentDataRootRef !== nextDataRootRef;
  const shouldUpdateManagedRoots = JSON.stringify(currentManagedRoots) !== JSON.stringify(nextManagedRoots);
  const shouldUpdateLocalStatePath = Boolean(nextLocalStatePath) && currentLocalStatePath !== nextLocalStatePath;

  if (!hasLegacyLocalModelsPath && !shouldUpdateDataRootRef && !shouldUpdateManagedRoots && !shouldUpdateLocalStatePath) {
    return {
      nextConfig: currentConfig,
      changed: false,
    };
  }

  const { localModelsPath: _removedLocalModelsPath, ...configWithoutLegacyLocalModelsPath } = currentConfig;
  return {
    nextConfig: {
      ...configWithoutLegacyLocalModelsPath,
      ...(shouldUpdateDataRootRef ? { dataRootRef: nextDataRootRef } : {}),
      managedRoots: nextManagedRoots,
      ...(shouldUpdateLocalStatePath ? { localStatePath: nextLocalStatePath } : {}),
    },
    changed: true,
  };
}

export function mergeNimiRuntimeBridgeRealmJwtConfig(
  baseConfig: NimiRuntimeBridgeConfigJson,
  realmDefaults: NimiRuntimeBridgeRealmConfigDefaults,
): NimiRuntimeBridgeConfigProjectionResult {
  const currentConfig = asRecord(baseConfig);
  const currentAuth = asRecord(currentConfig.auth);
  const currentJwt = asRecord(currentAuth.jwt);
  const currentAccount = asRecord(currentAuth.account);

  const nextRealmBaseUrl = readString(realmDefaults.realmBaseUrl);
  const nextIssuer = readString(realmDefaults.jwtIssuer);
  const nextAudience = readString(realmDefaults.jwtAudience);
  const nextJwksUrl = readString(realmDefaults.jwksUrl);
  const nextRevocationUrl = readString(realmDefaults.revocationUrl);

  const changed = readString(currentAccount.realmBaseUrl) !== nextRealmBaseUrl
    || readString(currentJwt.issuer) !== nextIssuer
    || readString(currentJwt.audience) !== nextAudience
    || readString(currentJwt.jwksUrl) !== nextJwksUrl
    || readString(currentJwt.revocationUrl) !== nextRevocationUrl;

  if (!changed) {
    return {
      nextConfig: currentConfig,
      changed: false,
    };
  }

  return {
    nextConfig: {
      ...currentConfig,
      auth: {
        ...currentAuth,
        account: {
          ...currentAccount,
          realmBaseUrl: nextRealmBaseUrl,
        },
        jwt: {
          ...currentJwt,
          issuer: nextIssuer,
          audience: nextAudience,
          jwksUrl: nextJwksUrl,
          revocationUrl: nextRevocationUrl,
        },
      },
    },
    changed: true,
  };
}

export function mergeNimiRuntimeBridgeDeveloperRegistrationConfig(
  baseConfig: NimiRuntimeBridgeConfigJson,
  enabled: boolean,
): NimiRuntimeBridgeConfigProjectionResult {
  const currentConfig = asRecord(baseConfig);
  const currentAuth = asRecord(currentConfig.auth);
  const currentDeveloperRegistration = asRecord(currentAuth.developerRegistration);
  const currentEnabled = currentDeveloperRegistration.enabled === true;

  if (currentEnabled === enabled) {
    return {
      nextConfig: currentConfig,
      changed: false,
    };
  }

  return {
    nextConfig: {
      ...currentConfig,
      auth: {
        ...currentAuth,
        developerRegistration: {
          ...currentDeveloperRegistration,
          enabled,
        },
      },
    },
    changed: true,
  };
}

function asRecord(value: unknown): NimiRuntimeBridgeConfigJson {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as NimiRuntimeBridgeConfigJson : {};
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

function cloneConfig(value: NimiRuntimeBridgeConfigJson): NimiRuntimeBridgeConfigJson {
  return asRecord(JSON.parse(JSON.stringify(asRecord(value))));
}
