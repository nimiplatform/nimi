import type { StudioCapabilityRunResult } from './runtime-types.js';
import type { StudioCapabilityRuntimeContext } from './runtime.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

export type StudioCapabilityRuntimeHandler = (
  context: StudioCapabilityRuntimeContext,
) => Promise<StudioCapabilityRunResult>;

export type StudioCapabilityRuntimeHandlers = Readonly<
  Record<string, StudioCapabilityRuntimeHandler>
>;

export function composeStudioCapabilityRuntimeHandlers(
  groups: readonly StudioCapabilityRuntimeHandlers[],
): StudioCapabilityRuntimeHandlers {
  const handlers: Record<string, StudioCapabilityRuntimeHandler> = {};
  for (const group of groups) {
    for (const [capabilityId, handler] of Object.entries(group)) {
      if (!capabilityId || typeof handler !== 'function' || handlers[capabilityId]) {
        throw new Error(`Duplicate or invalid Studio Runtime handler: ${capabilityId || 'missing'}`);
      }
      handlers[capabilityId] = handler;
    }
  }
  return Object.freeze(handlers);
}

export function dispatchStudioCapabilityRuntime(
  handlers: StudioCapabilityRuntimeHandlers,
  context: StudioCapabilityRuntimeContext,
): Promise<StudioCapabilityRunResult> | null {
  const handler = handlers[context.capability.id];
  return handler ? handler(context) : null;
}
