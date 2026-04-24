import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';

type MarkNotificationsReadInputDto = RealmModel<'MarkNotificationsReadInputDto'>;
type NotificationDto = RealmModel<'NotificationDto'>;
type NotificationListResultDto = RealmModel<'NotificationListResultDto'>;
type UnreadNotificationCountDto = RealmModel<'UnreadNotificationCountDto'>;

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

type DataSyncNotificationType = NonNullable<NotificationDto['type']>;

export async function loadNotificationUnreadCount(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<UnreadNotificationCountDto> {
  try {
    return await callApi(
      (realm) => realm.services.NotificationsService.getUnreadCount(),
      '加载通知未读数失败',
    );
  } catch (error) {
    emitDataSyncError('load-notification-unread-count', error);
    throw error;
  }
}

export async function loadNotifications(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  options?: {
    type?: DataSyncNotificationType;
    unreadOnly?: boolean;
    limit?: number;
    cursor?: string;
  },
): Promise<NotificationListResultDto> {
  try {
    return await callApi(
      (realm) => realm.services.NotificationsService.listNotifications(
        options?.type,
        options?.unreadOnly,
        options?.limit,
        options?.cursor,
      ),
      '加载通知列表失败',
    );
  } catch (error) {
    emitDataSyncError('load-notifications', error, {
      type: options?.type || null,
      unreadOnly: options?.unreadOnly ?? null,
      limit: options?.limit ?? null,
      cursor: options?.cursor || null,
    });
    throw error;
  }
}

export async function markNotificationsRead(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: MarkNotificationsReadInputDto,
) {
  try {
    await callApi(
      (realm) => realm.services.NotificationsService.markNotificationsRead(input),
      '标记通知已读失败',
    );
    return { ok: true };
  } catch (error) {
    emitDataSyncError('mark-notifications-read', error, {
      markAllBefore: input?.markAllBefore || null,
      count: Array.isArray(input?.ids) ? input.ids.length : 0,
    });
    throw error;
  }
}

export async function markNotificationRead(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  notificationId: string,
) {
  const normalizedId = String(notificationId || '').trim();
  if (!normalizedId) {
    throw new Error('通知 ID 不能为空');
  }
  try {
    await callApi(
      (realm) => realm.services.NotificationsService.markNotificationRead(normalizedId),
      '标记通知已读失败',
    );
    return { id: normalizedId };
  } catch (error) {
    emitDataSyncError('mark-notification-read', error, { notificationId: normalizedId });
    throw error;
  }
}
