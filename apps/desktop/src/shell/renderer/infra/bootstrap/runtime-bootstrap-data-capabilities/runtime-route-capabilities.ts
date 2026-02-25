import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { resolveRuntimeCapabilityConfigFromStateV11 } from '@renderer/features/runtime-config/state/runtime-route-resolver-v11';
import { loadRuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/v11/storage';
import {
  normalizeCapabilityV11,
  normalizeSourceV11,
} from '@renderer/features/runtime-config/state/v11/types';
import { localAiRuntime } from '@runtime/local-ai-runtime';
import {
  WORLD_DATA_API_CAPABILITIES,
  hydrateModelProfilesByTemplate,
  hydrateConnectorModels,
  toRecord,
} from '../runtime-bootstrap-utils';
import { registerCoreDataCapability } from './shared';

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
      localOpenAiApiKey: runtime.localOpenAiApiKey,
    };
    const state = loadRuntimeConfigStateV11(seed);
    const resolved = resolveRuntimeCapabilityConfigFromStateV11(state, seed, capability, { modId: modId || undefined });
    const localSnapshot = await localAiRuntime.pollSnapshot();

    const selected = {
      source: normalizeSourceV11(resolved.source),
      connectorId: String(resolved.connectorId || ''),
      model: String(resolved.model || ''),
      localModelId: String(resolved.source === 'local-runtime' ? resolved.localModelId : ''),
      engine: String(resolved.source === 'local-runtime' ? resolved.engine : ''),
    };
    const resolvedDefault = { ...selected };

    const connectors = await Promise.all(state.connectors.map(async (connector) => ({
      id: connector.id,
      label: connector.label,
      vendor: connector.vendor,
      endpoint: connector.endpoint,
      ...(await hydrateConnectorModels({
        connectorId: connector.id,
        vendor: String(connector.vendor || ''),
        endpoint: connector.endpoint,
        tokenApiKey: connector.tokenApiKey,
        models: [...connector.models],
      })),
      status: connector.status,
    })));

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

    return {
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
  });
}
