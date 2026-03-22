import {
  DEFAULT_LOCAL_ENDPOINT_V11,
  normalizeEndpointV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import type { JsonObject } from '@runtime/net/json';

const DEFAULT_RUNTIME_CONFIG = {
  schemaVersion: 1,
  grpcAddr: '127.0.0.1:46371',
  httpAddr: '127.0.0.1:46372',
} as const;

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
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

function buildLoopbackEndpointFromPort(port: number | null): string {
  return port ? `http://127.0.0.1:${port}/v1` : '';
}

function extractPortFromEndpoint(endpoint: string): number | null {
  const normalized = normalizeEndpointV11(endpoint, DEFAULT_LOCAL_ENDPOINT_V11);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return readNumber(url.port);
  } catch {
    const match = normalized.match(/:(\d+)(?:\/|$)/);
    return match ? readNumber(match[1]) : null;
  }
}

/**
 * Extract local runtime endpoint from bridge config.
 * Connectors are no longer managed via bridge config — they come from SDK.
 * Local runtime endpoint now flows through engines.llama.
 */
export function applyRuntimeBridgeConfigToState(
  state: RuntimeConfigStateV11,
  runtimeConfigRaw: JsonObject,
): RuntimeConfigStateV11 {
  const engines = asRecord(asRecord(runtimeConfigRaw).engines);
  const llamaEngine = asRecord(engines.llama);
  const enabled = readBoolean(llamaEngine.enabled);
  const port = readNumber(llamaEngine.port);
  const endpointFromConfig = enabled === false ? '' : buildLoopbackEndpointFromPort(port);
  const nextLocalEndpoint = endpointFromConfig || state.local.endpoint;

  return {
    ...state,
    local: {
      ...state.local,
      endpoint: nextLocalEndpoint,
    },
  };
}

/**
 * Build runtime bridge config from state.
 * Only persists llama loopback endpoint and preserves existing config fields.
 * Cloud provider/connector data is managed by Go runtime connector store.
 */
export function buildRuntimeBridgeConfigFromState(
  state: RuntimeConfigStateV11,
  baseConfigRaw: JsonObject,
): JsonObject {
  const configRecord = asRecord(JSON.parse(JSON.stringify(baseConfigRaw)));
  configRecord.schemaVersion = DEFAULT_RUNTIME_CONFIG.schemaVersion;
  configRecord.grpcAddr = readString(configRecord.grpcAddr as string) || DEFAULT_RUNTIME_CONFIG.grpcAddr;
  configRecord.httpAddr = readString(configRecord.httpAddr as string) || DEFAULT_RUNTIME_CONFIG.httpAddr;

  const localEndpoint = normalizeEndpointV11(state.local.endpoint, DEFAULT_LOCAL_ENDPOINT_V11);

  const existingEngines = asRecord(configRecord.engines);
  const currentLlamaEngine = asRecord(existingEngines.llama);
  const port = extractPortFromEndpoint(localEndpoint);
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

/**
 * Serialize a projection for dirty-checking whether bridge config needs saving.
 * Only tracks local endpoint since connectors are managed by runtime.
 */
export function serializeRuntimeBridgeProjection(state: RuntimeConfigStateV11): string {
  return JSON.stringify({
    localEndpoint: normalizeEndpointV11(state.local.endpoint, DEFAULT_LOCAL_ENDPOINT_V11),
  });
}
