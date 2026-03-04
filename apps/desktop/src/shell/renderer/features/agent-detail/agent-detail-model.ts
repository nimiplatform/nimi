export type AgentDetailData = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  tags: string[];
  isOnline: boolean;
  state: string;
  category: string;
  origin: string;
  tier: string;
  wakeStrategy: string;
  isPublic: boolean;
  ownershipType: string;
  worldId: string | null;
  ownerWorldId: string | null;
  isFriend: boolean;
  worldBannerUrl: string | null;
};

export function toAgentDetailData(raw: Record<string, unknown>): AgentDetailData {
  const agent = raw.agent as Record<string, unknown> | undefined;

  return {
    id: String(raw.id || ''),
    displayName: String(raw.displayName || raw.handle || 'Unknown'),
    handle: String(raw.handle || ''),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    bio: typeof raw.bio === 'string' ? raw.bio : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    isOnline: raw.isOnline === true,
    state: (agent && typeof agent.state === 'string' ? agent.state : 'UNKNOWN'),
    category: (agent && typeof agent.category === 'string' ? agent.category : 'GENERAL'),
    origin: (agent && typeof agent.origin === 'string' ? agent.origin : 'COMMUNITY'),
    tier: (agent && typeof agent.tier === 'string' ? agent.tier : 'COMMUNITY'),
    wakeStrategy: (agent && typeof agent.wakeStrategy === 'string' ? agent.wakeStrategy : 'PASSIVE'),
    isPublic: agent?.isPublic === true,
    ownershipType: (
      (agent && typeof agent.ownershipType === 'string' ? agent.ownershipType : '')
      || (
        raw.agentProfile
        && typeof raw.agentProfile === 'object'
        && typeof (raw.agentProfile as Record<string, unknown>).ownershipType === 'string'
          ? String((raw.agentProfile as Record<string, unknown>).ownershipType)
          : ''
      )
      || 'MASTER_OWNED'
    ),
    worldId: (
      (agent && typeof agent.worldId === 'string' ? agent.worldId : null)
      || (
        raw.agentProfile
        && typeof raw.agentProfile === 'object'
        && typeof (raw.agentProfile as Record<string, unknown>).worldId === 'string'
          ? String((raw.agentProfile as Record<string, unknown>).worldId)
          : null
      )
    ),
    ownerWorldId: (
      (agent && typeof agent.ownerWorldId === 'string' ? agent.ownerWorldId : null)
      || (
        raw.agentProfile
        && typeof raw.agentProfile === 'object'
        && typeof (raw.agentProfile as Record<string, unknown>).ownerWorldId === 'string'
          ? String((raw.agentProfile as Record<string, unknown>).ownerWorldId)
          : null
      )
    ),
    isFriend: raw.isFriend === true,
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || (
        raw.agentProfile
        && typeof raw.agentProfile === 'object'
        && typeof (raw.agentProfile as Record<string, unknown>).worldBannerUrl === 'string'
          ? String((raw.agentProfile as Record<string, unknown>).worldBannerUrl)
          : null
      )
      || (
        raw.world
        && typeof raw.world === 'object'
        && typeof (raw.world as Record<string, unknown>).bannerUrl === 'string'
          ? String((raw.world as Record<string, unknown>).bannerUrl)
          : null
      )
    ),
  };
}

export function getAgentInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function getStateBadgeColor(state: string): { bg: string; text: string; dot: string } {
  switch (state) {
    case 'ACTIVE':
      return { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' };
    case 'READY':
      return { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' };
    case 'INCUBATING':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' };
    case 'SUSPENDED':
      return { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' };
    case 'FAILED':
      return { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' };
  }
}
