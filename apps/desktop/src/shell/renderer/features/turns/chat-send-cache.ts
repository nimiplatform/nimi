import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import {
  applyRealmMessageToChatsResult,
  mergeRealmMessageIntoMessagesResult,
  type RealmListChatsResultDto,
  type RealmListMessagesResultDto,
  type RealmMessageViewDto,
} from '@nimiplatform/kit/features/chat/realm';

type MergeSentRealmChatMessageIntoCacheInput = {
  queryClient: QueryClient;
  message: RealmMessageViewDto;
  currentUserId: string;
  realmEnvironmentId: string;
  selectedChatId: string | null;
};

export function mergeSentRealmChatMessageIntoCache(
  input: MergeSentRealmChatMessageIntoCacheInput,
): void {
  input.queryClient.setQueryData<InfiniteData<RealmListMessagesResultDto>>(
    ['messages', input.message.chatId, input.realmEnvironmentId, input.currentUserId],
    current => current ? { ...current, pages: current.pages.map((page, index) => index === 0
      ? mergeRealmMessageIntoMessagesResult(page, input.message) : page) } : undefined,
  );

  const chatQueries = input.queryClient.getQueriesData<InfiniteData<RealmListChatsResultDto>>({
    queryKey: ['chats'],
  });

  let found = false;
  for (const [queryKey, current] of chatQueries) {
    if (queryKey[1] !== input.realmEnvironmentId || queryKey[2] !== input.currentUserId) continue;
    if (!current) continue;
    const pages = current.pages.map(page => {
      const result = applyRealmMessageToChatsResult({ current: page, message: input.message,
        currentUserId: input.currentUserId, selectedChatId: input.selectedChatId });
      found = found || result.found;
      return result.data;
    });
    input.queryClient.setQueryData(queryKey as QueryKey, { ...current, pages });
  }

  if (!found) {
    void input.queryClient.invalidateQueries({ queryKey: ['chats'] });
  }
}
