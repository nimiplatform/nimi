import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loadNimiRealmUserNotificationSettings } from '@nimiplatform/sdk/realm';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRealmHumanChatData } from '../chat/data/realm-human-chat-data-context.js';
import { humanChatListQueryKey } from '../chat/use-human-chat-list.js';
import { useSystemEntry } from '../system-entry/system-entry-context.js';
import { invoke } from '../../bridge/runtime-bridge/invoke.js';
import { SHOW_HUMAN_CHAT_NOTICE } from '../../../shared/human-chat-notice.js';
import { realmNotificationSettingsKey } from '../notification/use-realm-notification-settings.js';
import { createHumanChatNoticeSync } from './human-chat-notice-sync.js';
import { createHumanChatNoticeTracker } from './human-chat-notices.js';

export function useChatRealtimeSync(): void {
  const homeChat = useHomeChatPosition();
  const queryClient = useQueryClient();
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const auth = useAppStore(state => state.auth);
  const chatData = useRealmHumanChatData();
  const { projection } = useSystemEntry();
  const presentation = useRef(projection);
  presentation.current = projection;
  const tracker = useMemo(createHumanChatNoticeTracker, [auth.user?.id, auth.user?.realmEnvironmentId, auth.authorizationRevision]);
  const selectedChatId = homeChat.humanThreadId;
  useEffect(() => {
    const scope = captureAccountActionScope(store);
    if (!scope) return undefined;
    const chatKey = humanChatListQueryKey(scope.realmEnvironmentId, scope.accountId);
    const sync = createHumanChatNoticeSync({
      queryClient, chatKey, tracker, loadChat: chatData.loadChatById, isCurrent: scope.isCurrent,
      async notify(notice) {
        // Read the shared account preference for every candidate, even when
        // this renderer last observed it disabled on another device.
        const settings = await queryClient.fetchQuery({
          queryKey: realmNotificationSettingsKey(scope.realmEnvironmentId, scope.accountId, auth.authorizationRevision),
          queryFn: () => loadNimiRealmUserNotificationSettings(bindings.sdk.realm()),
          staleTime: 0,
        });
        const projection = presentation.current;
        if (!scope.isCurrent() || settings.activity?.directMessages === false || !projection
          || projection.notificationsPausedUntil > Date.now()) return;
        await invoke(SHOW_HUMAN_CHAT_NOTICE, { payload: { generation: projection.generation, notice } });
      },
    });
    const disconnect = bindings.app.events.connectChatRealtimeSync({
      queryClient,
      selectedChatId,
      async onInboxRefreshed(refresh) {
        try { await sync.onInboxRefreshed(refresh); }
        catch { /* Reminder failures do not terminate message delivery. */ }
      },
    });
    return () => {
      sync.dispose();
      scope.dispose();
      disconnect();
    };
  }, [auth.status, tracker, bindings, chatData, queryClient, selectedChatId, store]);
}
