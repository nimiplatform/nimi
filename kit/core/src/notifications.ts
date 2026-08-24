export type NimiNotificationCategory = 'request' | 'mention' | 'like' | 'system';
export type NimiNotificationFilterTab = 'all' | NimiNotificationCategory;
export type NimiNotificationServerFilter = 'post_liked' | 'system_announcement' | null;

export type NimiNotificationBadgeKey =
  | 'friendRequestReceived'
  | 'friendRequestAccepted'
  | 'friendRequestRejected'
  | 'system';

export type NimiNotificationBadgeInput = {
  type: string;
};

const REQUEST_NOTIFICATION_TYPES = new Set<string>([
  'friend_request_received',
  'friend_request_accepted',
  'friend_request_rejected',
]);

const LIKE_NOTIFICATION_TYPES = new Set<string>([
  'post_liked',
]);

const MENTION_NOTIFICATION_TYPES = new Set<string>([]);

export function getNimiNotificationServerFilter(
  tab: NimiNotificationFilterTab,
): NimiNotificationServerFilter {
  switch (tab) {
    case 'like':
      return 'post_liked';
    case 'system':
      return 'system_announcement';
    default:
      return null;
  }
}

export function getNimiNotificationCategory(type: string): NimiNotificationCategory {
  if (REQUEST_NOTIFICATION_TYPES.has(type)) {
    return 'request';
  }
  if (MENTION_NOTIFICATION_TYPES.has(type)) {
    return 'mention';
  }
  if (LIKE_NOTIFICATION_TYPES.has(type)) {
    return 'like';
  }
  return 'system';
}

export function getNimiNotificationBadgeKey(
  item: NimiNotificationBadgeInput,
): NimiNotificationBadgeKey {
  switch (item.type) {
    case 'friend_request_received':
      return 'friendRequestReceived';
    case 'friend_request_accepted':
      return 'friendRequestAccepted';
    case 'friend_request_rejected':
      return 'friendRequestRejected';
    default:
      return 'system';
  }
}
