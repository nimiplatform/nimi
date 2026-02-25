import type { HookDataClient } from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';

export function createDataClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookDataClient {
  return {
    query: async ({ capability, query }) => input.runtime.queryData({
      modId: input.modId,
      capability,
      query,
    }),
    register: async ({ capability, handler }) => input.runtime.registerDataProvider({
      modId: input.modId,
      capability,
      handler,
    }),
    unregister: ({ capability }) => input.runtime.unregisterDataProvider({
      modId: input.modId,
      capability,
    }),
    listCapabilities: () => input.runtime.listDataCapabilities(),
  };
}
