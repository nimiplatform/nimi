/**
 * AI Config Resolution
 *
 * Resolves the user's AI selection into parameters suitable for runtime AI calls.
 * Speech reads use audio.synthesize canonically and accept legacy tts.synthesize as an alias.
 */

import {
  useAiConfigStore,
  CAPABILITY_MAP,
  resolveStoredBinding,
  type ForgeAiCapability,
} from '@renderer/state/ai-config-store.js';

export type ResolvedAiParams = {
  model: string;
  connectorId: string;
  source: 'local' | 'cloud' | undefined;
  /** Route policy for runtime SDK calls. Derived from source. */
  route: 'local' | 'cloud' | undefined;
};

/** Non-reactive — use outside React components (e.g. in createForgeAiClient). */
export function getResolvedAiParams(capability: ForgeAiCapability): ResolvedAiParams {
  const store = useAiConfigStore.getState();
  const canonicalCap = CAPABILITY_MAP[capability];
  const binding = resolveStoredBinding(store.aiConfig.capabilities.selectedBindings, canonicalCap);

  if (!binding || typeof binding !== 'object') {
    return { model: '', connectorId: '', source: undefined, route: undefined };
  }
  return {
    model: binding.model || '',
    connectorId: binding.connectorId || '',
    source: binding.source,
    route: binding.source,
  };
}

/** Reactive hook — use inside React components. */
export function useResolvedAiParams(capability: ForgeAiCapability): ResolvedAiParams {
  const canonicalCap = CAPABILITY_MAP[capability];
  const binding = useAiConfigStore((s) =>
    resolveStoredBinding(s.aiConfig.capabilities.selectedBindings, canonicalCap),
  );

  if (!binding || typeof binding !== 'object') {
    return { model: '', connectorId: '', source: undefined, route: undefined };
  }
  return {
    model: binding.model || '',
    connectorId: binding.connectorId || '',
    source: binding.source,
    route: binding.source,
  };
}
