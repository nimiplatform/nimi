import type { AgentCenterOpaqueHandle } from '@nimiplatform/kit/features/agent-center';

import type { ZhiyuEvidence } from '../app/evidence.js';

export type ZhiyuAuthorizedAgentCenterIdentity = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
};

export function projectZhiyuAuthorizedAgentCenterHandle(
  evidence: Pick<ZhiyuEvidence, 'conversation' | 'localAgent' | 'inventory'>,
): AgentCenterOpaqueHandle | null {
  const agentHandle = evidence.conversation.agentHandle?.trim()
    || evidence.localAgent.agentHandle?.trim()
    || '';
  const covered = evidence.inventory.localAgents.some((agent) => agent.agentHandle === agentHandle);
  return agentHandle && covered ? agentHandle as AgentCenterOpaqueHandle : null;
}

export function projectZhiyuAuthorizedAgentCenterIdentity(
  evidence: Pick<ZhiyuEvidence, 'conversation' | 'localAgent' | 'inventory'>,
  agentHandle: AgentCenterOpaqueHandle | null,
): ZhiyuAuthorizedAgentCenterIdentity | null {
  if (!agentHandle) return null;
  const candidates = [evidence.conversation, evidence.localAgent]
    .filter((candidate) => candidate.agentHandle?.trim() === agentHandle);
  const selected = candidates.find((candidate) => (
    Boolean(candidate.ownerUserId?.trim())
    && Boolean(candidate.runtimeSourceRef?.trim())
    && Boolean(candidate.localAgentRef?.trim())
  ));
  if (!selected) return null;
  const identity = {
    ownerUserId: selected.ownerUserId!.trim(),
    runtimeSourceRef: selected.runtimeSourceRef!.trim(),
    localAgentRef: selected.localAgentRef!.trim(),
  };
  const conflicting = candidates.some((candidate) => (
    (candidate.ownerUserId?.trim() && candidate.ownerUserId.trim() !== identity.ownerUserId)
    || (candidate.runtimeSourceRef?.trim() && candidate.runtimeSourceRef.trim() !== identity.runtimeSourceRef)
    || (candidate.localAgentRef?.trim() && candidate.localAgentRef.trim() !== identity.localAgentRef)
  ));
  const inventoryOwner = evidence.inventory.ownerUserId?.trim() || '';
  if (conflicting || (inventoryOwner && inventoryOwner !== identity.ownerUserId)) return null;
  return Object.freeze(identity);
}
