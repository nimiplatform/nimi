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
export type ForgeAiCapability = 'text' | 'image' | 'music' | 'tts' | 'voiceDesign';

/** Mapping from Forge UI keys to canonical runtime capability tokens. */
const CAPABILITY_MAP: Record<ForgeAiCapability, string> = {
  text: 'text.generate',
  image: 'image.generate',
  music: 'music.generate',
  tts: 'audio.synthesize',
  voiceDesign: 'voice_workflow.tts_t2v',
};

const CAPABILITY_ALIASES: Partial<Record<string, readonly string[]>> = {
  'audio.synthesize': ['tts.synthesize'],
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

function getCapabilityAliasList(capability: string): readonly string[] {
  return CAPABILITY_ALIASES[capability] ?? [];
}

function resolveStoredBinding(
  selectedBindings: AIConfig['capabilities']['selectedBindings'],
  capability: string,
): RuntimeRouteBinding | null | undefined {
  const directBinding = selectedBindings[capability];
  if (directBinding !== undefined) return directBinding;

  for (const alias of getCapabilityAliasList(capability)) {
    const aliasBinding = selectedBindings[alias];
    if (aliasBinding !== undefined) return aliasBinding;
  }

  return undefined;
}

function canonicalizeSelectedBindings(
  selectedBindings: AIConfig['capabilities']['selectedBindings'],
): AIConfig['capabilities']['selectedBindings'] {
  const nextBindings = { ...selectedBindings };
  const legacySpeechBinding = nextBindings['tts.synthesize'];
  if (nextBindings['audio.synthesize'] === undefined && legacySpeechBinding !== undefined) {
    nextBindings['audio.synthesize'] = legacySpeechBinding;
  }
  if ('tts.synthesize' in nextBindings) {
    delete nextBindings['tts.synthesize'];
  }
  return nextBindings;
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
      ['tts', 'audio.synthesize'],
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
      ? {
          ...createDefaultAIConfigForForge(),
          ...stored.aiConfig,
          capabilities: {
            ...createDefaultAIConfigForForge().capabilities,
            ...(stored.aiConfig.capabilities && typeof stored.aiConfig.capabilities === 'object'
              ? stored.aiConfig.capabilities
              : {}),
            selectedBindings: canonicalizeSelectedBindings(
              stored.aiConfig.capabilities?.selectedBindings && typeof stored.aiConfig.capabilities.selectedBindings === 'object'
                ? stored.aiConfig.capabilities.selectedBindings
                : {},
            ),
          },
        }
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
          const clean = {
            ...createDefaultAIConfigForForge(),
            ...parsed.aiConfig,
            capabilities: {
              ...createDefaultAIConfigForForge().capabilities,
              ...(parsed.aiConfig.capabilities && typeof parsed.aiConfig.capabilities === 'object'
                ? parsed.aiConfig.capabilities
                : {}),
              selectedBindings: canonicalizeSelectedBindings(
                parsed.aiConfig.capabilities?.selectedBindings && typeof parsed.aiConfig.capabilities.selectedBindings === 'object'
                  ? parsed.aiConfig.capabilities.selectedBindings
                  : {},
              ),
            },
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
          return clean;
        }
      }

      // Clean v2 format — AIConfig stored directly
      if (parsed && typeof parsed === 'object' && 'scopeRef' in parsed) {
        const normalized = {
          ...createDefaultAIConfigForForge(),
          ...parsed,
          capabilities: {
            ...createDefaultAIConfigForForge().capabilities,
            ...(parsed.capabilities && typeof parsed.capabilities === 'object' ? parsed.capabilities : {}),
            selectedBindings: canonicalizeSelectedBindings(
              parsed.capabilities?.selectedBindings && typeof parsed.capabilities.selectedBindings === 'object'
                ? parsed.capabilities.selectedBindings
                : {},
            ),
          },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...config,
      capabilities: {
        ...config.capabilities,
        selectedBindings: canonicalizeSelectedBindings(config.capabilities.selectedBindings),
      },
    }));
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
      const nextSelectedBindings = {
        ...current.aiConfig.capabilities.selectedBindings,
        [capability]: binding,
      };
      for (const alias of getCapabilityAliasList(capability)) {
        delete nextSelectedBindings[alias];
      }
      const aiConfig: AIConfig = {
        ...current.aiConfig,
        capabilities: {
          ...current.aiConfig.capabilities,
          selectedBindings: nextSelectedBindings,
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
      return resolveStoredBinding(get().aiConfig.capabilities.selectedBindings, capability);
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
export { CAPABILITY_MAP, FORGE_SCOPE_REF, resolveStoredBinding };
