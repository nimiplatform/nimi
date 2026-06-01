import { asRecord } from '../../internal/utils.js';
import type { Realm } from '../client.js';
import type { RealmModel } from '../generated/type-helpers.js';

export type RealmNotificationDto = RealmModel<'NotificationDto'>;
export type RealmNotificationListResultDto = RealmModel<'NotificationListResultDto'>;
export type RealmMarkNotificationsReadInputDto = RealmModel<'MarkNotificationsReadInputDto'>;
export type RealmUnreadNotificationCountDto = RealmModel<'UnreadNotificationCountDto'>;
export type RealmNotificationType = NonNullable<RealmNotificationDto['type']>;

export type RealmNotificationUnreadProjection = {
  total: number;
  byType: Record<string, number>;
};

export type RealmNotificationCategory = 'gift' | 'request' | 'mention' | 'like' | 'system';
export type RealmNotificationFilterTab = 'all' | RealmNotificationCategory;
export type RealmNotificationServerFilter = RealmNotificationType | null;

export type RealmNotificationItemProjection = {
  id: string;
  type: RealmNotificationType;
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

export type RealmNotificationListProjection = {
  items: RealmNotificationItemProjection[];
  nextCursor: string | null;
  hasNext: boolean;
};

export type RealmNotificationListOptions = {
  type?: RealmNotificationType;
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string;
};

export type RealmNotificationsReadProjection = {
  ok: true;
};

export type RealmNotificationReadProjection = {
  id: string;
};

const REQUEST_NOTIFICATION_TYPES = new Set<RealmNotificationType>([
  'friend_request_received',
  'friend_request_accepted',
  'friend_request_rejected',
]);

const GIFT_NOTIFICATION_TYPES = new Set<RealmNotificationType>([
  'gift_received',
  'gift_status_updated',
  'review_received',
]);

const LIKE_NOTIFICATION_TYPES = new Set<RealmNotificationType>([
  'post_liked',
]);

const MENTION_NOTIFICATION_TYPES = new Set<RealmNotificationType>([]);

function normalizeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function normalizeByType(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const byType: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(record)) {
    const count = normalizeCount(rawCount);
    if (count !== null) {
      byType[key] = count;
    }
  }
  return byType;
}

function normalizeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

export function normalizeRealmNotificationUnreadCount(
  value: RealmUnreadNotificationCountDto,
): RealmNotificationUnreadProjection {
  const record = asRecord(value);
  const total = normalizeCount(record.total);
  if (total === null) {
    throw new Error('REALM_NOTIFICATION_UNREAD_CONTRACT_INVALID');
  }
  return {
    total,
    byType: normalizeByType(record.byType),
  };
}

export function getRealmNotificationServerFilter(
  tab: RealmNotificationFilterTab,
): RealmNotificationServerFilter {
  switch (tab) {
    case 'like':
      return 'post_liked';
    case 'system':
      return 'system_announcement';
    default:
      return null;
  }
}

export function getRealmNotificationCategory(
  type: RealmNotificationType,
): RealmNotificationCategory {
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

export function getRealmNotificationBadgeKey(item: RealmNotificationItemProjection): string {
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

export function isRealmGiftNotificationReviewable(item: RealmNotificationItemProjection): boolean {
  return (
    item.type === 'gift_status_updated'
    && Boolean(item.giftTransactionId)
    && (item.giftStatus === 'accepted' || item.giftStatus === 'rejected')
    && !item.reviewId
  );
}

export function toRealmNotificationItemProjection(
  raw: RealmNotificationDto | null | undefined,
  fallbackTitle: string,
  fallbackActorName: string,
): RealmNotificationItemProjection | null {
  if (!raw) {
    return null;
  }

  const id = normalizeString(raw.id).trim();
  const type = raw.type;
  if (!id || !type) {
    return null;
  }

  const actor = asRecord(raw.actor);
  const target = asRecord(raw.target);
  const data = asRecord(raw.data);
  const actorName = normalizeString(actor.displayName).trim();
  const actorHandle = normalizeString(actor.handle).trim();
  const rawActorAvatarUrl = normalizeString(actor.avatarUrl).trim();
  const targetGiftTransactionId = normalizeString(target.interactionId).trim();
  const dataGiftTransactionId = normalizeString(data.giftTransactionId).trim();

  return {
    id,
    type,
    title: normalizeString(raw.title, fallbackTitle),
    body: normalizeString(raw.body),
    createdAt: normalizeString(raw.createdAt),
    isRead: normalizeBoolean(raw.isRead),
    actorId: normalizeString(actor.id).trim() || null,
    actorName: actorName || actorHandle || fallbackActorName,
    actorHandle,
    actorAvatarUrl: rawActorAvatarUrl || null,
    actorIsAgent: normalizeBoolean(actor.isAgent),
    giftTransactionId: targetGiftTransactionId || dataGiftTransactionId || null,
    giftStatus: normalizeString(data.status).trim() || null,
    giftMessage: normalizeString(data.message).trim() || null,
    giftSparkCost: normalizeString(data.sparkCost).trim() || null,
    reviewId: normalizeString(data.reviewId).trim() || null,
  };
}

export function toRealmNotificationListProjection(
  raw: RealmNotificationListResultDto | null | undefined,
  fallbackTitle: string,
  fallbackActorName: string,
): RealmNotificationListProjection {
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const items = rawItems
    .map((item) => toRealmNotificationItemProjection(item, fallbackTitle, fallbackActorName))
    .filter((item): item is RealmNotificationItemProjection => item !== null);

  const page = asRecord(raw?.page);
  const nextCursor = normalizeString(page.nextCursor).trim() || null;

  return {
    items,
    nextCursor,
    hasNext: nextCursor !== null,
  };
}

export async function loadRealmNotificationUnreadCount(
  realm: Pick<Realm, 'services'>,
): Promise<RealmNotificationUnreadProjection> {
  const payload = await realm.services.NotificationsService.getUnreadCount();
  return normalizeRealmNotificationUnreadCount(payload);
}

export async function loadRealmNotifications(
  realm: Pick<Realm, 'services'>,
  options: RealmNotificationListOptions = {},
): Promise<RealmNotificationListResultDto> {
  return realm.services.NotificationsService.listNotifications(
    options.type,
    options.unreadOnly,
    options.limit,
    options.cursor,
  );
}

export async function markRealmNotificationsRead(
  realm: Pick<Realm, 'services'>,
  input: RealmMarkNotificationsReadInputDto,
): Promise<RealmNotificationsReadProjection> {
  await realm.services.NotificationsService.markNotificationsRead(input);
  return { ok: true };
}

export async function markRealmNotificationRead(
  realm: Pick<Realm, 'services'>,
  notificationId: string,
): Promise<RealmNotificationReadProjection> {
  const normalizedId = String(notificationId || '').trim();
  if (!normalizedId) {
    throw new Error('REALM_NOTIFICATION_ID_REQUIRED');
  }
  await realm.services.NotificationsService.markNotificationRead(normalizedId);
  return { id: normalizedId };
}
