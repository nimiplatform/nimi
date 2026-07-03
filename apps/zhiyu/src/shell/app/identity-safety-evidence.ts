import { projectNimiRuntimeAgentIdentitySafety } from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence } from './evidence';

export function projectZhiyuIdentitySafetyEvidence(evidence: ZhiyuEvidence): ZhiyuEvidence {
  const ownerUserId = evidence.localAgent.ownerUserId;
  const runtimeSourceRef = evidence.localAgent.runtimeSourceRef;
  const localAgentRef = evidence.localAgent.localAgentRef;
  if (!evidence.localAgent.ready || !ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return evidence.identitySafety ? { ...evidence, identitySafety: undefined } : evidence;
  }
  return {
    ...evidence,
    identitySafety: projectNimiRuntimeAgentIdentitySafety({
      identity: {
        ownerUserId,
        runtimeSourceRef,
        localAgentRef,
      },
      conversationAnchorId: evidence.conversation.conversationAnchorId,
    }),
  };
}
