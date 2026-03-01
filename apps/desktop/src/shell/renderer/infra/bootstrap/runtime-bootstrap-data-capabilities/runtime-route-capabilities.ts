import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  normalizeCapabilityV11,
  normalizeSourceV11,
} from '@renderer/features/runtime-config/state/v11/types';
import { localAiRuntime } from '@runtime/local-ai-runtime';
import { logRendererEvent } from '@nimiplatform/sdk/mod/logging';
import {
  WORLD_DATA_API_CAPABILITIES,
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

function inferSource(provider: string): 'local-runtime' | 'token-api' {
  const lower = String(provider || '').trim().toLowerCase();
  if (lower.startsWith('local-runtime') || lower === 'localai' || lower === 'nexa') {
    return 'local-runtime';
  }
  return 'token-api';
}

const LOCAL_RUNTIME_SNAPSHOT_TIMEOUT_MS = 1200;

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

async function listConnectorModelsFromSdk(connectorId: string): Promise<string[]> {
  try {
    const { sdkListConnectorModels } = await import(
      '@renderer/features/runtime-config/domain/provider-connectors/connector-sdk-service'
    );
    return await sdkListConnectorModels(connectorId, true);
  } catch {
    return [];
  }
}

export async function registerRuntimeRouteDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.runtimeRouteOptions, async (query) => {
    const payload = toRecord(query);
    const capability = normalizeCapabilityV11(payload.capability);
    const modId = String(payload.modId || '').trim();
    const runtime = useAppStore.getState().runtimeFields;
    const source = inferSource(runtime.provider);

    safeLogRuntimeRouteOptionsQuery({
      level: 'debug',
      area: 'renderer-bootstrap',
      message: 'action:runtime-route-options:query:start',
      details: {
        capability,
        modId: modId || null,
        selectedSource: source,
        selectedConnectorId: runtime.connectorId || null,
      },
    });

    const selected = {
      source: normalizeSourceV11(source),
      connectorId: String(runtime.connectorId || ''),
      model: String(runtime.localProviderModel || ''),
      localModelId: source === 'local-runtime' ? String(runtime.localProviderModel || '') : '',
      engine: source === 'local-runtime' ? 'localai' : '',
    };
    const resolvedDefault = { ...selected };

    // Load connectors from SDK
    let connectors: Array<{
      id: string;
      label: string;
      vendor: string;
      endpoint: string;
      models: string[];
      status: string;
    }> = [];
    try {
      const { sdkListConnectors } = await import(
        '@renderer/features/runtime-config/domain/provider-connectors/connector-sdk-service'
      );
      const sdkConnectors = await sdkListConnectors();
      connectors = await Promise.all(sdkConnectors.map(async (connector) => {
        const sdkModels = await listConnectorModelsFromSdk(connector.id);
        return {
          id: connector.id,
          label: connector.label || '',
          vendor: connector.vendor || '',
          endpoint: connector.endpoint || '',
          models: sdkModels.length > 0 ? sdkModels : connector.models || [],
          modelProfiles: [],
          status: connector.status || 'idle',
        };
      }));
    } catch { /* SDK unavailable */ }

    // Load local runtime snapshot
    const localSnapshot = await pollLocalRuntimeSnapshotWithTimeout();
    const snapshotModels = localSnapshot.models
      .filter((item) => item.status !== 'removed')
      .map((item) => ({
        localModelId: item.localModelId,
        engine: item.engine,
        model: item.modelId,
        endpoint: item.endpoint,
        capabilities: item.capabilities
          .map((c) => normalizeCapability(c))
          .filter((c): c is 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' => Boolean(c)),
        status: item.status,
      }));

    const response = {
      capability,
      modId: modId || null,
      selected,
      resolvedDefault,
      localRuntime: {
        endpoint: runtime.localProviderEndpoint || 'http://127.0.0.1:1234/v1',
        models: snapshotModels.map((item) => ({
          ...item,
          modelProfiles: [],
        })),
      },
      connectors,
    };

    safeLogRuntimeRouteOptionsQuery({
      level: 'debug',
      area: 'renderer-bootstrap',
      message: 'action:runtime-route-options:query:done',
      details: {
        capability,
        modId: modId || null,
        selectedSource: selected.source,
        connectorsCount: connectors.length,
      },
    });

    return response;
  });
}
