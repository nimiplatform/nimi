import { create } from 'zustand';
import type { RuntimeDefaults } from '@renderer/bridge/types.js';

export type AuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

export type MarbleJobState = {
  operationId: string | null;
  marbleWorldId?: string | null;
  status: 'idle' | 'generating' | 'completed' | 'failed';
  viewerUrl?: string | null;
  error?: string | null;
  startedAt: number | null;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

export type AgentChatState = {
  worldId: string;
  agentId: string;
  agentName: string;
  messages: ChatMessage[];
  streaming: boolean;
  partialText: string;
};

export type HumanChatState = {
  chatId: string;
  friendUserId: string;
  messages: ChatMessage[];
};

export type ActiveHumanChat = {
  chatId: string;
  friendName: string;
  messages: ChatMessage[];
  loading: boolean;
};

export type FriendInfo = {
  userId: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
  appContext?: string;
};

export type RightPanelTab = 'agents' | 'people';

export interface DriftAppStore {
  auth: {
    status: AuthStatus;
    user: AuthUser | null;
    token: string;
    refreshToken: string;
  };
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;

  // Marble 3D generation state per world
  marbleJobs: Record<string, MarbleJobState>;

  // Agent chat
  activeChat: AgentChatState | null;

  // Right panel tab selection
  activeRightPanelTab: RightPanelTab;

  // Human chat
  humanChats: Record<string, HumanChatState>;
  activeHumanChat: ActiveHumanChat | null;

  // Social
  friendList: FriendInfo[];
  onlineUsers: Set<string>;

  // Auth actions
  setAuthSession(user: AuthUser, token: string, refreshToken: string): void;
  clearAuthSession(): void;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(error: string | null): void;
  setRuntimeDefaults(defaults: RuntimeDefaults): void;

  // Marble actions
  setMarbleJob(worldId: string, job: MarbleJobState): void;
  clearMarbleJob(worldId: string): void;

  // Agent chat actions
  setActiveChat(chat: AgentChatState | null): void;
  appendChatMessage(message: ChatMessage): void;
  setStreamingState(streaming: boolean, partialText?: string): void;

  // Panel tab actions
  setActiveRightPanelTab(tab: RightPanelTab): void;

  // Human chat actions
  setHumanChat(chatId: string, chat: HumanChatState): void;
  setActiveHumanChat(chat: ActiveHumanChat | null): void;
  appendHumanChatMessage(chatId: string, message: ChatMessage): void;
  appendActiveHumanMessage(message: ChatMessage): void;
  updateHumanMessage(chatId: string, messageId: string, content: string): void;
  removeHumanMessage(chatId: string, messageId: string): void;

  // Social actions
  setFriendList(friends: FriendInfo[]): void;
  setOnlineUsers(userIds: Set<string>): void;
  addOnlineUser(userId: string): void;
  removeOnlineUser(userId: string): void;
}

export const useAppStore = create<DriftAppStore>((set, get) => ({
  auth: {
    status: 'bootstrapping',
    user: null,
    token: '',
    refreshToken: '',
  },
  bootstrapReady: false,
  bootstrapError: null,
  runtimeDefaults: null,
  marbleJobs: {},
  activeChat: null,
  activeRightPanelTab: 'agents',
  humanChats: {},
  activeHumanChat: null,
  friendList: [],
  onlineUsers: new Set<string>(),

  setAuthSession(user, token, refreshToken) {
    set({
      auth: { status: 'authenticated', user, token, refreshToken },
    });
  },

  clearAuthSession() {
    set({
      auth: { status: 'unauthenticated', user: null, token: '', refreshToken: '' },
    });
  },

  setBootstrapReady(ready) {
    set({ bootstrapReady: ready });
  },

  setBootstrapError(error) {
    set({ bootstrapError: error });
  },

  setRuntimeDefaults(defaults) {
    set({ runtimeDefaults: defaults });
  },

  setMarbleJob(worldId, job) {
    set((state) => ({
      marbleJobs: { ...state.marbleJobs, [worldId]: job },
    }));
  },

  clearMarbleJob(worldId) {
    set((state) => {
      const { [worldId]: _, ...rest } = state.marbleJobs;
      return { marbleJobs: rest };
    });
  },

  setActiveChat(chat) {
    set({ activeChat: chat });
  },

  appendChatMessage(message) {
    const current = get().activeChat;
    if (!current) return;
    set({
      activeChat: {
        ...current,
        messages: [...current.messages, message],
      },
    });
  },

  setStreamingState(streaming, partialText) {
    const current = get().activeChat;
    if (!current) return;
    set({
      activeChat: {
        ...current,
        streaming,
        partialText: partialText ?? (streaming ? current.partialText : ''),
      },
    });
  },

  setActiveRightPanelTab(tab) {
    set({ activeRightPanelTab: tab });
  },

  setHumanChat(chatId, chat) {
    set((state) => ({
      humanChats: { ...state.humanChats, [chatId]: chat },
    }));
  },

  setActiveHumanChat(chat) {
    set({ activeHumanChat: chat });
  },

  appendHumanChatMessage(chatId, message) {
    set((state) => {
      const existing = state.humanChats[chatId];
      if (!existing) return state;
      return {
        activeHumanChat: state.activeHumanChat?.chatId === chatId
          ? {
            ...state.activeHumanChat,
            messages: [...state.activeHumanChat.messages, message],
          }
          : state.activeHumanChat,
        humanChats: {
          ...state.humanChats,
          [chatId]: {
            ...existing,
            messages: [...existing.messages, message],
          },
        },
      };
    });
  },

  appendActiveHumanMessage(message) {
    const current = get().activeHumanChat;
    if (!current) return;
    set({
      activeHumanChat: {
        ...current,
        messages: [...current.messages, message],
      },
    });
  },

  updateHumanMessage(chatId, messageId, content) {
    set((state) => {
      const existing = state.humanChats[chatId];
      if (!existing) return state;
      const nextMessages = existing.messages.map((m) =>
        m.id === messageId ? { ...m, content } : m,
      );
      return {
        activeHumanChat: state.activeHumanChat?.chatId === chatId
          ? {
            ...state.activeHumanChat,
            messages: state.activeHumanChat.messages.map((m) =>
              m.id === messageId ? { ...m, content } : m,
            ),
          }
          : state.activeHumanChat,
        humanChats: {
          ...state.humanChats,
          [chatId]: {
            ...existing,
            messages: nextMessages,
          },
        },
      };
    });
  },

  removeHumanMessage(chatId, messageId) {
    set((state) => {
      const existing = state.humanChats[chatId];
      if (!existing) return state;
      return {
        activeHumanChat: state.activeHumanChat?.chatId === chatId
          ? {
            ...state.activeHumanChat,
            messages: state.activeHumanChat.messages.filter((m) => m.id !== messageId),
          }
          : state.activeHumanChat,
        humanChats: {
          ...state.humanChats,
          [chatId]: {
            ...existing,
            messages: existing.messages.filter((m) => m.id !== messageId),
          },
        },
      };
    });
  },

  setFriendList(friends) {
    set({ friendList: friends });
  },

  setOnlineUsers(userIds) {
    set({ onlineUsers: userIds });
  },

  addOnlineUser(userId) {
    set((state) => {
      const next = new Set(state.onlineUsers);
      next.add(userId);
      return { onlineUsers: next };
    });
  },

  removeOnlineUser(userId) {
    set((state) => {
      const next = new Set(state.onlineUsers);
      next.delete(userId);
      return { onlineUsers: next };
    });
  },
}));
