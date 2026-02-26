import type { ChatViewDto } from '@nimiplatform/sdk/realm';
import type { MessageViewDto } from '@nimiplatform/sdk/realm';
import { EMPTY_MESSAGE_LIST, type StoreActionContext } from './action-context';
import type { MessageListState } from '../store-types';

export function setChatsState(
  ctx: StoreActionContext,
  chats: ChatViewDto[],
  cursor: string | null,
  hasMore: boolean,
) {
  ctx.state.chats = {
    items: chats,
    cursor,
    hasMore,
    isLoading: false,
  };
  ctx.emit('chatsChange', ctx.state.chats);
}

export function appendChatsState(
  ctx: StoreActionContext,
  chats: ChatViewDto[],
  cursor: string | null,
  hasMore: boolean,
) {
  const existingIds = new Set(ctx.state.chats.items.map((chat) => chat.id));
  const newItems = chats.filter((chat) => !existingIds.has(chat.id));
  ctx.state.chats.items.push(...newItems);
  ctx.state.chats.cursor = cursor;
  ctx.state.chats.hasMore = hasMore;
  ctx.state.chats.isLoading = false;
  ctx.emit('chatsChange', ctx.state.chats);
}

export function updateChatState(
  ctx: StoreActionContext,
  chatId: string,
  updates: Partial<ChatViewDto>,
) {
  const index = ctx.state.chats.items.findIndex((chat) => chat.id === chatId);
  if (index < 0) {
    return;
  }
  const current = ctx.state.chats.items[index];
  if (!current) {
    return;
  }
  Object.assign(current, updates);
  ctx.emit('chatsChange', ctx.state.chats);
}

export function setChatsLoadingState(ctx: StoreActionContext, loading: boolean) {
  ctx.state.chats.isLoading = loading;
  ctx.emit('chatsChange', ctx.state.chats);
}

export function getMessagesState(ctx: StoreActionContext, chatId: string): MessageListState {
  return ctx.state.messages.get(chatId) || EMPTY_MESSAGE_LIST;
}

export function setMessagesState(
  ctx: StoreActionContext,
  chatId: string,
  messages: MessageViewDto[],
  cursor: string | null,
  hasMore: boolean,
) {
  const nextState: MessageListState = { items: messages, cursor, hasMore, isLoading: false };
  ctx.state.messages.set(chatId, nextState);
  ctx.emit('messagesChange', { chatId, messages: nextState });
}

export function appendMessagesState(
  ctx: StoreActionContext,
  chatId: string,
  messages: MessageViewDto[],
  cursor: string | null,
  hasMore: boolean,
) {
  const current = getMessagesState(ctx, chatId);
  const existingIds = new Set(current.items.map((message) => message.id));
  const newItems = messages.filter((message) => !existingIds.has(message.id));
  const nextState: MessageListState = {
    items: [...current.items, ...newItems],
    cursor,
    hasMore,
    isLoading: false,
  };
  ctx.state.messages.set(chatId, nextState);
  ctx.emit('messagesChange', { chatId, messages: nextState });
}

export function prependMessageState(ctx: StoreActionContext, chatId: string, message: MessageViewDto) {
  const current = getMessagesState(ctx, chatId);
  const nextState: MessageListState = { ...current, items: [message, ...current.items] };
  ctx.state.messages.set(chatId, nextState);
  ctx.emit('messagesChange', { chatId, messages: nextState });
}

export function setMessagesLoadingState(ctx: StoreActionContext, chatId: string, loading: boolean) {
  const current = getMessagesState(ctx, chatId);
  const nextState: MessageListState = { ...current, isLoading: loading };
  ctx.state.messages.set(chatId, nextState);
  ctx.emit('messagesChange', { chatId, messages: nextState });
}
