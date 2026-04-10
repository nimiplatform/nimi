import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { useAppStore } from '../../app-shell/app-store.js';
import type { ParentosCapabilityId } from './parentos-ai-config.js';

export type ParentosCallParams = {
  model: string;
  route?: 'local' | 'cloud';
  connectorId?: string;
};

/**
 * Resolve AI call parameters from the user's AIConfig binding for a capability.
 *
 * If the user has configured a binding in AI settings, returns the model/route/connectorId
 * from that binding. Otherwise returns `{ model: 'auto' }` to use runtime defaults.
 *
 * Call sites spread the result into SDK calls:
 * ```ts
 * const params = resolveParentosBinding('text.generate');
 * await client.runtime.ai.text.generate({ ...params, input, temperature, ... });
 * ```
 */
export function resolveParentosBinding(capabilityId: ParentosCapabilityId): ParentosCallParams {
  const config = useAppStore.getState().aiConfig;
  if (!config) return { model: 'auto' };

  const binding = config.capabilities.selectedBindings[capabilityId] as RuntimeRouteBinding | null | undefined;
  if (!binding) return { model: 'auto' };

  const model = binding.model || 'auto';
  if (binding.source === 'cloud') {
    return {
      model,
      route: 'cloud',
      connectorId: binding.connectorId || undefined,
    };
  }
  return {
    model,
    route: 'local',
  };
}
