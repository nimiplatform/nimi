import type { RealmModel } from '@nimiplatform/sdk/realm';
import { parseOptionalJsonObject, type JsonObject } from '@renderer/bridge/runtime-bridge/shared';

type NotificationDto = RealmModel<'NotificationDto'>;
type NotificationListResultDto = RealmModel<'NotificationListResultDto'>;

export type NotificationFilterTab = 'all' | 'gift' | 'request' | 'mention' | 'like' | 'system';
export type NotificationItemType = NonNullable<NotificationDto['type']>;
export type NotificationServerFilter = NotificationItemType | null;

export type NotificationItemView = {
  id: string;
  type: NotificationItemType;
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
  actorId: string | null;
  actorName: string;
  actorHandle: string;
  actorAvatarUrl: string | null;
  actorIsAgent: boolean;
  giftTransactionId: string | null;
  giftStatus: string | null;
  giftMessage: string | null;
  giftSparkCost: string | null;
  reviewId: string | null;
};

export type NotificationListView = {
  items: NotificationItemView[];
  nextCursor: string | null;
  hasNext: boolean;
};

const REQUEST_NOTIFICATION_TYPES = new Set<NotificationItemType>([
  'friend_request_received',
  'friend_request_accepted',
  'friend_request_rejected',
]);

const GIFT_NOTIFICATION_TYPES = new Set<NotificationItemType>([
  'gift_received',
  'gift_status_updated',
  'review_received',
]);

const LIKE_NOTIFICATION_TYPES = new Set<NotificationItemType>([
  'post_liked',
]);

const MENTION_NOTIFICATION_TYPES = new Set<NotificationItemType>([]);

function toRecord(value: unknown): JsonObject | null {
  return parseOptionalJsonObject(value) ?? null;
}

function toStringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function toBooleanValue(value: unknown): boolean {
  return value === true;
}

export function getNotificationServerFilter(tab: NotificationFilterTab): NotificationServerFilter {
  switch (tab) {
    case 'like':
      return 'post_liked';
    case 'system':
      return 'system_announcement';
    default:
      return null;
  }
}

export function getNotificationCategory(type: NotificationItemType): Exclude<NotificationFilterTab, 'all'> {
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

export function getNotificationBadgeKey(item: NotificationItemView): string {
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

export function isGiftReviewable(item: NotificationItemView): boolean {
  return (
    item.type === 'gift_status_updated'
    && Boolean(item.giftTransactionId)
    && (item.giftStatus === 'accepted' || item.giftStatus === 'rejected')
    && !item.reviewId
  );
}

export function toNotificationItemView(
  raw: NotificationDto | null | undefined,
  fallbackTitle: string,
  fallbackActorName: string,
): NotificationItemView | null {
  if (!raw) {
    return null;
  }

  const id = toStringValue(raw.id).trim();
  const type = raw.type;
  if (!id || !type) {
    return null;
  }

  const actor = toRecord(raw.actor);
  const target = toRecord(raw.target);
  const data = toRecord(raw.data);
  const actorName = toStringValue(actor?.displayName).trim();
  const actorHandle = toStringValue(actor?.handle).trim();
  const rawActorAvatarUrl = toStringValue(actor?.avatarUrl).trim();
  const targetGiftTransactionId = toStringValue(target?.interactionId).trim();
  const dataGiftTransactionId = toStringValue(data?.giftTransactionId).trim();

  return {
    id,
    type,
    title: toStringValue(raw.title, fallbackTitle),
    body: toStringValue(raw.body),
    createdAt: toStringValue(raw.createdAt),
    isRead: toBooleanValue(raw.isRead),
    actorId: toStringValue(actor?.id).trim() || null,
    actorName: actorName || actorHandle || fallbackActorName,
    actorHandle,
    actorAvatarUrl: rawActorAvatarUrl || null,
    actorIsAgent: toBooleanValue(actor?.isAgent),
    giftTransactionId: targetGiftTransactionId || dataGiftTransactionId || null,
    giftStatus: toStringValue(data?.status).trim() || null,
    giftMessage: toStringValue(data?.message).trim() || null,
    giftSparkCost: toStringValue(data?.sparkCost).trim() || null,
    reviewId: toStringValue(data?.reviewId).trim() || null,
  };
}

export function toNotificationListView(
  raw: NotificationListResultDto | null | undefined,
  fallbackTitle: string,
  fallbackActorName: string,
): NotificationListView {
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const items = rawItems
    .map((item) => toNotificationItemView(item, fallbackTitle, fallbackActorName))
    .filter((item): item is NotificationItemView => item !== null);

  return {
    items,
    nextCursor: toStringValue(raw?.page?.nextCursor).trim() || null,
    hasNext: raw?.page?.hasNext === true,
  };
}
