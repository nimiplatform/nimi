export function createInterModClient(input) {
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
