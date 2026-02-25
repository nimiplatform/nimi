import { getRuntimeHost } from '../internal/runtime-access';
import type {
  AiRuntimeDependencySnapshot,
  AiRuntimeRepairAction,
  ModAiRuntimeInspector,
} from './types';

function normalizeModId(modId: string): string {
  return String(modId || '').trim();
}

export function createAiRuntimeInspector(modId: string): ModAiRuntimeInspector {
  const normalizedModId = normalizeModId(modId);
  if (!normalizedModId) {
    throw new Error('AI_RUNTIME_INSPECTOR_MOD_ID_REQUIRED');
  }

  const getDependencySnapshot = async (capability?: string, routeSourceHint?: 'token-api' | 'local-runtime'): Promise<AiRuntimeDependencySnapshot> => {
    return getRuntimeHost().getModAiDependencySnapshot({
      modId: normalizedModId,
      capability: String(capability || '').trim() || undefined,
      routeSourceHint,
    });
  };

  const getRepairActions = async (capability?: string): Promise<AiRuntimeRepairAction[]> => {
    const snapshot = await getDependencySnapshot(capability);
    return snapshot.repairActions;
  };

  return {
    getDependencySnapshot,
    getRepairActions,
  };
}
