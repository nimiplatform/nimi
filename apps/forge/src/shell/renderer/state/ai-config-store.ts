/**
 * AI Config Store
 *
 * Persists user's AI connector/model/route selections per capability.
 * Data fetching (local models, connectors) is handled by kit useRouteModelPickerData.
 * This store only manages selection persistence and runtime health status.
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

  // Runtime status
  runtimeStatus: 'unknown' | 'connected' | 'unavailable';
  error: string | null;

  // Actions
  setSelection(capability: ForgeAiCapability, selection: Partial<ForgeAiSelection>): void;
  checkRuntimeStatus(): Promise<void>;
  resetToDefaults(): void;
}

export const useAiConfigStore = create<AiConfigStore>((set, get) => ({
  selections: loadSelections(),

  runtimeStatus: 'unknown',
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
