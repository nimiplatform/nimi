// Route option aggregator — loads available local models + cloud connectors from runtime

import type { PlatformClient } from '@nimiplatform/sdk';
import type {
  RelayLocalModelOption,
  RelayConnectorOption,
  RelayRouteOptions,
  RelayRouteBinding,
} from './types.js';

const LOAD_TIMEOUT_MS = 3500;

type LocalModelStatus = 0 | 1 | 2 | 3 | 4;

const STATUS_MAP: Record<LocalModelStatus, RelayLocalModelOption['status']> = {
  0: 'unspecified',
  1: 'installed',
  2: 'active',
  3: 'unhealthy',
  4: 'removed',
};

const STATUS_RANK: Record<RelayLocalModelOption['status'], number> = {
  active: 0,
  installed: 1,
  unhealthy: 2,
  removed: 3,
  unspecified: 4,
};

function mapStatus(raw: number): RelayLocalModelOption['status'] {
  return STATUS_MAP[raw as LocalModelStatus] ?? 'unspecified';
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer!);
    return result;
  } catch {
    clearTimeout(timer!);
    return fallback;
  }
}

async function loadLocalModels(runtime: PlatformClient['runtime']): Promise<RelayLocalModelOption[]> {
  // Cast: protobuf request has required zero-value fields; SDK accepts partial input at runtime
  const response = await runtime.local.listLocalModels({} as Parameters<typeof runtime.local.listLocalModels>[0]);
  const models = response.models || [];
  return models
    .filter((m) => m.capabilities.includes('text.generate'))
    .map((m) => ({
      localModelId: m.localModelId,
      modelId: m.modelId,
      engine: m.engine || 'llama',
      status: mapStatus(m.status),
      capabilities: m.capabilities,
    }))
    .sort((a, b) => {
      const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rankDiff !== 0) return rankDiff;
      return a.localModelId.localeCompare(b.localModelId);
    });
}

async function loadConnectors(runtime: PlatformClient['runtime']): Promise<RelayConnectorOption[]> {
  const response = await runtime.connector.listConnectors({} as Parameters<typeof runtime.connector.listConnectors>[0]);
  const connectors = response.connectors || [];
  const results: RelayConnectorOption[] = [];

  for (const c of connectors) {
    try {
      const modelsResponse = await withTimeout(
        runtime.connector.listConnectorModels({ connectorId: c.connectorId } as Parameters<typeof runtime.connector.listConnectorModels>[0]),
        LOAD_TIMEOUT_MS,
        { models: [], nextPageToken: '' },
      );
      const models = (modelsResponse.models || [])
        .filter((m) => m.capabilities.includes('text.generate'))
        .map((m) => ({
          modelId: m.modelId,
          modelLabel: m.modelLabel,
          available: m.available,
          capabilities: m.capabilities,
        }));

      results.push({
        connectorId: c.connectorId,
        provider: c.provider,
        label: c.label || c.provider,
        status: String(c.status),
        models,
      });
    } catch {
      // Skip connectors that fail to load models
      results.push({
        connectorId: c.connectorId,
        provider: c.provider,
        label: c.label || c.provider,
        status: String(c.status),
        models: [],
      });
    }
  }

  return results;
}

export async function loadRouteOptions(
  runtime: PlatformClient['runtime'],
  currentBinding: RelayRouteBinding | null,
): Promise<RelayRouteOptions> {
  const [localModels, connectors] = await Promise.all([
    withTimeout(loadLocalModels(runtime), LOAD_TIMEOUT_MS, []),
    withTimeout(loadConnectors(runtime), LOAD_TIMEOUT_MS, []),
  ]);

  return {
    local: { models: localModels },
    connectors,
    selected: currentBinding,
  };
}
