import { parseOptionalJsonObject, type JsonObject } from '@renderer/bridge/runtime-bridge/shared';

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
  accountVisibility: string | null;
  ownershipType: string;
  worldId: string | null;
  ownerWorldId: string | null;
  isFriend: boolean;
  worldBannerUrl: string | null;
};

function readOptionalString(record: JsonObject | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

export function toAgentDetailData(raw: JsonObject): AgentDetailData {
  const agent = parseOptionalJsonObject(raw.agent);
  const agentProfile = parseOptionalJsonObject(raw.agentProfile);
  const world = parseOptionalJsonObject(raw.world);

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
    accountVisibility: (
      (agent && typeof agent.accountVisibility === 'string' ? agent.accountVisibility : null)
      || readOptionalString(agentProfile, 'accountVisibility')
    ),
    ownershipType: (
      (agent && typeof agent.ownershipType === 'string' ? agent.ownershipType : '')
      || readOptionalString(agentProfile, 'ownershipType')
      || 'MASTER_OWNED'
    ),
    worldId: (
      (agent && typeof agent.worldId === 'string' ? agent.worldId : null)
      || readOptionalString(agentProfile, 'worldId')
    ),
    ownerWorldId: (
      (agent && typeof agent.ownerWorldId === 'string' ? agent.ownerWorldId : null)
      || readOptionalString(agentProfile, 'ownerWorldId')
    ),
    isFriend: raw.isFriend === true,
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || readOptionalString(agentProfile, 'worldBannerUrl')
      || readOptionalString(world, 'bannerUrl')
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
