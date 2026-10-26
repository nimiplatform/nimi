import type { QueryClient } from '@tanstack/react-query';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import { getOfflineCoordinator } from '../offline/coordinator.js';
import { invalidateNotificationQueries } from '../../features/notification/notification-query.js';
import { getDesktopRealmRealtimeClient } from '../sdk/desktop-nimi-client-session.js';

const NOTIFICATION_REFRESH_INTERVAL_MS = 5_000;

export function connectProductionChatRealtimeSync(input: {
  readonly queryClient: QueryClient;
  readonly selectedChatId: string | null;
}): () => void {
  const offlineCoordinator = getOfflineCoordinator();
  offlineCoordinator.markRealmSocketReachability('unknown');
  const abortController = new AbortController();
  const subscriptionIds = new Set<string>();
  const localSubscriptions = new Set<{ readonly cancel: () => Promise<void> }>();
  let realtime: ReturnType<typeof getDesktopRealmRealtimeClient> | null = null;
  let channelId = '';
  let active = true;
  let notificationRefreshInFlight = false;

  const closeConnection = () => {
    if (abortController.signal.aborted) return;
    abortController.abort();
    for (const subscription of localSubscriptions) void subscription.cancel().catch(() => undefined);
    if (!channelId || !realtime) return;
    for (const subscriptionId of subscriptionIds) {
      void realtime.closeSubscription({ channelId, subscriptionId }).catch(() => undefined);
    }
    void realtime.closeChannel({ channelId }).catch(() => undefined);
  };

  const refreshNotifications = async () => {
    if (!active || notificationRefreshInFlight) return;
    notificationRefreshInFlight = true;
    try {
      await invalidateNotificationQueries(input.queryClient);
    } finally {
      notificationRefreshInFlight = false;
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void refreshNotifications();
  };
  void refreshNotifications();
  const notificationInterval = globalThis.setInterval(
    () => void refreshNotifications(),
    NOTIFICATION_REFRESH_INTERVAL_MS,
  );
  document.addEventListener('visibilitychange', onVisibilityChange);

  const connectRealtime = async () => {
    const client = getDesktopRealmRealtimeClient();
    realtime = client;
    const opened = await client.open();
    if (!active || abortController.signal.aborted) {
	  await client.closeChannel({ channelId: opened.channelId });
      return;
    }
    channelId = opened.channelId;
    offlineCoordinator.markRealmSocketReachability('reachable');

    const consume = async (
	  target: Parameters<typeof client.subscribe>[0],
    ) => {
	  const subscription = await client.subscribe(target);
      if (!active || abortController.signal.aborted) {
        await subscription.cancel().catch(() => undefined);
        return;
      }
	  localSubscriptions.add(subscription);
	  const cancel = () => void subscription.cancel().catch(() => undefined);
	  abortController.signal.addEventListener('abort', cancel, { once: true });
	  try {
		for await (const event of subscription) {
        if (!active || abortController.signal.aborted) return;
        if (event.subscriptionId) subscriptionIds.add(event.subscriptionId);
		switch (event.event.type) {
          case 'control': {
			const lifecycle = event.event.control.lifecycle;
			if (lifecycle === 'ready') {
              offlineCoordinator.markRealmSocketReachability('reachable');
			  await input.queryClient.invalidateQueries({ queryKey: ['chats'], exact: false });
            } else if (
			  lifecycle === 'failed' || lifecycle === 'closed'
            ) {
              offlineCoordinator.markRealmSocketReachability('unreachable');
            }
            break;
          }
          case 'chat':
            await Promise.all([
              input.queryClient.invalidateQueries({ queryKey: ['chats'], exact: false }),
              input.queryClient.invalidateQueries({
				queryKey: ['messages', event.event.chatId],
                exact: false,
              }),
            ]);
            if (!active || abortController.signal.aborted) return;
            await client.ack({
              channelId,
              subscriptionId: event.subscriptionId,
			  cursor: event.event.cursor,
            });
            break;
          case 'snapshot':
            await Promise.all([
              input.queryClient.invalidateQueries({ queryKey: ['chats'], exact: false }),
              input.queryClient.invalidateQueries({
				queryKey: ['messages', event.event.chatId],
                exact: false,
              }),
            ]);
            break;
          case 'presence':
            await input.queryClient.invalidateQueries({ queryKey: ['chats'], exact: false });
            break;
		  case 'inbox':
			await Promise.all([
			  input.queryClient.invalidateQueries({ queryKey: ['chats'], exact: false }),
			  input.queryClient.invalidateQueries({ queryKey: ['messages', event.event.chatId], exact: false }),
			]);
			break;
          case 'typing':
        }
      }
	  } finally {
		abortController.signal.removeEventListener('abort', cancel);
		localSubscriptions.delete(subscription);
		await subscription.cancel().catch(() => undefined);
	  }
    };

    const consumers: Promise<void>[] = [consume({
      channelId,
	  target: { type: 'presence' },
	}), consume({
	  channelId,
	  target: { type: 'inbox' },
	})];
    if (input.selectedChatId) {
      consumers.push(consume({
        channelId,
		target: { type: 'chat', chatId: input.selectedChatId },
      }));
    }
    await Promise.all(consumers);
  };

  void connectRealtime().finally(closeConnection).catch((error) => {
    if (!active) return;
    offlineCoordinator.markRealmSocketReachability('unreachable');
    logRendererEvent({
      level: 'error',
      area: 'realm-realtime',
      message: 'action:connect:failed',
      details: {
        error: error instanceof Error ? error.message : String(error || 'unavailable'),
      },
    });
  });

  return () => {
    active = false;
    closeConnection();
    globalThis.clearInterval(notificationInterval);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
