import type { ChatViewDto } from '@nimiplatform/sdk/realm';
import type { MessageViewDto } from '@nimiplatform/sdk/realm';

export type AuthState = {
  isAuthenticated: boolean;
  user: unknown;
  token: string | null;
  refreshToken?: string | null;
};

export type SessionState = {
  currentSession: unknown;
  currentAgent: unknown;
  route: unknown;
};

export type ChatsState = {
  items: ChatViewDto[];
  cursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
};

export type ContactsState = {
  friends: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  pendingReceived: Array<Record<string, unknown>>;
  pendingSent: Array<Record<string, unknown>>;
  blocked: Array<Record<string, unknown>>;
  isLoading: boolean;
};

export type MessageListState = {
  items: MessageViewDto[];
  cursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
};

export type MessagesChangePayload = {
  chatId: string;
  messages: MessageListState;
};

export type ExploreState = {
  items: Array<Record<string, unknown>>;
  cursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
  currentTag: string | null;
};

export type SettingsState = {
  apiUrl: string;
  userSettings: unknown;
};

export type UiState = {
  currentPage: string;
  sidebarCollapsed: boolean;
  devPanelOpen: boolean;
};

export type StoreState = {
  auth: AuthState;
  session: SessionState;
  chats: ChatsState;
  contacts: ContactsState;
  messages: Map<string, MessageListState>;
  explore: ExploreState;
  settings: SettingsState;
  ui: UiState;
};

export type StoreEventMap = {
  authChange: AuthState;
  sessionChange: SessionState;
  routeChange: unknown;
  chatsChange: ChatsState;
  contactsChange: ContactsState;
  messagesChange: MessagesChangePayload;
  exploreChange: ExploreState;
  uiChange: UiState;
  stateChange: { path: string; value: unknown; oldValue: unknown };
};
