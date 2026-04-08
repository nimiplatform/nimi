/**
 * AI Config Store — Forge
 *
 * Persists user's AI route selections per capability using AIConfig (FG-ROUTE-004).
 * All stable capabilities store typed RuntimeRouteBinding in
 * AIConfig.capabilities.selectedBindings.
 */

import { create } from 'zustand';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createEmptyAIConfig,
  type AIConfig,
  type AIScopeRef,
} from '@nimiplatform/sdk/mod';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Forge UI capability keys. */
export type ForgeAiCapability = 'text' | 'image' | 'music';

/** Mapping from Forge UI keys to canonical runtime capability tokens. */
const CAPABILITY_MAP: Record<ForgeAiCapability, string> = {
  text: 'text.generate',
  image: 'image.generate',
  music: 'music.generate',
};

/** Forge AIScopeRef per FG-ROUTE-004. */
const FORGE_SCOPE_REF: AIScopeRef = {
  kind: 'app',
  ownerId: 'forge',
  surfaceId: 'settings',
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'nimi.forge.ai-config.v2';
const LEGACY_STORAGE_KEY = 'nimi:forge:ai-config';

function createDefaultAIConfigForForge(): AIConfig {
  return createEmptyAIConfig(FORGE_SCOPE_REF);
}

function migrateLegacySelections(): AIConfig | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Record<string, { connectorId?: string; model?: string; route?: string }>;
    const aiConfig = createDefaultAIConfigForForge();

    for (const [forgeKey, canonicalCap] of [
      ['text', 'text.generate'],
      ['image', 'image.generate'],
      ['music', 'music.generate'],
    ] as const) {
      const old = parsed[forgeKey];
      if (old && old.model && old.model !== 'auto') {
        const source: 'local' | 'cloud' = old.route === 'cloud' ? 'cloud' : 'local';
        aiConfig.capabilities.selectedBindings[canonicalCap] = {
          source,
          connectorId: old.connectorId || '',
          model: old.model,
        };
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(aiConfig));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return aiConfig;
  } catch {
    return null;
  }
}

function migrateV1DeferredSelections(stored: any): AIConfig | null {
  // Migrate from the intermediate v1 format that had deferredSelections
  try {
    if (!stored || typeof stored !== 'object') return null;
    if (!stored.deferredSelections || typeof stored.deferredSelections !== 'object') return null;
    const deferred = stored.deferredSelections['audio.generate'];
    if (!deferred || !deferred.model) return null;

    const aiConfig: AIConfig = stored.aiConfig && typeof stored.aiConfig === 'object'
      ? { ...createDefaultAIConfigForForge(), ...stored.aiConfig }
      : createDefaultAIConfigForForge();

    // Move deferred audio.generate selection to canonical music.generate in AIConfig
    aiConfig.capabilities.selectedBindings['music.generate'] = {
      source: deferred.source || 'local',
      connectorId: deferred.connectorId || '',
      model: deferred.model,
    };

    // Persist clean format (no deferredSelections)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(aiConfig));
    return aiConfig;
  } catch {
    return null;
  }
}

function loadPersistedAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);

      // Check if this is the intermediate format with deferredSelections
      if (parsed && typeof parsed === 'object' && 'deferredSelections' in parsed) {
        const migrated = migrateV1DeferredSelections(parsed);
        if (migrated) return migrated;
        // Fall through to extract aiConfig from wrapper
        if (parsed.aiConfig && typeof parsed.aiConfig === 'object') {
          const clean = { ...createDefaultAIConfigForForge(), ...parsed.aiConfig };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
          return clean;
        }
      }

      // Clean v2 format — AIConfig stored directly
      if (parsed && typeof parsed === 'object' && 'scopeRef' in parsed) {
        return { ...createDefaultAIConfigForForge(), ...parsed };
      }
    }
  } catch {
    // ignore corrupt data
  }

  // Try legacy migration
  const migrated = migrateLegacySelections();
  if (migrated) return migrated;

  return createDefaultAIConfigForForge();
}

function persistAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface AiConfigStore {
  /** Canonical AI configuration (FG-ROUTE-004). */
  aiConfig: AIConfig;

  /** Runtime daemon status. */
  runtimeStatus: 'unknown' | 'connected' | 'unavailable';
  error: string | null;

  /** Set a capability binding in AIConfig. */
  setCapabilityBinding(capability: string, binding: RuntimeRouteBinding | null): void;

  /** High-level setter from picker: maps Forge UI key to canonical capability. */
  setSelection(forgeCapability: ForgeAiCapability, input: {
    source: 'local' | 'cloud';
    connectorId: string;
    model: string;
    modelLabel?: string;
  }): void;

  /** Get current binding for a capability. */
  getBinding(capability: string): RuntimeRouteBinding | null | undefined;

  /** Check runtime daemon health. */
  checkRuntimeStatus(): Promise<void>;

  /** Reset all selections to defaults. */
  resetToDefaults(): void;
}

export const useAiConfigStore = create<AiConfigStore>((set, get) => {
  const initial = loadPersistedAIConfig();

  return {
    aiConfig: initial,
    runtimeStatus: 'unknown',
    error: null,

    setCapabilityBinding(capability, binding) {
      const current = get();
      const aiConfig: AIConfig = {
        ...current.aiConfig,
        capabilities: {
          ...current.aiConfig.capabilities,
          selectedBindings: {
            ...current.aiConfig.capabilities.selectedBindings,
            [capability]: binding,
          },
        },
      };
      set({ aiConfig });
      persistAIConfig(aiConfig);
    },

    setSelection(forgeCapability, input) {
      const canonicalCap = CAPABILITY_MAP[forgeCapability];
      const binding: RuntimeRouteBinding = {
        source: input.source,
        connectorId: input.connectorId,
        model: input.model,
        modelLabel: input.modelLabel,
      };
      get().setCapabilityBinding(canonicalCap, binding);
    },

    getBinding(capability) {
      return get().aiConfig.capabilities.selectedBindings[capability];
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
      const aiConfig = createDefaultAIConfigForForge();
      set({ aiConfig });
      persistAIConfig(aiConfig);
    },
  };
});

// Re-export for convenience
export { CAPABILITY_MAP, FORGE_SCOPE_REF };
