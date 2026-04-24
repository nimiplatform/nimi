import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { i18n } from '@renderer/i18n';
import { AddFriendModal } from './add-friend-modal';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { CreatePostModal } from '@renderer/features/profile/create-post-modal.js';
import type { PostCardActionAdapter } from './post-card';

function createOpenChatError(): Error {
  return new Error(i18n.t('Contacts.openChatFailed', { defaultValue: 'Failed to open chat' }));
}

export function usePostCardActionAdapter(): PostCardActionAdapter {
  const queryClient = useQueryClient();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUserId = String(useAppStore((state) => state.auth.user?.id || '')).trim() || null;

  return useMemo<PostCardActionAdapter>(() => ({
    realmBaseUrl,
    authStatus,
    currentUserId,
    isFriend: (authorId) => dataSync.isFriend(authorId),
    blockUser: (author) => dataSync.blockUser(author),
    createReport: (payload) => dataSync.createReport(payload),
    likePost: (postId) => dataSync.likePost(postId),
    unlikePost: (postId) => dataSync.unlikePost(postId),
    updatePostVisibility: (postId, visibility) => dataSync.updatePostVisibility(postId, visibility),
    deletePost: (postId) => dataSync.deletePost(postId),
    requestOrAcceptFriend: (authorId, message) => dataSync.requestOrAcceptFriend(authorId, message),
    invalidateContacts: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
    openChat: async ({ authorId }) => {
      const result = await dataSync.startChat(authorId);
      if (!result?.chatId) {
        throw createOpenChatError();
      }
      const requestedChatId = String(
        (result.chat && typeof result.chat === 'object'
          ? (result.chat as { id?: string | number }).id
          : null)
        ?? result.chatId,
      ).trim();
      if (!requestedChatId) {
        throw createOpenChatError();
      }
      const chatsSnapshot = await dataSync.loadChats();
      const createdChat = result.chat && typeof result.chat === 'object'
        ? ({
          ...(result.chat as Record<string, unknown>),
          id: String((result.chat as { id?: string | number }).id ?? requestedChatId),
        })
        : null;
      const snapshotItems = Array.isArray((chatsSnapshot as { items?: unknown[] })?.items)
        ? (chatsSnapshot as { items: unknown[] }).items
        : [];
      const matchedChat = snapshotItems.find((item) => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const otherUser = (item as { otherUser?: { id?: string | number } }).otherUser;
        return String(otherUser?.id ?? '').trim() === authorId;
      });
      const chatId = String(
        (matchedChat && typeof matchedChat === 'object'
          ? (matchedChat as { id?: string | number }).id
          : null)
        ?? createdChat?.id
        ?? requestedChatId,
      ).trim();
      if (!chatId) {
        throw createOpenChatError();
      }
      const mergedItems = createdChat
        ? [createdChat, ...snapshotItems.filter((item) => String((item as { id?: string | number })?.id ?? '') !== chatId)]
        : snapshotItems;
      const nextChatsSnapshot = { ...chatsSnapshot, items: mergedItems };
      queryClient.setQueryData(['chats', authStatus], nextChatsSnapshot);
      queryClient.setQueryData(['chats'], nextChatsSnapshot);
      setSelectedChatId(chatId);
      setRuntimeFields({
        targetType: 'FRIEND',
        targetAccountId: authorId,
        agentId: '',
        worldId: '',
      });
      setActiveTab('chat');
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          setSelectedChatId(chatId);
        });
      }
    },
    renderGiftSurface: (input) => (
      <SendGiftModal
        open={input.open}
        receiverId={input.authorId}
        receiverName={input.authorName}
        receiverHandle={input.authorHandle}
        receiverIsAgent={input.authorIsAgent}
        receiverAvatarUrl={input.authorAvatarUrl}
        onClose={input.onClose}
        onSent={input.onSent}
      />
    ),
    renderFriendRequestSurface: (input) => (
      <AddFriendModal
        author={input.author}
        isOpen={input.open}
        onClose={input.onClose}
        onAddFriend={input.onAddFriend}
      />
    ),
    renderEditPostSurface: (input) => (
      <CreatePostModal
        open={input.open}
        initialPost={input.initialPost}
        onClose={input.onClose}
        onComplete={input.onComplete}
      />
    ),
  }), [
    authStatus,
    currentUserId,
    queryClient,
    realmBaseUrl,
    setActiveTab,
    setRuntimeFields,
    setSelectedChatId,
  ]);
}
