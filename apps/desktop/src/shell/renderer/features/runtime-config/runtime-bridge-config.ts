import {
  DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
  normalizeEndpointV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/v11/types';

const DEFAULT_RUNTIME_CONFIG = {
  schemaVersion: 1,
  grpcAddr: '127.0.0.1:46371',
  httpAddr: '127.0.0.1:46372',
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

/**
 * Extract local runtime endpoint from bridge config.
 * Connectors are no longer managed via bridge config — they come from SDK.
 */
export function applyRuntimeBridgeConfigToState(
  state: RuntimeConfigStateV11,
  runtimeConfigRaw: Record<string, unknown>,
): RuntimeConfigStateV11 {
  const providers = asRecord(asRecord(runtimeConfigRaw).providers);
  const localProvider = asRecord(providers.local);
  const nextLocalEndpoint = readString(localProvider.baseUrl)
    ? normalizeEndpointV11(readString(localProvider.baseUrl), DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11)
    : state.localRuntime.endpoint;

  return {
    ...state,
    localRuntime: {
      ...state.localRuntime,
      endpoint: nextLocalEndpoint,
    },
  };
}

/**
 * Build runtime bridge config from state.
 * Only persists local runtime endpoint and preserves existing config fields.
 * Cloud provider/connector data is managed by Go runtime connector store.
 */
export function buildRuntimeBridgeConfigFromState(
  state: RuntimeConfigStateV11,
  baseConfigRaw: Record<string, unknown>,
): Record<string, unknown> {
  const configRecord = JSON.parse(JSON.stringify(baseConfigRaw)) as Record<string, unknown>;
  configRecord.schemaVersion = DEFAULT_RUNTIME_CONFIG.schemaVersion;
  configRecord.grpcAddr = readString(configRecord.grpcAddr as string) || DEFAULT_RUNTIME_CONFIG.grpcAddr;
  configRecord.httpAddr = readString(configRecord.httpAddr as string) || DEFAULT_RUNTIME_CONFIG.httpAddr;

  const existingProviders = asRecord(configRecord.providers);
  const localEndpoint = normalizeEndpointV11(state.localRuntime.endpoint, DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11);

  // Only update the local provider entry; preserve all other provider entries
  // as they are managed by the Go runtime (config.json providers → connector store).
  const localProvider = asRecord(existingProviders.local);
  existingProviders.local = {
    baseUrl: localEndpoint,
    apiKeyEnv: readString(localProvider.apiKeyEnv) || 'LOCALAI_API_KEY',
  };
  configRecord.providers = existingProviders;

  return configRecord;
}

/**
 * Serialize a projection for dirty-checking whether bridge config needs saving.
 * Only tracks local endpoint since connectors are managed by runtime.
 */
export function serializeRuntimeBridgeProjection(state: RuntimeConfigStateV11): string {
  return JSON.stringify({
    localEndpoint: normalizeEndpointV11(state.localRuntime.endpoint, DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11),
  });
}
