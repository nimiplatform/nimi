import { RUNTIME_BRIDGE_CONFIG_DEFAULTS } from './runtime-config-defaults.js';

export type RuntimeBridgeConfigJson = Record<string, unknown>;
export type RuntimeBridgeConfigProjectionResult = {
  nextConfig: RuntimeBridgeConfigJson;
  changed: boolean;
};
export type RuntimeBridgeRealmConfigDefaults = {
  realmBaseUrl?: unknown;
  jwtIssuer?: unknown;
  jwtAudience?: unknown;
  jwksUrl?: unknown;
  revocationUrl?: unknown;
};

function asRecord(value: unknown): RuntimeBridgeConfigJson {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RuntimeBridgeConfigJson : {};
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

function cloneConfig(value: RuntimeBridgeConfigJson): RuntimeBridgeConfigJson {
  return asRecord(JSON.parse(JSON.stringify(asRecord(value))));
}

export function normalizeRuntimeBridgeEndpoint(value: unknown, fallback = ''): string {
  return (String(value || '').trim() || fallback).replace(/\/+$/, '');
}

export function buildRuntimeBridgeLoopbackEndpoint(port: number | null): string {
  return port ? `http://127.0.0.1:${port}/v1` : '';
}

export function extractRuntimeBridgeEndpointPort(endpoint: unknown): number | null {
  const normalized = normalizeRuntimeBridgeEndpoint(endpoint);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return readNumber(url.port);
  } catch {
    const match = normalized.match(/:(\d+)(?:\/|$)/);
    return match ? readNumber(match[1]) : null;
  }
}

export function projectRuntimeBridgeLocalEndpoint(configRaw: RuntimeBridgeConfigJson): string {
  const engines = asRecord(asRecord(configRaw).engines);
  const llamaEngine = asRecord(engines.llama);
  const enabled = readBoolean(llamaEngine.enabled);
  if (enabled === false) {
    return '';
  }
  return buildRuntimeBridgeLoopbackEndpoint(readNumber(llamaEngine.port));
}

export function buildRuntimeBridgeConfigWithLocalEndpoint(
  baseConfigRaw: RuntimeBridgeConfigJson,
  localEndpoint: unknown,
): RuntimeBridgeConfigJson {
  const configRecord = cloneConfig(baseConfigRaw);
  configRecord.schemaVersion = RUNTIME_BRIDGE_CONFIG_DEFAULTS.schemaVersion;
  configRecord.grpcAddr = readString(configRecord.grpcAddr) || RUNTIME_BRIDGE_CONFIG_DEFAULTS.grpcAddr;
  configRecord.httpAddr = readString(configRecord.httpAddr) || RUNTIME_BRIDGE_CONFIG_DEFAULTS.httpAddr;

  const existingEngines = asRecord(configRecord.engines);
  const currentLlamaEngine = asRecord(existingEngines.llama);
  const port = extractRuntimeBridgeEndpointPort(localEndpoint);
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

export function serializeRuntimeBridgeLocalEndpointProjection(localEndpoint: unknown): string {
  return JSON.stringify({
    localEndpoint: normalizeRuntimeBridgeEndpoint(localEndpoint),
  });
}

export function mergeRuntimeBridgeDataRootConfig(
  baseConfig: RuntimeBridgeConfigJson,
  dataRootPath: unknown,
  localModelsPath: unknown,
  localStatePath?: unknown,
): RuntimeBridgeConfigProjectionResult {
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

export function mergeRuntimeBridgeRealmJwtConfig(
  baseConfig: RuntimeBridgeConfigJson,
  realmDefaults: RuntimeBridgeRealmConfigDefaults,
): RuntimeBridgeConfigProjectionResult {
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

export function mergeRuntimeBridgeDeveloperRegistrationConfig(
  baseConfig: RuntimeBridgeConfigJson,
  enabled: boolean,
): RuntimeBridgeConfigProjectionResult {
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
