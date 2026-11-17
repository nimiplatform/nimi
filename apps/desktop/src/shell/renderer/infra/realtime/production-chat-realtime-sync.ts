import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { NimiRealmRealtimeTarget } from '@nimiplatform/sdk/app';

import { getOfflineCoordinator } from '../offline/coordinator.js';
import { invalidateNotificationQueries } from '../../features/notification/notification-query.js';
import { getDesktopRealmRealtimeClient } from '../sdk/desktop-nimi-client-session.js';
import type { DesktopRendererEventPort } from '../../renderer/contract.js';

const NOTIFICATION_REFRESH_INTERVAL_MS = 5_000;

// @nimi-authority: rule.nimi.runtime.realm-realtime.r003
export function connectProductionChatRealtimeSync(input: Parameters<DesktopRendererEventPort['connectChatRealtimeSync']>[0]) {
  const offlineCoordinator = getOfflineCoordinator();
  offlineCoordinator.markRealmSocketReachability('unknown');
  const lifetime = new AbortController();
  let selectedChatId: string | null = null;
  let selected: AbortController | undefined;
  let channel: { client: ReturnType<typeof getDesktopRealmRealtimeClient>; id: string } | undefined;
  let notificationRefreshInFlight = false;

  const refreshNotifications = async () => {
    if (lifetime.signal.aborted || notificationRefreshInFlight) return;
    notificationRefreshInFlight = true;
    try { await invalidateNotificationQueries(input.queryClient); }
    finally { notificationRefreshInFlight = false; }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void refreshNotifications();
  };
  void refreshNotifications();
  const notificationInterval = globalThis.setInterval(() => void refreshNotifications(), NOTIFICATION_REFRESH_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const reportFailure = (stage: string, error: unknown) => {
    logRendererEvent({
      level: 'error', area: 'realm-realtime', message: 'action:connect:failed',
      details: { stage, error: error instanceof Error ? error.message : String(error || 'unavailable') },
    });
  };

  const invalidateChat = async (chatId: string) => {
    await Promise.all([
      input.queryClient.invalidateQueries({ queryKey: ['chats'], exact: false }),
      input.queryClient.invalidateQueries({ queryKey: ['messages', chatId], exact: false }),
    ]);
  };

  async function consume(
    { client, id: channelId }: NonNullable<typeof channel>,
    target: NimiRealmRealtimeTarget,
    signal: AbortSignal,
  ): Promise<void> {
    let subscriptionId: string | undefined;
    const isCurrent = () => !signal.aborted && !lifetime.signal.aborted;
    try {
      const subscription = await client.subscribe({ channelId, target });
      const cancel = () => { void subscription.cancel().catch(() => undefined); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        if (!isCurrent()) return;
        for await (const event of subscription) {
          if (!isCurrent()) return;
          subscriptionId = event.subscriptionId || subscriptionId;
          const value = event.event;
          switch (value.type) {
            case 'control':
              if (value.control.lifecycle === 'closed' || value.control.lifecycle === 'failed') return;
              if (value.control.lifecycle === 'ready') {
                if (target.type === 'inbox') {
                  offlineCoordinator.markRealmSocketReachability('reachable');
                  await input.onInboxRefreshed?.({ kind: 'ready' });
                }
                if (isCurrent()) await input.queryClient.invalidateQueries({ queryKey: ['chats'], exact: false });
              }
              break;
            case 'chat':
              await invalidateChat(value.chatId);
              if (isCurrent()) await client.ack({ channelId, subscriptionId: event.subscriptionId, cursor: value.cursor });
              break;
            case 'snapshot':
              await invalidateChat(value.chatId);
              break;
            case 'presence':
              await input.queryClient.invalidateQueries({ queryKey: ['chats'], exact: false });
              break;
            case 'inbox':
              await invalidateChat(value.chatId);
              if (isCurrent()) await input.onInboxRefreshed?.({ kind: 'chat', chatId: value.chatId });
              break;
            case 'typing':
              break;
          }
          if (!isCurrent()) return;
        }
      } finally {
        signal.removeEventListener('abort', cancel);
        await subscription.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (isCurrent()) reportFailure(target.type, error);
    } finally {
      if (subscriptionId) void client.closeSubscription({ channelId, subscriptionId }).catch(() => undefined);
      // An individual Chat or Presence result does not describe the Inbox.
      // Runtime owns connection-level reconnect and scopes its terminal events.
      if (target.type === 'inbox' && isCurrent()) offlineCoordinator.markRealmSocketReachability('unreachable');
    }
  }

  const attachSelected = () => {
    selected?.abort();
    if (!selectedChatId || !channel || lifetime.signal.aborted) { selected = undefined; return; }
    selected = new AbortController();
    void consume(channel, { type: 'chat', chatId: selectedChatId }, selected.signal);
  };

  void (async () => {
    const client = getDesktopRealmRealtimeClient();
    const opened = await client.open();
    if (lifetime.signal.aborted) {
      await client.closeChannel({ channelId: opened.channelId });
      return;
    }
    channel = { client, id: opened.channelId };
    void consume(channel, { type: 'inbox' }, lifetime.signal);
    void consume(channel, { type: 'presence' }, lifetime.signal);
    attachSelected();
  })().catch(error => {
    if (lifetime.signal.aborted) return;
    offlineCoordinator.markRealmSocketReachability('unreachable');
    reportFailure('channel', error);
  });

  return {
    selectChat(chatId: string | null) {
      if (chatId === selectedChatId) return;
      selectedChatId = chatId;
      attachSelected();
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      selected?.abort();
      if (channel) void channel.client.closeChannel({ channelId: channel.id }).catch(() => undefined);
      globalThis.clearInterval(notificationInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
