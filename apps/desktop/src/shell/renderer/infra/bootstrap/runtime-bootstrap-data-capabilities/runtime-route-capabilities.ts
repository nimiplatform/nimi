import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { resolveRuntimeCapabilityConfigFromStateV11 } from '@renderer/features/runtime-config/state/runtime-route-resolver-v11';
import { createDefaultStateV11 } from '@renderer/features/runtime-config/state/v11/storage/defaults';
import {
  type RuntimeConfigStateV11,
  normalizeCapabilityV11,
  normalizeSourceV11,
} from '@renderer/features/runtime-config/state/v11/types';
import { applyRuntimeBridgeConfigToState } from '@renderer/features/runtime-config/runtime-bridge-config';
import { localAiRuntime } from '@runtime/local-ai-runtime';
import { logRendererEvent } from '@nimiplatform/sdk/mod/logging';
import {
  WORLD_DATA_API_CAPABILITIES,
  hydrateModelProfilesByTemplate,
  hydrateConnectorModels,
  toRecord,
} from '../runtime-bootstrap-utils';
import { registerCoreDataCapability } from './shared';

function safeLogRuntimeRouteOptionsQuery(payload: Parameters<typeof logRendererEvent>[0]): void {
  try {
    logRendererEvent(payload);
  } catch {
    // Diagnostics logging must not affect runtime-route options response.
  }
}

function normalizeCapability(value: unknown): 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | null {
  const normalized = String(value || '').trim();
  if (
    normalized === 'chat'
    || normalized === 'image'
    || normalized === 'video'
    || normalized === 'tts'
    || normalized === 'stt'
    || normalized === 'embedding'
  ) {
    return normalized;
  }
  return null;
}

type HydratedConnectorModels = Awaited<ReturnType<typeof hydrateConnectorModels>>;

function toHydrationFallbackPayload(models: string[]): HydratedConnectorModels {
  const uniqueModels = Array.from(new Set(models.map((item) => String(item || '').trim()).filter(Boolean)));
  return {
    models: uniqueModels,
    modelProfiles: hydrateModelProfilesByTemplate(uniqueModels),
  };
}

async function hydrateConnectorModelsWithTimeout(input: {
  connectorId: string;
  vendor: string;
  endpoint: string;
  models: string[];
}, timeoutMs: number): Promise<{ payload: HydratedConnectorModels; timedOut: boolean }> {
  const fallback = toHydrationFallbackPayload(input.models);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const winner = await Promise.race<{ payload: HydratedConnectorModels; timedOut: boolean }>([
      (async () => {
        try {
          const payload = await hydrateConnectorModels(input);
          return { payload, timedOut: false };
        } catch {
          return { payload: fallback, timedOut: false };
        }
      })(),
      new Promise<{ payload: HydratedConnectorModels; timedOut: boolean }>((resolve) => {
        timer = setTimeout(() => {
          resolve({ payload: fallback, timedOut: true });
        }, timeoutMs);
      }),
    ]);
    return winner;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function mergeLocalRuntimeModels(input: {
  stateModels: Array<{
    localModelId: string;
    engine: string;
    model: string;
    endpoint: string;
    capabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding'>;
    status: 'installed' | 'active' | 'unhealthy' | 'removed';
  }>;
  snapshotModels: Array<{
    localModelId: string;
    engine: string;
    model: string;
    endpoint: string;
    capabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding'>;
    status: 'installed' | 'active' | 'unhealthy' | 'removed';
  }>;
}) {
  const byId = new Map<string, (typeof input.stateModels)[number]>();
  for (const model of input.stateModels) {
    byId.set(String(model.localModelId || '').trim(), model);
  }
  for (const model of input.snapshotModels) {
    byId.set(String(model.localModelId || '').trim(), model);
  }
  return [...byId.values()].filter((item) => item.status !== 'removed');
}

const BRIDGE_CONFIG_QUERY_TIMEOUT_MS = 1200;
const LOCAL_RUNTIME_SNAPSHOT_TIMEOUT_MS = 1200;

async function mergeRuntimeBridgeConfigIntoState(
  state: RuntimeConfigStateV11,
): Promise<{ state: RuntimeConfigStateV11; merged: boolean; error: string | null }> {
  if (!desktopBridge.hasTauriInvoke()) {
    return { state, merged: false, error: null };
  }
  try {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const result = await Promise.race([
      desktopBridge.getRuntimeBridgeConfig(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`runtime bridge config get timeout (${BRIDGE_CONFIG_QUERY_TIMEOUT_MS}ms)`));
        }, BRIDGE_CONFIG_QUERY_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });
    const config = toRecord(toRecord(result).config);
    return {
      state: applyRuntimeBridgeConfigToState(state, config),
      merged: true,
      error: null,
    };
  } catch (error) {
    return {
      state,
      merged: false,
      error: error instanceof Error ? error.message : String(error || ''),
    };
  }
}

async function pollLocalRuntimeSnapshotWithTimeout(): Promise<{
  models: Array<{
    localModelId: string;
    engine: string;
    modelId: string;
    endpoint: string;
    capabilities: string[];
    status: 'installed' | 'active' | 'unhealthy' | 'removed';
  }>;
  health: Array<unknown>;
  generatedAt: string;
}> {
  const fallback = {
    models: [],
    health: [],
    generatedAt: new Date().toISOString(),
  };
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      localAiRuntime.pollSnapshot().catch(() => fallback),
      new Promise<typeof fallback>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve(fallback);
        }, LOCAL_RUNTIME_SNAPSHOT_TIMEOUT_MS);
      }),
    ]);
    return result;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function registerRuntimeRouteDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.runtimeRouteOptions, async (query) => {
    const payload = toRecord(query);
    const capability = normalizeCapabilityV11(payload.capability);
    const modId = String(payload.modId || '').trim();
    const runtime = useAppStore.getState().runtimeFields;
    const seed = {
      provider: runtime.provider,
      runtimeModelType: runtime.runtimeModelType,
      localProviderEndpoint: runtime.localProviderEndpoint,
      localProviderModel: runtime.localProviderModel,
      localOpenAiEndpoint: runtime.localOpenAiEndpoint,
      connectorId: runtime.connectorId,
    };
    const bridgeMergedState = await mergeRuntimeBridgeConfigIntoState(createDefaultStateV11(seed));
    if (!bridgeMergedState.merged) {
      throw new Error(bridgeMergedState.error || 'runtime bridge config unavailable');
    }
    const state = bridgeMergedState.state;
    const resolved = resolveRuntimeCapabilityConfigFromStateV11(state, seed, capability, { modId: modId || undefined });
    const localSnapshot = await pollLocalRuntimeSnapshotWithTimeout();

    const selected = {
      source: normalizeSourceV11(resolved.source),
      connectorId: String(resolved.connectorId || ''),
      model: String(resolved.model || ''),
      localModelId: String(resolved.source === 'local-runtime' ? resolved.localModelId : ''),
      engine: String(resolved.source === 'local-runtime' ? resolved.engine : ''),
    };
    const resolvedDefault = { ...selected };

    safeLogRuntimeRouteOptionsQuery({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'action:runtime-route-options:query:start',
      details: {
        capability,
        modId: modId || null,
        selectedSource: selected.source,
        selectedConnectorId: selected.connectorId || null,
        selectedModel: selected.model || null,
        bridgeConfigMerged: bridgeMergedState.merged,
        bridgeConfigMergeError: bridgeMergedState.error,
        stateConnectorsCount: state.connectors.length,
        stateConnectorIds: state.connectors.map((item) => String(item.id || '')),
      },
    });

    const hydratedConnectors = await Promise.all(state.connectors.map(async (connector) => {
      const hydrated = await hydrateConnectorModelsWithTimeout({
        connectorId: connector.id,
        vendor: String(connector.vendor || ''),
        endpoint: connector.endpoint,
        models: [...connector.models],
      }, 1800);

      if (hydrated.timedOut) {
        safeLogRuntimeRouteOptionsQuery({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'action:runtime-route-options:connector-hydration-timeout',
          details: {
            capability,
            modId: modId || null,
            connectorId: connector.id,
            vendor: connector.vendor,
            endpoint: connector.endpoint,
            fallbackModelsCount: hydrated.payload.models.length,
          },
        });
      }

      return {
        id: connector.id,
        label: connector.label,
        vendor: connector.vendor,
        endpoint: connector.endpoint,
        ...hydrated.payload,
        status: connector.status,
      };
    }));
    const connectors = hydratedConnectors;

    const snapshotModels = localSnapshot.models.map((item) => ({
      localModelId: item.localModelId,
      engine: item.engine,
      model: item.modelId,
      endpoint: item.endpoint,
      capabilities: item.capabilities
        .map((itemCapability) => normalizeCapability(itemCapability))
        .filter((itemCapability): itemCapability is 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' => Boolean(itemCapability)),
      status: item.status,
    }));
    const mergedLocalRuntimeModels = mergeLocalRuntimeModels({
      stateModels: state.localRuntime.models,
      snapshotModels,
    });

    const response = {
      capability,
      modId: modId || null,
      selected,
      resolvedDefault,
      localRuntime: {
        endpoint: state.localRuntime.endpoint,
        models: mergedLocalRuntimeModels.map((item) => ({
          ...item,
          modelProfiles: hydrateModelProfilesByTemplate([item.model]),
        })),
      },
      connectors,
    };
    safeLogRuntimeRouteOptionsQuery({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'action:runtime-route-options:query:done',
      details: {
        capability,
        modId: modId || null,
        selectedSource: selected.source,
        selectedConnectorId: selected.connectorId || null,
        selectedModel: selected.model || null,
        connectorsCount: connectors.length,
        connectorIds: connectors.map((item) => String(item.id || '')),
      },
    });
    return response;
  });
}
