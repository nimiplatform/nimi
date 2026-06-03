import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  buildRuntimeBridgeConfigWithLocalEndpoint,
  projectRuntimeBridgeLocalEndpoint,
} from '@nimiplatform/sdk/runtime';
import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

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

  return {
    ...state,
    local: {
      ...state.local,
      endpoint: endpointFromConfig,
    },
  };
}

/**
 * Build runtime bridge config from an explicit user-submitted endpoint.
 * The renderer state is not a config authority; it only displays the last
 * Runtime bridge projection and keeps unsaved input as component-local draft.
 */
export function buildRuntimeBridgeConfigFromLocalEndpoint(
  localEndpoint: string,
  baseConfigRaw: JsonObject,
): JsonObject {
  return buildRuntimeBridgeConfigWithLocalEndpoint(baseConfigRaw, localEndpoint);
}
