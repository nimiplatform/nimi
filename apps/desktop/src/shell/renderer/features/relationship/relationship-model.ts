import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

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

type ContactPayload = JsonObject;

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
