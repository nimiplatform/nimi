/**
 * AI Config Store
 *
 * Persists user's AI connector/model/route selections per capability.
 * Runtime connector data is fetched on demand (not persisted).
 */

import { create } from 'zustand';
import { getPlatformClient } from '@nimiplatform/sdk';
import type { NimiRoutePolicy } from '@nimiplatform/sdk/runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ForgeAiCapability = 'text' | 'image' | 'music';

export type ForgeAiRoute = NimiRoutePolicy | 'auto';

export type ForgeAiSelection = {
  connectorId: string;   // '' = auto routing
  model: string;         // 'auto' = runtime decides
  route: ForgeAiRoute;   // 'auto' = no preference
};

/** Mirrors the subset of Connector fields we need for UI display. */
export type ForgeConnectorSummary = {
  connectorId: string;
  provider: string;
  label: string;
  status: string;
};

/** Mirrors ConnectorModelDescriptor from the runtime generated types. */
export type ForgeConnectorModel = {
  modelId: string;
  modelLabel: string;
  available: boolean;
  capabilities: string[];
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'nimi:forge:ai-config';
const ALL_CAPABILITIES: ForgeAiCapability[] = ['text', 'image', 'music'];

const DEFAULT_SELECTION: ForgeAiSelection = {
  connectorId: '',
  model: 'auto',
  route: 'auto',
};

function defaultSelections(): Record<ForgeAiCapability, ForgeAiSelection> {
  return {
    text: { ...DEFAULT_SELECTION },
    image: { ...DEFAULT_SELECTION },
    music: { ...DEFAULT_SELECTION },
  };
}

function loadSelections(): Record<ForgeAiCapability, ForgeAiSelection> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<ForgeAiCapability, Partial<ForgeAiSelection>>>;
      const result = defaultSelections();
      for (const cap of ALL_CAPABILITIES) {
        if (parsed[cap]) {
          result[cap] = { ...DEFAULT_SELECTION, ...parsed[cap] };
        }
      }
      return result;
    }
  } catch {
    // ignore corrupt data
  }
  return defaultSelections();
}

function saveSelections(selections: Record<ForgeAiCapability, ForgeAiSelection>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // ignore
  }
}

export interface AiConfigStore {
  // Persisted
  selections: Record<ForgeAiCapability, ForgeAiSelection>;

  // Runtime (not persisted)
  runtimeStatus: 'unknown' | 'connected' | 'unavailable';
  connectors: ForgeConnectorSummary[];
  connectorModels: Record<string, ForgeConnectorModel[]>; // keyed by connectorId
  loading: boolean;
  error: string | null;

  // Actions
  setSelection(capability: ForgeAiCapability, selection: Partial<ForgeAiSelection>): void;
  fetchConnectors(): Promise<void>;
  fetchConnectorModels(connectorId: string): Promise<void>;
  testConnector(connectorId: string): Promise<{ success: boolean; error?: string }>;
  checkRuntimeStatus(): Promise<void>;
  resetToDefaults(): void;
}

export const useAiConfigStore = create<AiConfigStore>((set, get) => ({
  selections: loadSelections(),

  runtimeStatus: 'unknown',
  connectors: [],
  connectorModels: {},
  loading: false,
  error: null,

  setSelection(capability, partial) {
    const current = get().selections;
    const updated = {
      ...current,
      [capability]: { ...current[capability], ...partial },
    };
    set({ selections: updated });
    saveSelections(updated);
  },

  async fetchConnectors() {
    set({ loading: true, error: null });
    try {
      const { runtime } = getPlatformClient();
      const response = await runtime.connector.listConnectors({
        pageSize: 100,
        pageToken: '',
        kindFilter: 0,     // UNSPECIFIED — no filter
        statusFilter: 0,   // UNSPECIFIED — no filter
        providerFilter: '',
      });
      const connectors: ForgeConnectorSummary[] = response.connectors.map((c) => ({
        connectorId: c.connectorId,
        provider: c.provider,
        label: c.label,
        status: String(c.status),
      }));
      set({ connectors, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch connectors', loading: false });
    }
  },

  async fetchConnectorModels(connectorId) {
    set({ loading: true, error: null });
    try {
      const { runtime } = getPlatformClient();
      const response = await runtime.connector.listConnectorModels({
        connectorId,
        forceRefresh: false,
        pageSize: 100,
        pageToken: '',
      });
      const models: ForgeConnectorModel[] = response.models.map((m) => ({
        modelId: m.modelId,
        modelLabel: m.modelLabel,
        available: m.available,
        capabilities: [...m.capabilities],
      }));
      set((state) => ({
        connectorModels: { ...state.connectorModels, [connectorId]: models },
        loading: false,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch models', loading: false });
    }
  },

  async testConnector(connectorId) {
    try {
      const { runtime } = getPlatformClient();
      await runtime.connector.testConnector({ connectorId });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Test failed' };
    }
  },

  async checkRuntimeStatus() {
    try {
      const { runtime } = getPlatformClient();
      const health = await runtime.health();
      set({ runtimeStatus: health.status === 'unavailable' ? 'unavailable' : 'connected' });
    } catch {
      set({ runtimeStatus: 'unavailable' });
    }
  },

  resetToDefaults() {
    const selections = defaultSelections();
    set({ selections });
    saveSelections(selections);
  },
}));
