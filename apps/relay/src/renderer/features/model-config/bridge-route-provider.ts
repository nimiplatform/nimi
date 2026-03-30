// Bridge-based RouteModelPickerDataProvider for Electron IPC
// Shared between ChatRoutePanel (settings drawer) and inline chat model picker.

import { getBridge } from '../../bridge/electron-bridge.js';
import type {
  RouteModelPickerDataProvider,
  RouteLocalModel,
} from '@nimiplatform/nimi-kit/features/model-picker/headless';

// ---------------------------------------------------------------------------
// Local model status mapping
// ---------------------------------------------------------------------------

type LocalModelStatusCode = 0 | 1 | 2 | 3 | 4;

const STATUS_MAP: Record<LocalModelStatusCode, RouteLocalModel['status']> = {
  0: 'unspecified',
  1: 'installed',
  2: 'active',
  3: 'unhealthy',
  4: 'removed',
};

const STATUS_RANK: Record<RouteLocalModel['status'], number> = {
  active: 0,
  installed: 1,
  unhealthy: 2,
  removed: 3,
  unspecified: 4,
};

function mapLocalStatus(raw: number): RouteLocalModel['status'] {
  return STATUS_MAP[raw as LocalModelStatusCode] ?? 'unspecified';
}

/**
 * Extracts a clean display name from a runtime model ID.
 * "local/local-import/Qwen3-4B-Q4_K_M" → "Qwen3-4B-Q4_K_M"
 * "gpt-4o" → "gpt-4o"
 */
function formatModelId(raw: string): string {
  const parts = raw.split('/');
  return parts.length > 1 ? parts[parts.length - 1]! : raw;
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function createBridgeRouteDataProvider(): RouteModelPickerDataProvider {
  return {
    async listLocalModels() {
      const bridge = getBridge();
      const response = await bridge.local.listModels({} as Parameters<typeof bridge.local.listModels>[0]);
      return (response.models || [])
        .map((m: any) => ({
          localModelId: m.localModelId as string,
          modelId: formatModelId(m.modelId as string),
          engine: (m.engine || 'llama') as string,
          status: mapLocalStatus(m.status as number),
          capabilities: [...(m.capabilities || [])] as string[],
        }))
        .sort((a: RouteLocalModel, b: RouteLocalModel) => {
          const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
          if (rankDiff !== 0) return rankDiff;
          return a.localModelId.localeCompare(b.localModelId);
        });
    },
    async listConnectors() {
      const bridge = getBridge();
      const response = await bridge.connector.list({} as Parameters<typeof bridge.connector.list>[0]);
      return (response.connectors || []).map((c: any) => ({
        connectorId: c.connectorId as string,
        provider: c.provider as string,
        label: (c.label || c.provider) as string,
        status: String(c.status),
      }));
    },
    async listConnectorModels(connectorId: string) {
      const bridge = getBridge();
      const response = await bridge.connector.listModels({ connectorId } as Parameters<typeof bridge.connector.listModels>[0]);
      return (response.models || []).map((m: any) => ({
        modelId: m.modelId as string,
        modelLabel: (m.modelLabel || m.modelId) as string,
        available: Boolean(m.available),
        capabilities: [...(m.capabilities || [])] as string[],
      }));
    },
  };
}
