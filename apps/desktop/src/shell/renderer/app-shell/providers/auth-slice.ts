import {
  DEFAULT_CHAT_SOURCE_FILTER,
  DEFAULT_SELECTED_TARGET_BY_SOURCE,
  DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
  EMPTY_AGENT_CONVERSATION_SELECTION,
} from '@renderer/features/chat/chat-shell-types';
import type { AppStoreSet, AppStoreState } from './store-types';

type AuthSlice = Pick<AppStoreState,
  'auth'
  | 'setAuthBootstrapping'
  | 'setAuthSession'
  | 'clearAuthSession'
>;

export function createAuthSlice(set: AppStoreSet): AuthSlice {
  return {
    auth: {
      status: 'bootstrapping',
      user: null,
      token: '',
      refreshToken: '',
    },
    setAuthBootstrapping: () =>
      set((state) => ({
        auth: {
          ...state.auth,
          status: 'bootstrapping',
        },
      })),
    setAuthSession: (user, token, refreshToken) =>
      set((state) => ({
        auth: {
          status: 'authenticated',
          user,
          token,
          refreshToken: refreshToken === undefined
            ? state.auth.refreshToken
            : (refreshToken || ''),
        },
      })),
    clearAuthSession: () =>
      set((state) => ({
        auth: {
          status: 'anonymous',
          user: null,
          token: '',
          refreshToken: '',
        },
        selectedChatId: null,
        chatMode: 'ai',
        chatSourceFilter: DEFAULT_CHAT_SOURCE_FILTER,
        selectedTargetBySource: {
          ...DEFAULT_SELECTED_TARGET_BY_SOURCE,
        },
        viewModeBySourceTarget: {
          ...DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
        },
        lastSelectedThreadByMode: {
          ...state.lastSelectedThreadByMode,
          human: null,
          agent: null,
        },
        agentConversationSelection: { ...EMPTY_AGENT_CONVERSATION_SELECTION },
        chatSetupState: {
          ...state.chatSetupState,
          human: null,
          agent: null,
        },
      })),
  };
}
