import { formatRelativeLocaleTime } from '@renderer/i18n';
import { parseOptionalJsonObject, type JsonObject } from '@renderer/bridge/runtime-bridge/shared';

export type ContactRecord = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isAgent: boolean;
  friendsSince: string | null;
  agentOwnershipType?: 'MASTER_OWNED' | 'WORLD_OWNED' | null;
  agentCreatorId?: string | null;
  // World info
  worldId?: string | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
  // Extended profile fields
  age?: number | null;
  gender?: 'male' | 'female' | 'other' | null;
  location?: string | null;
  tags?: string[];
};

export type RequestDirection = 'received' | 'sent';

export type ContactRequestRecord = {
  id: string;
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isAgent: boolean;
  direction: RequestDirection;
  requestedAt: string | null;
  requestMessage: string | null;
};

export type TabFilter = 'humans' | 'agents' | 'myAgents' | 'requests' | 'blocks' | 'world';
export type ContactSearchCandidate = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  isAgent: boolean;
  isFriend: boolean;
};

export const CONTACTS_ACTIVE_FILTER_STORAGE_KEY = 'nimi.contacts.active-filter';

type ContactPayload = JsonObject;

export function loadStoredContactsFilter(defaultFilter: TabFilter = 'humans'): TabFilter {
  if (typeof window === 'undefined') {
    return defaultFilter;
  }
  try {
    const value = String(window.localStorage.getItem(CONTACTS_ACTIVE_FILTER_STORAGE_KEY) || '').trim();
    if (value === 'humans' || value === 'agents' || value === 'myAgents' || value === 'requests' || value === 'blocks') {
      return value;
    }
    return defaultFilter;
  } catch {
    return defaultFilter;
  }
}

export function persistStoredContactsFilter(filter: TabFilter): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(CONTACTS_ACTIVE_FILTER_STORAGE_KEY, filter);
  } catch {
    // ignore
  }
}

export function getContactInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function formatContactRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  return formatRelativeLocaleTime(dateStr);
}

export function toFriendContact(item: ContactPayload): ContactRecord {
  const handle = String(item.handle || '');
  const isAgent = item.isAgent === true;
  
  // Parse agent ownership type
  const agentProfile = parseOptionalJsonObject(item.agentProfile) ?? null;
  const ownershipRaw = String(item.ownershipType || agentProfile?.ownershipType || '').trim();
  const agentOwnershipType = ownershipRaw === 'MASTER_OWNED' || ownershipRaw === 'WORLD_OWNED'
    ? ownershipRaw
    : null;
  
  // Parse tags from various possible formats
  let tags: string[] | undefined;
  if (Array.isArray(item.tags)) {
    tags = item.tags.map((tag) => String(tag));
  } else if (typeof item.tags === 'string') {
    tags = item.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  
  // Parse age
  let age: number | null = null;
  if (typeof item.age === 'number' && item.age > 0) {
    age = item.age;
  } else if (typeof item.age === 'string') {
    const parsed = parseInt(item.age, 10);
    if (!isNaN(parsed) && parsed > 0) age = parsed;
  }
  
  // Parse gender
  let gender: ContactRecord['gender'] = null;
  const genderStr = String(item.gender || '').toLowerCase();
  if (genderStr === 'male' || genderStr === 'm') gender = 'male';
  else if (genderStr === 'female' || genderStr === 'f') gender = 'female';
  else if (genderStr === 'other' || genderStr === 'o') gender = 'other';
  
  // Parse world info
  const worldData = parseOptionalJsonObject(item.world) ?? null;
  const worldId = typeof item.worldId === 'string' ? item.worldId : 
    typeof worldData?.id === 'string' ? worldData.id : null;
  const worldName = typeof item.worldName === 'string' ? item.worldName : 
    typeof worldData?.name === 'string' ? worldData.name : null;
  const worldBannerUrl = typeof item.worldBannerUrl === 'string'
    ? item.worldBannerUrl
    : typeof agentProfile?.worldBannerUrl === 'string'
      ? agentProfile.worldBannerUrl
      : typeof worldData?.bannerUrl === 'string'
        ? worldData.bannerUrl
        : null;
  
  return {
    id: String(item.id || ''),
    displayName: String(item.displayName || handle || 'Unknown'),
    handle,
    avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
    bio: typeof item.bio === 'string' ? item.bio : null,
    isAgent,
    agentOwnershipType,
    friendsSince: typeof item.friendsSince === 'string' ? item.friendsSince : null,
    worldId,
    worldName,
    worldBannerUrl,
    age,
    gender,
    location: typeof item.location === 'string' ? item.location : null,
    tags,
  };
}

export function toDeveloperAgentContact(item: ContactPayload): ContactRecord {
  const agentProfile = parseOptionalJsonObject(item.agentProfile) ?? null;
  const ownershipRaw = String(item.ownershipType || agentProfile?.ownershipType || '').trim();
  const agentOwnershipType = ownershipRaw === 'MASTER_OWNED' || ownershipRaw === 'WORLD_OWNED'
    ? ownershipRaw
    : null;
  const agentCreatorIdRaw = String(item.creatorId || agentProfile?.creatorId || '').trim();
  
  // Parse world info
  const worldData = parseOptionalJsonObject(item.world) ?? null;
  const worldId = typeof item.worldId === 'string' ? item.worldId : 
    typeof worldData?.id === 'string' ? worldData.id : null;
  const worldName = typeof item.worldName === 'string' ? item.worldName : 
    typeof worldData?.name === 'string' ? worldData.name : null;
  const worldBannerUrl = typeof item.worldBannerUrl === 'string'
    ? item.worldBannerUrl
    : typeof agentProfile?.worldBannerUrl === 'string'
      ? agentProfile.worldBannerUrl
      : typeof worldData?.bannerUrl === 'string'
        ? worldData.bannerUrl
        : null;

  return {
    id: String(item.id || ''),
    displayName: String(item.displayName || item.handle || 'Unknown'),
    handle: String(item.handle || ''),
    avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
    bio: typeof item.presenceText === 'string' ? item.presenceText : null,
    isAgent: true,
    friendsSince: typeof item.createdAt === 'string' ? item.createdAt : null,
    agentOwnershipType,
    agentCreatorId: agentCreatorIdRaw || null,
    worldId,
    worldName,
    worldBannerUrl,
  };
}

export function toPendingRequestContact(item: ContactPayload): ContactRequestRecord {
  const userId = String(item.userId || item.id || '').trim();
  const handle = String(item.handle || '');
  return {
    id: userId,
    userId,
    displayName: String(item.displayName || handle || userId || 'Unknown'),
    handle,
    avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
    bio: typeof item.bio === 'string' ? item.bio : null,
    isAgent: item.isAgent === true,
    direction: item.direction === 'sent' ? 'sent' : 'received',
    requestedAt: typeof item.requestedAt === 'string' ? item.requestedAt : null,
    requestMessage: typeof item.requestMessage === 'string' ? item.requestMessage : null,
  };
}

export function toContactSearchCandidate(payload: unknown): ContactSearchCandidate | null {
  const input = parseOptionalJsonObject(payload);
  if (!input) {
    return null;
  }
  const id = String(input.id || '').trim();
  if (!id) {
    return null;
  }
  const handle = String(input.handle || '').trim();
  return {
    id,
    displayName: String(input.displayName || handle || 'Unknown'),
    handle,
    avatarUrl: typeof input.avatarUrl === 'string' ? input.avatarUrl : null,
    isAgent: input.isAgent === true,
    isFriend: input.isFriend === true,
  };
}
