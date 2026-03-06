import type { HookProfileClient } from '../types/runtime-hook/profile.js';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade.js';

export function createProfileClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookProfileClient {
  return {
    registerAgentReadFilter: async ({ handler }) => input.runtime.registerAgentProfileReadFilter({
      modId: input.modId,
      handler,
    }),
    unregisterAgentReadFilter: () => input.runtime.unregisterAgentProfileReadFilter({
      modId: input.modId,
    }),
  };
}
