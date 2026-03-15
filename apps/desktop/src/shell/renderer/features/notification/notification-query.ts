import type { QueryClient } from '@tanstack/react-query';
import type { UnreadNotificationCountDto } from '@nimiplatform/sdk/realm';
import { queryClient } from '@renderer/infra/query-client/query-client';

export const notificationQueryKeys = {
  pageRoot: ['notification-page'] as const,
  page: (authStatus: string, serverFilter: string | null) =>
    ['notification-page', authStatus, serverFilter || 'all'] as const,
  unreadCountRoot: ['notification-unread-count'] as const,
  unreadCount: (authStatus: string) => ['notification-unread-count', authStatus] as const,
  topbarUnreadCount: ['topbar-notification-unread-count'] as const,
};

function normalizeUnreadCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

export function patchNotificationUnreadCaches(
  unreadCount: number,
  client: QueryClient = queryClient,
): void {
  const nextUnreadCount = normalizeUnreadCount(unreadCount);

  client.setQueriesData(
    { queryKey: notificationQueryKeys.unreadCountRoot },
    (current: unknown): UnreadNotificationCountDto => {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        return {
          ...(current as UnreadNotificationCountDto),
          total: nextUnreadCount,
        };
      }
      return {
        total: nextUnreadCount,
        byType: {},
      };
    },
  );

  client.setQueryData(notificationQueryKeys.topbarUnreadCount, (current: unknown) => {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return {
        ...current,
        total: nextUnreadCount,
        unreadCount: nextUnreadCount,
        count: nextUnreadCount,
      };
    }
    return {
      total: nextUnreadCount,
      unreadCount: nextUnreadCount,
      count: nextUnreadCount,
    };
  });
}

export async function invalidateNotificationQueries(
  client: QueryClient = queryClient,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: notificationQueryKeys.pageRoot }),
    client.invalidateQueries({ queryKey: notificationQueryKeys.unreadCountRoot }),
    client.invalidateQueries({ queryKey: notificationQueryKeys.topbarUnreadCount }),
  ]);
}
