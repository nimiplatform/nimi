// RL-IPC-010 — Model Service IPC
// RL-IPC-011 — Local Runtime IPC
// RL-IPC-012 — Connector IPC
// All handlers are SDK passthrough — no agentId required (not agent-scoped)

import type { PlatformClient } from '@nimiplatform/sdk';
import { toIpcError } from './error-utils.js';
import { safeHandle } from './ipc-utils.js';

export function registerModelIpcHandlers(runtime: PlatformClient['runtime']): void {
  // ── Model Service (RL-IPC-010) ──────────────────────────────────────

  safeHandle('relay:model:list', async (_e, input) => {
    try {
      return await runtime.model.list(input ?? {});
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:model:pull', async (_e, input) => {
    try {
      return await runtime.model.pull(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:model:remove', async (_e, input) => {
    try {
      return await runtime.model.remove(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:model:health', async (_e, input) => {
    try {
      return await runtime.model.checkHealth(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  // ── Local Runtime (RL-IPC-011) ──────────────────────────────────────

  safeHandle('relay:local:assets:list', async (_e, input) => {
    try {
      return await runtime.local.listLocalAssets(input ?? {});
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:verified', async (_e, input) => {
    try {
      return await runtime.local.listVerifiedAssets(input ?? {});
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:catalog-search', async (_e, input) => {
    try {
      return await runtime.local.searchCatalogModels(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:install-plan', async (_e, input) => {
    try {
      return await runtime.local.resolveModelInstallPlan(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:install', async (_e, input) => {
    try {
      return await runtime.local.installVerifiedAsset(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:install-verified', async (_e, input) => {
    try {
      return await runtime.local.installVerifiedAsset(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:import', async (_e, input) => {
    try {
      return await runtime.local.importLocalAsset(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:remove', async (_e, input) => {
    try {
      return await runtime.local.removeLocalAsset(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:start', async (_e, input) => {
    try {
      return await runtime.local.startLocalAsset(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:stop', async (_e, input) => {
    try {
      return await runtime.local.stopLocalAsset(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:health', async (_e, input) => {
    try {
      return await runtime.local.checkLocalAssetHealth(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:assets:warm', async (_e, input) => {
    try {
      return await runtime.local.warmLocalAsset(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:device-profile', async (_e, input) => {
    try {
      return await runtime.local.collectDeviceProfile(input ?? {});
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:profile:resolve', async (_e, input) => {
    try {
      return await runtime.local.resolveProfile(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:local:catalog:nodes', async (_e, input) => {
    try {
      return await runtime.local.listNodeCatalog(input ?? {});
    } catch (error) {
      throw toIpcError(error);
    }
  });

  // ── Connector (RL-IPC-012) ──────────────────────────────────────────

  safeHandle('relay:connector:create', async (_e, input) => {
    try {
      return await runtime.connector.createConnector(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:get', async (_e, input) => {
    try {
      return await runtime.connector.getConnector(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:list', async (_e, input) => {
    try {
      return await runtime.connector.listConnectors(input ?? {});
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:update', async (_e, input) => {
    try {
      return await runtime.connector.updateConnector(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:delete', async (_e, input) => {
    try {
      return await runtime.connector.deleteConnector(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:test', async (_e, input) => {
    try {
      return await runtime.connector.testConnector(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:models', async (_e, input) => {
    try {
      return await runtime.connector.listConnectorModels(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:provider-catalog', async (_e, input) => {
    try {
      return await runtime.connector.listProviderCatalog(input ?? {});
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:catalog-providers', async (_e, input) => {
    try {
      return await runtime.connector.listModelCatalogProviders(input ?? {});
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:catalog-provider-models', async (_e, input) => {
    try {
      return await runtime.connector.listCatalogProviderModels(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:catalog-model-detail', async (_e, input) => {
    try {
      return await runtime.connector.getCatalogModelDetail(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:catalog-provider:upsert', async (_e, input) => {
    try {
      return await runtime.connector.upsertModelCatalogProvider(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:catalog-provider:delete', async (_e, input) => {
    try {
      return await runtime.connector.deleteModelCatalogProvider(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:catalog-overlay:upsert', async (_e, input) => {
    try {
      return await runtime.connector.upsertCatalogModelOverlay(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:connector:catalog-overlay:delete', async (_e, input) => {
    try {
      return await runtime.connector.deleteCatalogModelOverlay(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });
}
