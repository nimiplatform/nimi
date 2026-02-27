import {
  resolveModRuntimeContext,
} from '../internal/runtime-access';
import type { ModRuntimeContextInput } from '../types/runtime-mod';
import type {
  AiRuntimeDependencySnapshot,
  AiRuntimeRepairAction,
  ModAiRuntimeInspector,
} from './types';

function normalizeModId(modId: string): string {
  return String(modId || '').trim();
}

export function createAiRuntimeInspector(
  modId: string,
  context?: ModRuntimeContextInput,
): ModAiRuntimeInspector {
  const normalizedModId = normalizeModId(modId);
  if (!normalizedModId) {
    throw new Error('AI_RUNTIME_INSPECTOR_MOD_ID_REQUIRED');
  }
  const runtimeContext = resolveModRuntimeContext(context);

  const getDependencySnapshot = async (capability?: string, routeSourceHint?: 'token-api' | 'local-runtime'): Promise<AiRuntimeDependencySnapshot> => {
    return runtimeContext.runtimeHost.getModAiDependencySnapshot({
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
