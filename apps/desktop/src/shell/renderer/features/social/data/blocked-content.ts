import type { SocialContactSnapshot } from './social-snapshot';


function normalizeUserId(value: unknown): string {
  return String(value || '').trim();
}

export function getBlockedUserIds(contacts: SocialContactSnapshot): Set<string> {
  const blocked = contacts.blocked;
  const ids = new Set<string>();
  for (const item of blocked) {
    const id = normalizeUserId(item.id);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

export function isBlockedUser(contacts: SocialContactSnapshot, userId: string): boolean {
  const normalized = normalizeUserId(userId);
  return normalized ? getBlockedUserIds(contacts).has(normalized) : false;
}
