export type {
  AvatarPresentationProfile,
  RuntimeAgentPresentationAdapter,
  RuntimeAgentPresentationRecord,
} from './types.js';

import type {
  AvatarPresentationProfile,
  RuntimeAgentPresentationRecord,
} from './types.js';

export function createRuntimeAgentPresentationRecord(
  agentId: string,
  presentation: AvatarPresentationProfile,
): RuntimeAgentPresentationRecord {
  return {
    agentId,
    presentation,
  };
}
