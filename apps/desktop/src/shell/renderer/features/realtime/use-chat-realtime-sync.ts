import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { useEffect } from 'react';
import { rememberRealmChatSeenEvent } from '@nimiplatform/kit/features/chat/realm';
import { getOfflineCoordinator } from '@renderer/infra/offline/coordinator';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { invalidateNotificationQueries } from '@renderer/features/notification/notification-query.js';
import { flushPendingChatOutbox } from '@renderer/features/chat/data/realm-human-chat-data';

const BROKER_SYNC_INTERVAL_MS = 5_000;

export function rememberSeenEvent(seen: Map<string, number>, key: string): boolean {
  return rememberRealmChatSeenEvent(seen, key);
}

export function useChatRealtimeSync(): void {
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const offlineCoordinator = getOfflineCoordinator();

  useEffect(() => {
    offlineCoordinator.markRealmSocketReachable(false);
    if (authStatus !== 'authenticated') {
      return undefined;
    }
    let cancelled = false;
    let inFlight = false;
    const syncThroughBroker = async () => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const tasks: Promise<unknown>[] = [
          queryClient.invalidateQueries({ queryKey: ['chats'] }),
          invalidateNotificationQueries(),
          flushPendingChatOutbox(),
          realmSocialData.flushSocialOutbox(),
        ];
        if (selectedChatId) {
          tasks.push(queryClient.invalidateQueries({ queryKey: ['messages', selectedChatId] }));
        }
        await Promise.allSettled(tasks);
      } finally {
        inFlight = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncThroughBroker();
      }
    };
    void syncThroughBroker();
    const interval = globalThis.setInterval(() => {
      void syncThroughBroker();
    }, BROKER_SYNC_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [authStatus, offlineCoordinator, selectedChatId]);
}
