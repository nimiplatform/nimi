import {
  DEFAULT_CHAT_SOURCE_FILTER,
  DEFAULT_SELECTED_TARGET_BY_SOURCE,
  DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
  EMPTY_AGENT_CONVERSATION_SELECTION,
} from '../../features/chat/chat-shell-types';
import type { AppStoreSet, AppStoreState } from './store-types';

type AuthSlice = Pick<AppStoreState,
  'auth'
  | 'suspendedAgentSelection'
  | 'setAuthBootstrapping'
  | 'applyRuntimeAccountProjection'
  | 'setAuthSession'
  | 'clearAuthSession'
>;

function accountIdOf(user: Record<string, unknown> | null): string {
  return typeof user?.id === 'string' ? user.id : '';
}

export function createAuthSlice(set: AppStoreSet): AuthSlice {
  return {
    suspendedAgentSelection: null,
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
      set((state) => {
        const auth = {
          status: projection.status,
          user: projection.user,
          sequence: projection.sequence,
          reasonCode: projection.reasonCode,
          accountReasonCode: projection.accountReasonCode,
          ...(projection.status === 'unavailable' && projection.failureDetail
            ? { failureDetail: projection.failureDetail }
            : {}),
        };
        if (projection.status === 'unavailable') {
          // Identity is unproven: hide the open partner and conversation, but
          // remember them for the account that had them open.
          const accountId = state.auth.status === 'authenticated' ? accountIdOf(state.auth.user) : '';
          return {
            auth,
            suspendedAgentSelection: accountId
              ? {
                accountId,
                agentTarget: state.selectedTargetBySource.agent,
                agentThread: state.lastSelectedThreadByMode.agent,
                conversationSelection: state.agentConversationSelection,
                conversationTargetByHandle: state.agentConversationTargetByHandle,
              }
              : state.suspendedAgentSelection,
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
          };
        }
        const suspended = state.suspendedAgentSelection;
        if (projection.status === 'authenticated' && suspended) {
          if (suspended.accountId !== accountIdOf(projection.user)) return { auth, suspendedAgentSelection: null };
          return {
            auth,
            suspendedAgentSelection: null,
            selectedTargetBySource: { ...state.selectedTargetBySource, agent: suspended.agentTarget },
            lastSelectedThreadByMode: { ...state.lastSelectedThreadByMode, agent: suspended.agentThread },
            agentConversationSelection: suspended.conversationSelection,
            agentConversationTargetByHandle: suspended.conversationTargetByHandle,
          };
        }
        if (projection.status === 'anonymous' || projection.status === 'switching') {
          return { auth, suspendedAgentSelection: null };
        }
        return { auth };
      }),
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
        suspendedAgentSelection: null,
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
        agentComposerDrafts: {},
        chatSetupState: {
          ...state.chatSetupState,
          human: null,
          agent: null,
        },
      })),
  };
}
