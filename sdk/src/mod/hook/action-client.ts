import type { HookActionClient } from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';

export function createActionClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookActionClient {
  return {
    register: ({ descriptor, requiredCapabilities, handler }) => input.runtime.registerActionV1({
      modId: input.modId,
      descriptor,
      requiredCapabilities,
      handler,
    }),
    unregister: ({ actionId }) => input.runtime.unregisterAction({
      modId: input.modId,
      actionId,
    }),
    discover: (filter) => input.runtime.discoverActions({
      ...filter,
      modId: input.modId,
    }),
    dryRun: (payload) => input.runtime.dryRunAction(payload),
    verify: (payload) => input.runtime.verifyAction(payload),
    commit: (payload) => input.runtime.commitAction(payload),
    queryAudit: (filter) => input.runtime.queryActionAudit({
      ...filter,
      modId: input.modId,
    }),
  };
}
