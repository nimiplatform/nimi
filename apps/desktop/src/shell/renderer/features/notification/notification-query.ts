import type { QueryClient } from '@tanstack/react-query';
import type { NimiRealmNotificationUnreadView } from '@nimiplatform/sdk/realm';
import { queryClient } from '@renderer/infra/query-client/query-client';

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
  if (authStatus !== 'authenticated') {
    return null;
  }
  const rawIdentity = user?.id ?? user?.accountId ?? user?.subjectId ?? user?.sub;
  const identity = String(rawIdentity || '').trim();
  return identity ? `user:${identity}` : null;
}

function normalizeUnreadCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

export function patchNotificationUnreadCaches(
  unreadCount: number,
  identityRef: string,
  client: QueryClient = queryClient,
): void {
  const nextUnreadCount = normalizeUnreadCount(unreadCount);

  client.setQueryData(
    notificationQueryKeys.unreadCount(identityRef),
    (current: unknown): NimiRealmNotificationUnreadView => {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const currentProjection = current as Partial<NimiRealmNotificationUnreadView>;
        return {
          ...currentProjection,
          total: nextUnreadCount,
          byType: currentProjection.byType ?? {},
        };
      }
      return {
        total: nextUnreadCount,
        byType: {},
      };
    },
  );

  client.setQueryData(
    notificationQueryKeys.topbarUnreadCount(identityRef),
    (current: unknown): NimiRealmNotificationUnreadView => {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const currentProjection = current as Partial<NimiRealmNotificationUnreadView>;
        return {
          ...currentProjection,
          total: nextUnreadCount,
          byType: currentProjection.byType ?? {},
        };
      }
      return {
        total: nextUnreadCount,
        byType: {},
      };
    },
  );
}

export async function invalidateNotificationQueries(
  client: QueryClient = queryClient,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: notificationQueryKeys.pageRoot }),
    client.invalidateQueries({ queryKey: notificationQueryKeys.unreadCountRoot }),
    client.invalidateQueries({ queryKey: notificationQueryKeys.topbarUnreadCountRoot }),
  ]);
}
