export function createDataClient(input) {
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
