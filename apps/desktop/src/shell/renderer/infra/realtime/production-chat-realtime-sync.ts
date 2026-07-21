import type { QueryClient } from '@tanstack/react-query';

import { getOfflineCoordinator } from '../offline/coordinator.js';
import {
  createDesktopRealmChatService,
  flushPendingChatOutbox,
} from '../../features/chat/data/realm-human-chat-data.js';
import { invalidateNotificationQueries } from '../../features/notification/notification-query.js';
import { flushPendingSocialMutations } from '../../features/social/data/offline-social-outbox.js';
import { callRealmApi, emitRealmDataError } from '../realm/realm-api.js';

const BROKER_SYNC_INTERVAL_MS = 5_000;

export function connectProductionChatRealtimeSync(input: {
  readonly queryClient: QueryClient;
  readonly selectedChatId: string | null;
}): () => void {
  const offlineCoordinator = getOfflineCoordinator();
  offlineCoordinator.markRealmSocketReachability('unknown');
  let active = true;
  let inFlight = false;
  const syncThroughBroker = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const tasks: Promise<unknown>[] = [
        input.queryClient.invalidateQueries({ queryKey: ['chats'] }),
        invalidateNotificationQueries(input.queryClient),
        flushPendingChatOutbox(undefined, createDesktopRealmChatService(callRealmApi)),
        flushPendingSocialMutations(callRealmApi, emitRealmDataError),
      ];
      if (input.selectedChatId) {
        tasks.push(input.queryClient.invalidateQueries({
          queryKey: ['messages', input.selectedChatId],
        }));
      }
      await Promise.allSettled(tasks);
    } finally {
      inFlight = false;
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void syncThroughBroker();
  };
  void syncThroughBroker();
  const interval = globalThis.setInterval(() => void syncThroughBroker(), BROKER_SYNC_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    active = false;
    globalThis.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
