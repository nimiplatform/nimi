import type { QueryClient, QueryKey } from '@tanstack/react-query';
import {
  applyRealmRealtimeMessageToChatsResult,
  mergeRealmRealtimeMessageIntoMessagesResult,
  type RealmListChatsResultDto,
  type RealmListMessagesResultDto,
  type RealmMessageViewDto,
} from '@nimiplatform/nimi-kit/features/chat/realm';

type MergeSentRealmChatMessageIntoCacheInput = {
  queryClient: QueryClient;
  message: RealmMessageViewDto;
  currentUserId: string;
  selectedChatId: string | null;
};

export function mergeSentRealmChatMessageIntoCache(
  input: MergeSentRealmChatMessageIntoCacheInput,
): void {
  input.queryClient.setQueryData<RealmListMessagesResultDto>(
    ['messages', input.message.chatId],
    (current) => mergeRealmRealtimeMessageIntoMessagesResult(current, input.message),
  );

  const chatQueries = input.queryClient.getQueriesData<RealmListChatsResultDto>({
    queryKey: ['chats'],
  });

  let found = false;
  for (const [queryKey, current] of chatQueries) {
    const result = applyRealmRealtimeMessageToChatsResult({
      current,
      message: input.message,
      currentUserId: input.currentUserId,
      selectedChatId: input.selectedChatId,
    });
    found = found || result.found;
    input.queryClient.setQueryData(queryKey as QueryKey, result.data);
  }

  if (!found) {
    void input.queryClient.invalidateQueries({ queryKey: ['chats'] });
  }
}
