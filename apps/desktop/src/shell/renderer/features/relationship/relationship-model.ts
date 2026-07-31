import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

export type ContactRecord = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  friendsSince: string | null;
  age?: number | null;
  gender?: 'male' | 'female' | 'other' | null;
  location?: string | null;
  tags?: string[];
};

type ContactPayload = JsonObject;

function assertHumanFriendPayload(item: ContactPayload): void {
  if (Object.prototype.hasOwnProperty.call(item, 'isSource')
    || item.sourceRef != null
    || item.runtimeSourceRef != null
    || item.localAgentRef != null
    || item.sourceKind != null
    || item.sourceId != null
    || item.source != null) {
    throw new Error('Realm social friendship requires a human contact');
  }
}

export function toFriendContact(item: ContactPayload): ContactRecord {
  assertHumanFriendPayload(item);
  const id = String(item.id || '').trim();
  if (!id
    || id.startsWith('local-agent:')
    || id.startsWith('runtime-source:')) {
    throw new Error('Realm social friendship requires a human account id');
  }
  const handle = String(item.handle || '');

  let tags: string[] | undefined;
  if (Array.isArray(item.tags)) {
    tags = item.tags.map((tag) => String(tag));
  } else if (typeof item.tags === 'string') {
    tags = item.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  
  let age: number | null = null;
  if (typeof item.age === 'number' && item.age > 0) {
    age = item.age;
  } else if (typeof item.age === 'string') {
    const parsed = parseInt(item.age, 10);
    if (!isNaN(parsed) && parsed > 0) age = parsed;
  }
  
  let gender: ContactRecord['gender'] = null;
  const genderStr = String(item.gender || '').toLowerCase();
  if (genderStr === 'male' || genderStr === 'm') gender = 'male';
  else if (genderStr === 'female' || genderStr === 'f') gender = 'female';
  else if (genderStr === 'other' || genderStr === 'o') gender = 'other';
  
  return {
    id,
    displayName: String(item.displayName || handle || 'Unknown'),
    handle,
    avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
    bio: typeof item.bio === 'string' ? item.bio : null,
    friendsSince: typeof item.friendsSince === 'string' ? item.friendsSince : null,
    age,
    gender,
    location: typeof item.location === 'string' ? item.location : null,
    tags,
  };
}
