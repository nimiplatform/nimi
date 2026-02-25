import type { CapabilityV11, RuntimeConfigStateV11 } from '../types';

export function getRecommendedModelByCapabilityV11(
  state: RuntimeConfigStateV11,
  capability: CapabilityV11,
): string {
  const matched = state.localRuntime.models.find((item) => item.capabilities.includes(capability));
  if (matched) return matched.model;
  const local = state.localRuntime.models[0]?.model;
  if (local) return local;
  return state.connectors[0]?.models[0] || 'local-model';
}

export function getRecommendedChatModelV11(state: RuntimeConfigStateV11): string {
  return getRecommendedModelByCapabilityV11(state, 'chat');
}
