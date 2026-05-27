import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  buildRuntimeBridgeConfigWithLocalEndpoint,
  projectRuntimeBridgeLocalEndpoint,
  serializeRuntimeBridgeLocalEndpointProjection,
} from '@nimiplatform/sdk/runtime';
import type { JsonObject } from '@runtime/net/json';

/**
 * Extract local runtime endpoint from bridge config.
 * Runtime config schema projection is owned by the SDK helper.
 * Connectors are no longer managed via bridge config; they come from SDK.
 */
export function applyRuntimeBridgeConfigToState(
  state: RuntimeConfigStateV11,
  runtimeConfigRaw: JsonObject,
): RuntimeConfigStateV11 {
  const endpointFromConfig = projectRuntimeBridgeLocalEndpoint(runtimeConfigRaw);
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
  return buildRuntimeBridgeConfigWithLocalEndpoint(baseConfigRaw, state.local.endpoint);
}

/**
 * Serialize a projection for dirty-checking whether bridge config needs saving.
 * Only tracks local endpoint since connectors are managed by runtime.
 */
export function serializeRuntimeBridgeProjection(state: RuntimeConfigStateV11): string {
  return serializeRuntimeBridgeLocalEndpointProjection(state.local.endpoint);
}
