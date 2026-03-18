// RL-IPC-010 — Model Service IPC
// RL-IPC-011 — Local Runtime IPC
// RL-IPC-012 — Connector IPC
// All handlers are SDK passthrough — no agentId required (not agent-scoped)

import { ipcMain } from 'electron';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import { normalizeError } from './error-utils.js';

export function registerModelIpcHandlers(runtime: Runtime): void {
  // ── Model Service (RL-IPC-010) ──────────────────────────────────────

  ipcMain.handle('relay:model:list', async (_e, input) => {
    try {
      return await runtime.model.list(input ?? {});
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:model:pull', async (_e, input) => {
    try {
      return await runtime.model.pull(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:model:remove', async (_e, input) => {
    try {
      return await runtime.model.remove(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:model:health', async (_e, input) => {
    try {
      return await runtime.model.checkHealth(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  // ── Local Runtime (RL-IPC-011) ──────────────────────────────────────

  ipcMain.handle('relay:local:models:list', async (_e, input) => {
    try {
      return await runtime.local.listLocalModels(input ?? {});
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:verified', async (_e, input) => {
    try {
      return await runtime.local.listVerifiedModels(input ?? {});
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:catalog-search', async (_e, input) => {
    try {
      return await runtime.local.searchCatalogModels(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:install-plan', async (_e, input) => {
    try {
      return await runtime.local.resolveModelInstallPlan(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:install', async (_e, input) => {
    try {
      return await runtime.local.installLocalModel(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:install-verified', async (_e, input) => {
    try {
      return await runtime.local.installVerifiedModel(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:import', async (_e, input) => {
    try {
      return await runtime.local.importLocalModel(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:remove', async (_e, input) => {
    try {
      return await runtime.local.removeLocalModel(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:start', async (_e, input) => {
    try {
      return await runtime.local.startLocalModel(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:stop', async (_e, input) => {
    try {
      return await runtime.local.stopLocalModel(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:health', async (_e, input) => {
    try {
      return await runtime.local.checkLocalModelHealth(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:models:warm', async (_e, input) => {
    try {
      return await runtime.local.warmLocalModel(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:device-profile', async (_e, input) => {
    try {
      return await runtime.local.collectDeviceProfile(input ?? {});
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:profile:resolve', async (_e, input) => {
    try {
      return await runtime.local.resolveProfile(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:local:catalog:nodes', async (_e, input) => {
    try {
      return await runtime.local.listNodeCatalog(input ?? {});
    } catch (error) {
      throw normalizeError(error);
    }
  });

  // ── Connector (RL-IPC-012) ──────────────────────────────────────────

  ipcMain.handle('relay:connector:create', async (_e, input) => {
    try {
      return await runtime.connector.createConnector(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:get', async (_e, input) => {
    try {
      return await runtime.connector.getConnector(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:list', async (_e, input) => {
    try {
      return await runtime.connector.listConnectors(input ?? {});
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:update', async (_e, input) => {
    try {
      return await runtime.connector.updateConnector(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:delete', async (_e, input) => {
    try {
      return await runtime.connector.deleteConnector(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:test', async (_e, input) => {
    try {
      return await runtime.connector.testConnector(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:models', async (_e, input) => {
    try {
      return await runtime.connector.listConnectorModels(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:provider-catalog', async (_e, input) => {
    try {
      return await runtime.connector.listProviderCatalog(input ?? {});
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:catalog-providers', async (_e, input) => {
    try {
      return await runtime.connector.listModelCatalogProviders(input ?? {});
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:catalog-provider-models', async (_e, input) => {
    try {
      return await runtime.connector.listCatalogProviderModels(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:catalog-model-detail', async (_e, input) => {
    try {
      return await runtime.connector.getCatalogModelDetail(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:catalog-provider:upsert', async (_e, input) => {
    try {
      return await runtime.connector.upsertModelCatalogProvider(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:catalog-provider:delete', async (_e, input) => {
    try {
      return await runtime.connector.deleteModelCatalogProvider(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:catalog-overlay:upsert', async (_e, input) => {
    try {
      return await runtime.connector.upsertCatalogModelOverlay(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:connector:catalog-overlay:delete', async (_e, input) => {
    try {
      return await runtime.connector.deleteCatalogModelOverlay(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });
}
