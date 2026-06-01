export type NimiNotificationCategory = 'gift' | 'request' | 'mention' | 'like' | 'system';
export type NimiNotificationFilterTab = 'all' | NimiNotificationCategory;
export type NimiNotificationServerFilter = 'post_liked' | 'system_announcement' | null;

export type NimiNotificationBadgeKey =
  | 'friendRequestReceived'
  | 'friendRequestAccepted'
  | 'friendRequestRejected'
  | 'giftReceived'
  | 'giftAccepted'
  | 'giftRejected'
  | 'giftStatusUpdated'
  | 'reviewReceived'
  | 'system';

export type NimiNotificationBadgeInput = {
  type: string;
  giftStatus?: string | null;
};

export type NimiGiftNotificationReviewableInput = {
  type: string;
  giftTransactionId?: string | null;
  giftStatus?: string | null;
  reviewId?: string | null;
};

const REQUEST_NOTIFICATION_TYPES = new Set<string>([
  'friend_request_received',
  'friend_request_accepted',
  'friend_request_rejected',
]);

const GIFT_NOTIFICATION_TYPES = new Set<string>([
  'gift_received',
  'gift_status_updated',
  'review_received',
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
  if (GIFT_NOTIFICATION_TYPES.has(type)) {
    return 'gift';
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
    case 'gift_received':
      return 'giftReceived';
    case 'gift_status_updated':
      if (item.giftStatus === 'accepted') {
        return 'giftAccepted';
      }
      if (item.giftStatus === 'rejected') {
        return 'giftRejected';
      }
      return 'giftStatusUpdated';
    case 'review_received':
      return 'reviewReceived';
    default:
      return 'system';
  }
}

export function isNimiGiftNotificationReviewable(
  item: NimiGiftNotificationReviewableInput,
): boolean {
  return (
    item.type === 'gift_status_updated'
    && Boolean(item.giftTransactionId)
    && (item.giftStatus === 'accepted' || item.giftStatus === 'rejected')
    && !item.reviewId
  );
}
