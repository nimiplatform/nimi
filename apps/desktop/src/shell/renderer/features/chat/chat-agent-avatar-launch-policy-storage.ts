export const AGENT_AVATAR_LAUNCH_POLICY_STORAGE_KEY = 'nimi.chat.agent.avatar.launch-policy.v1';

export type AgentAvatarLaunchPolicy = {
  defaultLaunchTarget: 'current' | 'new';
  autoRefreshLiveInventory: boolean;
};

type StoredAgentAvatarLaunchPolicy = Partial<AgentAvatarLaunchPolicy>;
type StoredAgentAvatarLaunchPolicyRecord = Record<string, StoredAgentAvatarLaunchPolicy>;

export const DEFAULT_AGENT_AVATAR_LAUNCH_POLICY: AgentAvatarLaunchPolicy = {
  defaultLaunchTarget: 'current',
  autoRefreshLiveInventory: true,
};

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage as Storage;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeLaunchTarget(value: unknown): AgentAvatarLaunchPolicy['defaultLaunchTarget'] {
  return value === 'new' ? 'new' : 'current';
}

function normalizeAutoRefresh(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_AGENT_AVATAR_LAUNCH_POLICY.autoRefreshLiveInventory;
}

function loadRecord(): StoredAgentAvatarLaunchPolicyRecord {
  const storage = getLocalStorage();
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(AGENT_AVATAR_LAUNCH_POLICY_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as StoredAgentAvatarLaunchPolicyRecord;
  } catch {
    return {};
  }
}

function persistRecord(record: StoredAgentAvatarLaunchPolicyRecord): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(AGENT_AVATAR_LAUNCH_POLICY_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore local persistence failures
  }
}

export function loadStoredAgentAvatarLaunchPolicy(
  agentId: string | null | undefined,
): AgentAvatarLaunchPolicy {
  const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
  if (!normalizedAgentId) {
    return { ...DEFAULT_AGENT_AVATAR_LAUNCH_POLICY };
  }
  const stored = loadRecord()[normalizedAgentId];
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
  const record = loadRecord();
  record[normalizedAgentId] = normalizedPolicy;
  persistRecord(record);
  return normalizedPolicy;
}
