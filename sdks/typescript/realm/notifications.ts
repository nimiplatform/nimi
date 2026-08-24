import type {
  MarkNotificationsReadInputDto,
  NotificationDto,
  NotificationListResultDto,
  RealmTypedCallOptions,
  RealmTypedClient,
  UnreadNotificationCountDto,
} from '../core-generated/realm-typed-client';
import { NotificationTypeValues } from '../core-generated/realm-typed-client';
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
  const byType = normalizeByType(record.byType);
  if (total === null || byType === null) {
    throw notificationDecodeError('Realm notification unread count response is malformed.');
  }
  return {
    total,
    byType,
  };
}

export function toNimiRealmNotificationItemView(
  raw: NotificationDto | null | undefined,
  fallbackTitle: string,
  fallbackActorName: string,
): NimiRealmNotificationItemView {
  const record = toOptionalRecord(raw);
  if (
    !record
    || typeof raw?.id !== 'string'
    || !raw.id.trim()
    || typeof raw.type !== 'string'
    || !NotificationTypeValues.includes(raw.type as NimiRealmNotificationType)
    || typeof raw.title !== 'string'
    || (raw.body !== null && typeof raw.body !== 'string')
    || typeof raw.createdAt !== 'string'
    || typeof raw.isRead !== 'boolean'
    || !isNotificationActor(raw.actor)
    || !isNullableRecord(raw.target)
    || !isNullableRecord(raw.data)
  ) {
    throw notificationDecodeError('Realm notification item response is malformed.');
  }

  const id = raw.id.trim();
  const type = raw.type;
  const actor = toRecord(raw.actor);
  const actorName = normalizeString(actor.displayName).trim();
  const actorHandle = normalizeString(actor.handle).trim();
  const rawActorAvatarUrl = normalizeString(actor.avatarUrl).trim();

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
  };
}

export function toNimiRealmNotificationListView(
  raw: NotificationListResultDto | null | undefined,
  fallbackTitle: string,
  fallbackActorName: string,
): NimiRealmNotificationListView {
  const record = toOptionalRecord(raw);
  const page = toOptionalRecord(record?.page);
  if (!record || !Array.isArray(record.items) || !page) {
    throw notificationDecodeError('Realm notification list response is malformed.');
  }
  if (page.nextCursor !== undefined && page.nextCursor !== null && typeof page.nextCursor !== 'string') {
    throw notificationDecodeError('Realm notification list pagination response is malformed.');
  }

  const items = record.items.map((item) =>
    toNimiRealmNotificationItemView(
      item as NotificationDto | null | undefined,
      fallbackTitle,
      fallbackActorName,
    ));
  const nextCursor = typeof page.nextCursor === 'string' ? page.nextCursor.trim() || null : null;

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
  return toOptionalRecord(value) ?? {};
}

function toOptionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isNullableRecord(value: unknown): boolean {
  return value === null || toOptionalRecord(value) !== null;
}

function isNotificationActor(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  const actor = toOptionalRecord(value);
  return Boolean(
    actor
    && typeof actor.id === 'string'
    && typeof actor.displayName === 'string'
    && typeof actor.handle === 'string'
    && typeof actor.createdAt === 'string',
  );
}

function normalizeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function normalizeByType(value: unknown): Record<string, number> | null {
  const record = toOptionalRecord(value);
  if (!record) {
    return null;
  }
  const byType: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(record)) {
    const count = normalizeCount(rawCount);
    if (count === null) {
      return null;
    }
    byType[key] = count;
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

function notificationDecodeError(message: string): Error {
  return notificationError({
    reasonCode: ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED,
    message,
    actionHint: 'check_realm_notification_response',
  });
}
