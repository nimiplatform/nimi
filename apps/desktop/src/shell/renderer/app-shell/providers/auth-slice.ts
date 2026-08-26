import {
  DEFAULT_CHAT_SOURCE_FILTER,
  DEFAULT_SELECTED_TARGET_BY_SOURCE,
  DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
  EMPTY_AGENT_CONVERSATION_SELECTION,
} from '../../features/chat/chat-shell-types';
import type { AppStoreSet, AppStoreState } from './store-types';

type AuthSlice = Pick<AppStoreState,
  'auth'
  | 'setAuthBootstrapping'
  | 'applyRuntimeAccountProjection'
  | 'setAuthSession'
  | 'clearAuthSession'
>;

export function createAuthSlice(set: AppStoreSet): AuthSlice {
  return {
    auth: {
      status: 'bootstrapping',
      user: null,
      sequence: '0',
      reasonCode: 0,
      accountReasonCode: 0,
    },
    setAuthBootstrapping: () =>
      set((state) => ({
        auth: {
          ...state.auth,
          status: 'bootstrapping',
        },
      })),
    applyRuntimeAccountProjection: (projection) =>
      set((state) => ({
        auth: {
          status: projection.status,
          user: projection.user,
          sequence: projection.sequence,
          reasonCode: projection.reasonCode,
          accountReasonCode: projection.accountReasonCode,
        },
        ...(projection.status === 'unavailable' ? {
          selectedTargetBySource: {
            ...state.selectedTargetBySource,
            agent: null,
          },
          lastSelectedThreadByMode: {
            ...state.lastSelectedThreadByMode,
            agent: null,
          },
          agentConversationSelection: { ...EMPTY_AGENT_CONVERSATION_SELECTION },
          agentConversationTargetByHandle: {},
        } : {}),
      })),
    setAuthSession: (user) =>
      set((state) => ({
        auth: state.auth.status === 'authenticated'
          ? { ...state.auth, user }
          : {
              ...state.auth,
              status: 'authenticated',
              user,
            },
      })),
    clearAuthSession: () =>
      set((state) => ({
        auth: {
          status: 'anonymous',
          user: null,
          sequence: state.auth.sequence,
          reasonCode: state.auth.reasonCode,
          accountReasonCode: state.auth.accountReasonCode,
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
        agentConversationTargetByHandle: {},
        chatSetupState: {
          ...state.chatSetupState,
          human: null,
          agent: null,
        },
      })),
  };
}
