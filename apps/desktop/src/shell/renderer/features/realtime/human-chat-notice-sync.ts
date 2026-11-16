import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { RealmChatViewDto } from '@nimiplatform/kit/features/chat/realm';
import type { ChatInboxRefresh } from '../../renderer/contract.js';
import type { HumanChatListPage } from '../chat/use-human-chat-list.js';
import type { HumanChatNotice } from '../../../shared/human-chat-notice.js';
import type { createHumanChatNoticeTracker } from './human-chat-notices.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.human-chat-notice
export function createHumanChatNoticeSync(input: {
  queryClient: QueryClient;
  chatKey: readonly string[];
  tracker: ReturnType<typeof createHumanChatNoticeTracker>;
  loadChat: (chatId: string) => Promise<RealmChatViewDto>;
  notify: (notice: HumanChatNotice) => Promise<void>;
  isCurrent: () => boolean;
}) {
  let pendingRefresh = false;
  let active = true;
  const current = () => active && input.isCurrent();
  const rows = () => {
    const state = input.queryClient.getQueryState<InfiniteData<HumanChatListPage>>(input.chatKey);
    if (state?.status !== 'success' || state.isInvalidated || state.data?.pages.some(page => page.fromCache)) return undefined;
    return state.data?.pages.flatMap(page => page.items);
  };
  const present = async (notice: HumanChatNotice | null) => {
    if (notice && current()) await input.notify(notice);
  };
  const unsubscribe = input.queryClient.getQueryCache().subscribe(event => {
    if (!current() || !pendingRefresh || event.type !== 'updated' || event.action.type !== 'success'
      || JSON.stringify(event.query.queryKey) !== JSON.stringify(input.chatKey)) return;
    const chats = rows();
    if (!chats) return;
    pendingRefresh = false;
    void present(input.tracker.refresh(chats)).catch(() => undefined);
  });
  return {
    async onInboxRefreshed(refresh: ChatInboxRefresh) {
      if (!current()) return;
      if (refresh.kind === 'ready') {
        // The following authoritative list read may fail. Retain this intent
        // until a later successful read, including a user-initiated recovery.
        pendingRefresh = true;
        return;
      }
      if (pendingRefresh) return;
      const chat = rows()?.find(row => row.id === refresh.chatId) ?? await input.loadChat(refresh.chatId);
      if (current()) await present(input.tracker.change(chat));
    },
    dispose() { active = false; unsubscribe(); },
  };
}
