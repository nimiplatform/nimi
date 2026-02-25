export function createTurnClient(input) {
    return {
        register: async ({ point, priority, handler }) => input.runtime.registerTurnHookV2({
            modId: input.modId,
            point,
            priority,
            handler,
        }),
        unregister: ({ point }) => input.runtime.unregisterTurnHook({
            modId: input.modId,
            point,
        }),
        invoke: async ({ point, context, abortSignal }) => input.runtime.invokeTurnHooks({
            point,
            context,
            abortSignal,
        }),
    };
}
