import type {
  MarkNotificationsReadInputDto,
  NotificationDto,
  NotificationListResultDto,
  RealmTypedCallOptions,
  RealmTypedClient,
  UnreadNotificationCountDto,
} from '../core-generated/realm-typed-client';
import { ReasonCode, createNimiError } from '../types';

export type NimiRealmNotification = NotificationDto;
export type NimiRealmNotificationListResult = NotificationListResultDto;
export type NimiRealmMarkNotificationsReadInput = MarkNotificationsReadInputDto;
export type NimiRealmNotificationType = NonNullable<NotificationDto['type']>;

export interface NimiRealmNotificationUnreadView {
  readonly total: number;
  readonly byType: Readonly<Record<string, number>>;
}

export interface NimiRealmNotificationItemView {
  readonly id: string;
  readonly type: NimiRealmNotificationType;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly isRead: boolean;
  readonly actorId: string | null;
  readonly actorName: string;
  readonly actorHandle: string;
  readonly actorAvatarUrl: string | null;
  readonly actorKind: 'account';
  readonly giftTransactionId: string | null;
  readonly giftStatus: string | null;
  readonly giftMessage: string | null;
  readonly giftSparkCost: string | null;
  readonly reviewId: string | null;
}

export interface NimiRealmNotificationListView {
  readonly items: readonly NimiRealmNotificationItemView[];
  readonly nextCursor: string | null;
  readonly hasNext: boolean;
}

export interface NimiRealmNotificationListOptions {
  readonly type?: NimiRealmNotificationType;
  readonly unreadOnly?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface NimiRealmNotificationsReadView {
  readonly ok: true;
}

export interface NimiRealmNotificationReadView {
  readonly id: string;
}

export interface NimiRealmNotificationApi {
  readonly notifications: Pick<
    RealmTypedClient,
    | 'getUnreadCount'
    | 'listNotifications'
    | 'markNotificationRead'
    | 'markNotificationsRead'
  >;
}

export function normalizeNimiRealmNotificationUnreadCount(
  value: UnreadNotificationCountDto,
): NimiRealmNotificationUnreadView {
  const record = toRecord(value);
  const total = normalizeCount(record.total);
  if (total === null) {
    throw notificationError({
      reasonCode: ReasonCode.SDK_REALM_NOTIFICATION_UNREAD_CONTRACT_INVALID,
      message: 'Realm notification unread count response is malformed.',
      actionHint: 'check_realm_notification_response',
    });
  }
  return {
    total,
    byType: normalizeByType(record.byType),
  };
}

export function toNimiRealmNotificationItemView(
  raw: NotificationDto | null | undefined,
  fallbackTitle: string,
  fallbackActorName: string,
): NimiRealmNotificationItemView | null {
  if (!raw) {
    return null;
  }

  const id = normalizeString(raw.id).trim();
  const type = raw.type;
  if (!id || !type) {
    return null;
  }

  const actor = toRecord(raw.actor);
  const target = toRecord(raw.target);
  const data = toRecord(raw.data);
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
    isRead: raw.isRead === true,
    actorId: normalizeString(actor.id).trim() || null,
    actorName: actorName || actorHandle || fallbackActorName,
    actorHandle,
    actorAvatarUrl: rawActorAvatarUrl || null,
    actorKind: 'account',
    giftTransactionId: targetGiftTransactionId || dataGiftTransactionId || null,
    giftStatus: normalizeString(data.status).trim() || null,
    giftMessage: normalizeString(data.message).trim() || null,
    giftSparkCost: normalizeString(data.sparkCost).trim() || null,
    reviewId: normalizeString(data.reviewId).trim() || null,
  };
}

export function toNimiRealmNotificationListView(
  raw: NotificationListResultDto | null | undefined,
  fallbackTitle: string,
  fallbackActorName: string,
): NimiRealmNotificationListView {
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const items = rawItems
    .map((item) => toNimiRealmNotificationItemView(item, fallbackTitle, fallbackActorName))
    .filter((item): item is NimiRealmNotificationItemView => item !== null);

  const page = toRecord(raw?.page);
  const nextCursor = normalizeString(page.nextCursor).trim() || null;

  return {
    items,
    nextCursor,
    hasNext: nextCursor !== null,
  };
}

export async function loadNimiRealmNotificationUnreadCount(
  realm: NimiRealmNotificationApi,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmNotificationUnreadView> {
  const payload = await realm.notifications.getUnreadCount({ path: {} }, options);
  return normalizeNimiRealmNotificationUnreadCount(payload);
}

export async function loadNimiRealmNotifications(
  realm: NimiRealmNotificationApi,
  options: NimiRealmNotificationListOptions = {},
  callOptions?: RealmTypedCallOptions,
): Promise<NimiRealmNotificationListResult> {
  return realm.notifications.listNotifications({
    path: {},
    query: {
      ...(options.type ? { type: options.type } : {}),
      ...(options.unreadOnly !== undefined ? { unreadOnly: options.unreadOnly } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
    },
  }, callOptions);
}

export async function markNimiRealmNotificationsRead(
  realm: NimiRealmNotificationApi,
  input: NimiRealmMarkNotificationsReadInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmNotificationsReadView> {
  await realm.notifications.markNotificationsRead({ path: {}, body: input }, options);
  return { ok: true };
}

export async function markNimiRealmNotificationRead(
  realm: NimiRealmNotificationApi,
  notificationId: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmNotificationReadView> {
  const normalizedId = normalizeString(notificationId).trim();
  if (!normalizedId) {
    throw notificationError({
      reasonCode: ReasonCode.SDK_REALM_NOTIFICATION_ID_REQUIRED,
      message: 'Realm notification id is required.',
      actionHint: 'provide_realm_notification_id',
    });
  }
  await realm.notifications.markNotificationRead({ path: { notificationId: normalizedId } }, options);
  return { id: normalizedId };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function normalizeByType(value: unknown): Record<string, number> {
  const record = toRecord(value);
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

function notificationError(input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
}): Error {
  return createNimiError({
    message: input.message,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: 'sdk',
  });
}
