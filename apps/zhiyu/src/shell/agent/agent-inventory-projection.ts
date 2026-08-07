import type { ZhiyuRuntimeAgentInventoryStatus } from './agent-inventory';

export function sameZhiyuRuntimeAgentInventory(
  left: ZhiyuRuntimeAgentInventoryStatus,
  right: ZhiyuRuntimeAgentInventoryStatus,
): boolean {
  return left.transport === right.transport
    && left.ready === right.ready
    && left.reasonCode === right.reasonCode
    && left.actionHint === right.actionHint
    && left.source === right.source
    && left.message === right.message
    && left.ownerUserId === right.ownerUserId
    && left.count === right.count
    && left.localAgents.length === right.localAgents.length
    && left.localAgents.every((agent, index) => {
      const candidate = right.localAgents[index];
      return candidate !== undefined
        && agent.agentHandle === candidate.agentHandle
        && agent.displayName === candidate.displayName
        && agent.avatarUrl === candidate.avatarUrl;
    });
}
