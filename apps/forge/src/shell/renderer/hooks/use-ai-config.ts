/**
 * AI Config Resolution
 *
 * Resolves the user's AI selection into parameters suitable for runtime AI calls.
 */

import type { NimiRoutePolicy } from '@nimiplatform/sdk/runtime';
import { useAiConfigStore, type ForgeAiCapability } from '@renderer/state/ai-config-store.js';

export type ResolvedAiParams = {
  model: string;
  connectorId: string;
  route: NimiRoutePolicy | undefined;
};

/** Non-reactive — use outside React components (e.g. in createForgeAiClient). */
export function getResolvedAiParams(capability: ForgeAiCapability): ResolvedAiParams {
  const selection = useAiConfigStore.getState().selections[capability];
  return {
    model: selection.model,
    connectorId: selection.connectorId,
    route: selection.route === 'auto' ? undefined : selection.route,
  };
}

/** Reactive hook — use inside React components. */
export function useResolvedAiParams(capability: ForgeAiCapability): ResolvedAiParams {
  const selection = useAiConfigStore((s) => s.selections[capability]);
  return {
    model: selection.model,
    connectorId: selection.connectorId,
    route: selection.route === 'auto' ? undefined : selection.route,
  };
}
