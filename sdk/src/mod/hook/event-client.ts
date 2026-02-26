import type { HookEventClient } from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';

export function createEventClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookEventClient {
  return {
    subscribe: async ({ topic, handler, once }) => input.runtime.subscribeEvent({
      modId: input.modId,
      topic,
      handler,
      once,
    }),
    unsubscribe: (payload) => input.runtime.unsubscribeEvent({
      modId: input.modId,
      topic: payload?.topic,
    }),
    publish: async ({ topic, payload }) => input.runtime.publishEvent({
      modId: input.modId,
      topic,
      payload,
    }),
    listTopics: () => input.runtime.listEventTopics(),
  };
}
