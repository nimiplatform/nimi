export const AGENT_AVATAR_LAUNCH_POLICY_STORAGE_KEY = 'nimi.chat.agent.avatar.launch-policy.v1';

export type AgentAvatarLaunchPolicy = {
  defaultLaunchTarget: 'current' | 'new';
  autoRefreshLiveInventory: boolean;
};

const launchPolicyByAgentId = new Map<string, AgentAvatarLaunchPolicy>();

export const DEFAULT_AGENT_AVATAR_LAUNCH_POLICY: AgentAvatarLaunchPolicy = {
  defaultLaunchTarget: 'current',
  autoRefreshLiveInventory: true,
};

function normalizeLaunchTarget(value: unknown): AgentAvatarLaunchPolicy['defaultLaunchTarget'] {
  return value === 'new' ? 'new' : 'current';
}

function normalizeAutoRefresh(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_AGENT_AVATAR_LAUNCH_POLICY.autoRefreshLiveInventory;
}

export function loadStoredAgentAvatarLaunchPolicy(
  agentId: string | null | undefined,
): AgentAvatarLaunchPolicy {
  const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
  if (!normalizedAgentId) {
    return { ...DEFAULT_AGENT_AVATAR_LAUNCH_POLICY };
  }
  const stored = launchPolicyByAgentId.get(normalizedAgentId);
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_AGENT_AVATAR_LAUNCH_POLICY };
  }
  return {
    defaultLaunchTarget: normalizeLaunchTarget(stored.defaultLaunchTarget),
    autoRefreshLiveInventory: normalizeAutoRefresh(stored.autoRefreshLiveInventory),
  };
}

export function persistStoredAgentAvatarLaunchPolicy(
  agentId: string | null | undefined,
  policy: AgentAvatarLaunchPolicy,
): AgentAvatarLaunchPolicy {
  const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
  const normalizedPolicy: AgentAvatarLaunchPolicy = {
    defaultLaunchTarget: normalizeLaunchTarget(policy.defaultLaunchTarget),
    autoRefreshLiveInventory: normalizeAutoRefresh(policy.autoRefreshLiveInventory),
  };
  if (!normalizedAgentId) {
    return normalizedPolicy;
  }
  launchPolicyByAgentId.set(normalizedAgentId, normalizedPolicy);
  return normalizedPolicy;
}
