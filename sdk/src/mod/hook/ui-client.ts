import type { HookUiClient } from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-facade';

export function createUiClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookUiClient {
  return {
    register: async ({ slot, priority, extension }) => input.runtime.registerUIExtensionV2({
      modId: input.modId,
      slot,
      priority,
      extension,
    }),
    unregister: (payload) => input.runtime.unregisterUIExtension({
      modId: input.modId,
      slot: payload?.slot,
    }),
    resolve: (slot) => input.runtime.resolveUIExtensions(slot),
    listSlots: () => input.runtime.listUISlots(),
  };
}
