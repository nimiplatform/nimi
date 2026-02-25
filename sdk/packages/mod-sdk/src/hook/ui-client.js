export function createUiClient(input) {
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
