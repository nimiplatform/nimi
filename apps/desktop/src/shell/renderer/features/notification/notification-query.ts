import type { QueryClient } from '@tanstack/react-query';

interface NotificationIdentityUser {
  readonly [key: string]: unknown;
  readonly id?: unknown;
  readonly accountId?: unknown;
  readonly subjectId?: unknown;
  readonly sub?: unknown;
}

export const notificationQueryKeys = {
  pageRoot: ['notification-page'] as const,
  page: (identityRef: string, serverFilter: string | null) =>
    ['notification-page', identityRef, serverFilter || 'all'] as const,
  unreadCountRoot: ['notification-unread-count'] as const,
  unreadCount: (identityRef: string) => ['notification-unread-count', identityRef] as const,
  topbarUnreadCountRoot: ['topbar-notification-unread-count'] as const,
  topbarUnreadCount: (identityRef: string) => ['topbar-notification-unread-count', identityRef] as const,
};

export function resolveNotificationIdentityRef(
  authStatus: string,
  user: NotificationIdentityUser | null | undefined,
): string | null {
  if (authStatus !== 'authenticated' && authStatus !== 'refresh-pending') {
    return null;
  }
  const rawIdentity = user?.id ?? user?.accountId ?? user?.subjectId ?? user?.sub;
  const identity = String(rawIdentity || '').trim();
  return identity ? JSON.stringify(['realm-notifications', user?.realmEnvironmentId ?? '', identity]) : null;
}

export async function invalidateNotificationQueries(
  client: QueryClient,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: notificationQueryKeys.pageRoot }),
    client.invalidateQueries({ queryKey: notificationQueryKeys.unreadCountRoot }),
    client.invalidateQueries({ queryKey: notificationQueryKeys.topbarUnreadCountRoot }),
    // The current-request projection must refresh alongside its notification.
    client.invalidateQueries({ queryKey: ['human-contacts'], predicate: query => query.queryKey[3] === 'received' }),
  ]);
}
