import type { HookProfileClient } from '../types/profile.js';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-facade.js';

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
