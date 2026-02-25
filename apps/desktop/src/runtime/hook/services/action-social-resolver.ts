import type { SocialCheckResolver } from './action-social-precondition.js';

const CORE_SOCIAL_FRIENDS_WITH_DETAILS_CAPABILITY = 'data-api.core.social.friends-with-details.list';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const normalized = readString(value).toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return null;
}

function extractFriendAccountId(item: Record<string, unknown>): string {
  return readString(item.friendAccountId)
    || readString(item.friend_account_id)
    || readString(item.friendId)
    || readString(item.accountId)
    || readString(item.id);
}

function extractFriendshipActive(item: Record<string, unknown>): boolean {
  const fromBool = readBoolean(item.active);
  if (fromBool !== null) return fromBool;
  const fromFriendshipActive = readBoolean(item.friendshipActive);
  if (fromFriendshipActive !== null) return fromFriendshipActive;
  const status = readString(item.status).toUpperCase();
  if (!status) return false;
  return status === 'ACTIVE';
}

export function createCoreSocialFriendshipResolver(input: {
  queryData: (payload: {
    capability: string;
    humanAccountId: string;
  }) => Promise<unknown>;
}): SocialCheckResolver {
  return async ({ humanAccountId, agentAccountId }) => {
    try {
      const snapshot = await input.queryData({
        capability: CORE_SOCIAL_FRIENDS_WITH_DETAILS_CAPABILITY,
        humanAccountId,
      });
      const root = asRecord(snapshot);
      const candidates = Array.isArray(snapshot)
        ? snapshot
        : Array.isArray(root.items)
          ? root.items
          : Array.isArray(root.friends)
            ? root.friends
            : [];
      const expected = agentAccountId.trim().toLowerCase();
      return candidates.some((entry) => {
        const row = asRecord(entry);
        const friendAccountId = extractFriendAccountId(row).toLowerCase();
        if (!friendAccountId || friendAccountId !== expected) {
          return false;
        }
        return extractFriendshipActive(row);
      });
    } catch {
      return false;
    }
  };
}
