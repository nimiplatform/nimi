import type { AIScopeRef, RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';
import type { CapabilityId } from './tester-types.js';

export const TESTER_AI_SCOPE_REF: AIScopeRef = {
  kind: 'app',
  ownerId: 'desktop',
  surfaceId: 'tester',
};

export function createEmptyTesterAIConfig(): AIConfig {
  return createEmptyAIConfig(TESTER_AI_SCOPE_REF);
}

export function bindingFromTesterConfig(config: AIConfig, capabilityId: CapabilityId): RuntimeRouteBinding | null {
  if (capabilityId === 'image.create-job') {
    return (config.capabilities.selectedBindings['image.generate'] || null) as RuntimeRouteBinding | null;
  }
  if (capabilityId === 'video.create-job') {
    return (config.capabilities.selectedBindings['video.generate'] || null) as RuntimeRouteBinding | null;
  }
  if (capabilityId === 'text.stream') {
    return (config.capabilities.selectedBindings['text.generate'] || null) as RuntimeRouteBinding | null;
  }
  return (config.capabilities.selectedBindings[capabilityId] || null) as RuntimeRouteBinding | null;
}

// Legacy capability keys that must be renamed in persisted AIConfig storage
// before runtime consumers read. Wave 3 cutover — no dual-read, no alias.
const TESTER_LEGACY_CAPABILITY_KEY_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['voice.clone', 'voice_workflow.tts_v2v'],
  ['voice.design', 'voice_workflow.tts_t2v'],
];

function renameKeysOnce<T>(
  record: Readonly<Partial<Record<string, T>>> | undefined,
): { changed: boolean; next: Partial<Record<string, T>> } {
  const source = record || {};
  let changed = false;
  const next: Partial<Record<string, T>> = { ...source };
  for (const [legacy, canonical] of TESTER_LEGACY_CAPABILITY_KEY_RENAMES) {
    if (Object.prototype.hasOwnProperty.call(next, legacy)) {
      // If both keys exist the canonical key wins (legacy is stale).
      if (!Object.prototype.hasOwnProperty.call(next, canonical)) {
        next[canonical] = next[legacy];
      }
      delete next[legacy];
      changed = true;
    }
  }
  return { changed, next };
}

/**
 * One-shot idempotent remap of tester AIConfig capability-key legacy aliases
 * to canonical ids. Scoped exclusively to TESTER_AI_SCOPE_REF callers (see
 * bootstrapTesterAIConfigScope). Fails closed: input must be a shaped AIConfig;
 * if it is not, we return it unchanged because any persistence layer above is
 * responsible for type validation.
 *
 * Returns the same AIConfig reference when no legacy keys are present
 * (guarantees downstream diff-free re-runs).
 */
export function migrateTesterLegacyCapabilityKeys(config: AIConfig): AIConfig {
  const bindings = renameKeysOnce(config.capabilities.selectedBindings);
  const params = renameKeysOnce(config.capabilities.selectedParams);
  if (!bindings.changed && !params.changed) {
    return config;
  }
  return {
    ...config,
    capabilities: {
      ...config.capabilities,
      selectedBindings: bindings.next,
      selectedParams: params.next,
    },
  };
}

export interface TesterAIConfigBootstrapSurface {
  readonly aiConfig: {
    get(scope: AIScopeRef): AIConfig;
    update(scope: AIScopeRef, next: AIConfig): void;
  };
}

/**
 * Bootstrap-time remap for TESTER_AI_SCOPE_REF. Reads the persisted AIConfig,
 * applies the legacy-key remap, and writes it back iff changed. Fail-close:
 * a persistence error propagates (no swallow, no placeholder success).
 */
export function bootstrapTesterAIConfigScope(surface: TesterAIConfigBootstrapSurface): AIConfig {
  const current = surface.aiConfig.get(TESTER_AI_SCOPE_REF);
  const next = migrateTesterLegacyCapabilityKeys(current);
  if (next !== current) {
    surface.aiConfig.update(TESTER_AI_SCOPE_REF, next);
  }
  return next;
}
