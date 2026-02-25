import { getRuntimeHost } from '../internal/runtime-access';
function normalizeModId(modId) {
    return String(modId || '').trim();
}
export function createAiRuntimeInspector(modId) {
    const normalizedModId = normalizeModId(modId);
    if (!normalizedModId) {
        throw new Error('AI_RUNTIME_INSPECTOR_MOD_ID_REQUIRED');
    }
    const getDependencySnapshot = async (capability, routeSourceHint) => {
        return getRuntimeHost().getModAiDependencySnapshot({
            modId: normalizedModId,
            capability: String(capability || '').trim() || undefined,
            routeSourceHint,
        });
    };
    const getRepairActions = async (capability) => {
        const snapshot = await getDependencySnapshot(capability);
        return snapshot.repairActions;
    };
    return {
        getDependencySnapshot,
        getRepairActions,
    };
}
