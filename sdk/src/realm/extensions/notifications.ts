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
