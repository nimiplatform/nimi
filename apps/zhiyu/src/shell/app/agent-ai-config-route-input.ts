import type { RuntimeLocalAgentIdentityInput } from '@nimiplatform/sdk/runtime';
import type { ZhiyuAgentAIConfigRouteEvidenceInput } from '../agent-chat/agent-ai-config';
import type { ZhiyuEvidence } from './evidence';

export function zhiyuAgentAIConfigRouteInputFromEvidence(
  evidence: ZhiyuEvidence,
): ZhiyuAgentAIConfigRouteEvidenceInput {
  const subjectUserId = evidence.auth.ready ? (evidence.auth.accountId ?? '').trim() : '';
  const ownerUserId = firstNonEmpty(
    evidence.conversation.ownerUserId,
    evidence.localAgent.ownerUserId,
    evidence.source.ownerUserId,
  );
  const runtimeSourceRef = firstNonEmpty(
    evidence.conversation.runtimeSourceRef,
    evidence.localAgent.runtimeSourceRef,
    evidence.source.runtimeSourceRef,
  );
  const localAgentRef = firstNonEmpty(
    evidence.conversation.localAgentRef,
    evidence.localAgent.localAgentRef,
  );
  return {
    subjectUserId,
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(runtimeSourceRef ? { runtimeSourceRef } : {}),
    ...(localAgentRef ? { localAgentRef } : {}),
  };
}

export function zhiyuAgentAIConfigIdentityFromRouteInput(
  input: ZhiyuAgentAIConfigRouteEvidenceInput,
): RuntimeLocalAgentIdentityInput | null {
  const ownerUserId = typeof input.ownerUserId === 'string' ? input.ownerUserId.trim() : '';
  const runtimeSourceRef = typeof input.runtimeSourceRef === 'string' ? input.runtimeSourceRef.trim() : '';
  const localAgentRef = typeof input.localAgentRef === 'string' ? input.localAgentRef.trim() : '';
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
}

function firstNonEmpty(...values: readonly (string | null | undefined)[]): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) {
      return text;
    }
  }
  return '';
}
