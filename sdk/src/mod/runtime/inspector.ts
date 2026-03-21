import { createNimiError } from '../../runtime/errors.js';
import { ReasonCode } from '../../types/index.js';
import { resolveModRuntimeContext } from '../internal/runtime-access.js';
import type { ModRuntimeContextInput } from '../types/runtime-mod.js';
import type {
  ModRuntimeLocalProfileSnapshot,
  ModRuntimeInspector,
  ModRuntimeRepairAction,
} from './types.js';
import type { RuntimeCanonicalCapability } from '../runtime-route.js';

function normalizeModId(modId: string): string {
  return String(modId || '').trim();
}

export function createModRuntimeInspector(
  modId: string,
  context?: ModRuntimeContextInput,
): ModRuntimeInspector {
  const normalizedModId = normalizeModId(modId);
  if (!normalizedModId) {
    throw createNimiError({
      message: 'mod runtime inspector mod id is required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_non_empty_mod_id',
      source: 'sdk',
    });
  }
  const runtimeContext = resolveModRuntimeContext(context);

  const getLocalProfileSnapshot = async (
    capability?: RuntimeCanonicalCapability,
    routeSourceHint?: 'cloud' | 'local',
  ): Promise<ModRuntimeLocalProfileSnapshot> => {
    return runtimeContext.runtimeHost.getModLocalProfileSnapshot({
      modId: normalizedModId,
      capability,
      routeSourceHint,
    });
  };

  const getRepairActions = async (capability?: RuntimeCanonicalCapability): Promise<ModRuntimeRepairAction[]> => {
    const snapshot = await getLocalProfileSnapshot(capability);
    return snapshot.repairActions;
  };

  return {
    getLocalProfileSnapshot,
    getRepairActions,
  };
}
