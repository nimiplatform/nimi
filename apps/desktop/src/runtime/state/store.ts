import type {
  ContactsState,
  MessageListState,
  StoreState,
  StoreEventMap,
} from './store-types';
import type { ChatViewDto } from '@nimiplatform/sdk-realm/models/ChatViewDto';
import type { MessageViewDto } from '@nimiplatform/sdk-realm/models/MessageViewDto';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import { MemoryCache } from './core/cache';
import { EventEmitter } from './core/event-emitter';
import {
  getStateAtPath,
  loadPersistedState as loadPersistedStateCore,
  persistState as persistStateCore,
  setStateAtPath,
} from './core/state-access';
import { RuntimeStorage } from './core/storage';
import {
  addBlockedContactState,
  appendChatsState,
  appendExploreItemsState,
  appendMessagesState,
  clearAuthState,
  getAuthToken,
  getAuthUser,
  getMessagesState,
  prependMessageState,
  removeBlockedContactState,
  setAuthState,
  setContactsLoadingState,
  setContactsState,
  setChatsLoadingState,
  setChatsState,
  setCurrentPageState,
  setCurrentSessionState,
  setExploreItemsState,
  setExploreLoadingState,
  setExploreTagState,
  setMessagesLoadingState,
  setMessagesState,
  setRouteState,
  toggleDevPanelState,
  updateChatState,
  type StoreActionContext,
} from './actions';
import { createInitialStoreState } from './slices/initial-state';

export class Store extends EventEmitter<StoreEventMap> {
  cache: MemoryCache;
  state: StoreState;
  private readonly actionContext: StoreActionContext;

  constructor() {
    super((event, error) => {
      emitRuntimeLog({
        level: 'error',
        area: 'runtime-store',
        message: 'action:event-handler:failed',
        details: {
          event: String(event),
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    });
    this.cache = new MemoryCache();
    this.state = createInitialStoreState();
    this.actionContext = {
      state: this.state,
      persistState: () => this.persistState(),
      emit: (event, payload) => this.emit(event, payload),
    };

    this.loadPersistedState();
  }

  loadPersistedState() { loadPersistedStateCore(this.state); }
  persistState() { persistStateCore(this.state); }
  getState<T = unknown>(path?: string): T | undefined { return getStateAtPath<T>(this.state, path); }
  setState(path: string, value: unknown) {
    const result = setStateAtPath(this.state, path, value);
    if (!result.changed) return;
    this.emit('stateChange', { path, value, oldValue: result.oldValue });
    if (result.rootKey && ['auth', 'settings', 'ui'].includes(result.rootKey)) this.persistState();
  }
  updateState(path: string, updates: unknown) {
    const current = this.getState(path);
    if (typeof current === 'object' && current !== null) this.setState(path, { ...(current as Record<string, unknown>), ...(updates as Record<string, unknown>) });
    else this.setState(path, updates);
  }

  setAuth(user: unknown, token: string) { setAuthState(this.actionContext, user, token); }
  clearAuth() { clearAuthState(this.actionContext); }
  getToken() { return getAuthToken(this.actionContext); }
  getCurrentUser() { return getAuthUser(this.actionContext); }
  setCurrentSession(session: unknown, agent: unknown = null) { setCurrentSessionState(this.actionContext, session, agent); }
  setRoute(route: unknown) { setRouteState(this.actionContext, route); }
  setChats(chats: ChatViewDto[], cursor: string | null = null, hasMore = false) { setChatsState(this.actionContext, chats, cursor, hasMore); }
  appendChats(chats: ChatViewDto[], cursor: string | null, hasMore: boolean) { appendChatsState(this.actionContext, chats, cursor, hasMore); }
  updateChat(chatId: string, updates: Partial<ChatViewDto>) { updateChatState(this.actionContext, chatId, updates); }
  setChatsLoading(loading: boolean) { setChatsLoadingState(this.actionContext, loading); }
  getMessages(chatId: string): MessageListState { return getMessagesState(this.actionContext, chatId); }
  setMessages(chatId: string, messages: MessageViewDto[], cursor: string | null = null, hasMore = false) { setMessagesState(this.actionContext, chatId, messages, cursor, hasMore); }
  appendMessages(chatId: string, messages: MessageViewDto[], cursor: string | null, hasMore: boolean) { appendMessagesState(this.actionContext, chatId, messages, cursor, hasMore); }
  prependMessage(chatId: string, message: MessageViewDto) { prependMessageState(this.actionContext, chatId, message); }
  setMessagesLoading(chatId: string, loading: boolean) { setMessagesLoadingState(this.actionContext, chatId, loading); }
  setContacts(
    contacts: Partial<Pick<ContactsState, 'friends' | 'agents' | 'groups' | 'pendingReceived' | 'pendingSent' | 'blocked'>>,
  ) {
    setContactsState(this.actionContext, contacts);
  }
  setContactsLoading(loading: boolean) { setContactsLoadingState(this.actionContext, loading); }
  addBlockedContact(contact: Record<string, unknown>) { addBlockedContactState(this.actionContext, contact); }
  removeBlockedContact(contactId: string) { removeBlockedContactState(this.actionContext, contactId); }
  setExploreItems(items: Array<Record<string, unknown>>, cursor: string | null = null, hasMore = false) { setExploreItemsState(this.actionContext, items, cursor, hasMore); }
  appendExploreItems(items: Array<Record<string, unknown>>, cursor: string | null, hasMore: boolean) { appendExploreItemsState(this.actionContext, items, cursor, hasMore); }
  setExploreLoading(loading: boolean) { setExploreLoadingState(this.actionContext, loading); }
  setExploreTag(tag: string | null) { setExploreTagState(this.actionContext, tag); }
  setCurrentPage(page: string) { setCurrentPageState(this.actionContext, page); }
  toggleDevPanel() { toggleDevPanelState(this.actionContext); }
  cacheGet(key: string) { return this.cache.get(key); }
  cacheSet(key: string, value: unknown, ttlMs?: number) { this.cache.set(key, value, ttlMs); }
  cacheInvalidate(pattern: string | RegExp) { this.cache.invalidate(pattern); }
  clear() {
    this.cache.clear();
    RuntimeStorage.clear();
    this.state.messages.clear();
  }
}

export const store = new Store();
