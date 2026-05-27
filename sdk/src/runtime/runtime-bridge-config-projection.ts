import { RUNTIME_BRIDGE_CONFIG_DEFAULTS } from './runtime-config-defaults.js';

export type RuntimeBridgeConfigJson = Record<string, unknown>;

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
