import type { HookInterModClient } from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';

export function createInterModClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookInterModClient {
  return {
    registerHandler: async ({ channel, handler }) => input.runtime.registerInterModHandlerV2({
      modId: input.modId,
      channel,
      handler,
    }),
    unregisterHandler: (payload) => input.runtime.unregisterInterModHandler({
      modId: input.modId,
      channel: payload?.channel,
    }),
    request: async ({ toModId, channel, payload, context }) => input.runtime.requestInterMod({
      fromModId: input.modId,
      toModId,
      channel,
      payload,
      context,
    }),
    broadcast: async ({ channel, payload, context }) => input.runtime.broadcastInterMod({
      fromModId: input.modId,
      channel,
      payload,
      context,
    }),
    discover: () => input.runtime.discoverInterModChannels(),
  };
}
