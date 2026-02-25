export function createAuditClient(input) {
    return {
        query: (filter) => input.runtime.getAudit(filter),
        stats: (modId) => input.runtime.getAuditStats(modId),
    };
}
export function createMetaClient(input) {
    return {
        listRegistrations: (modId) => input.runtime.listRegistrations(modId),
        listCapabilities: (modId) => input.runtime.listModCapabilities(modId),
        getPermissions: (modId) => input.runtime.getPermissionDeclaration(modId),
    };
}
