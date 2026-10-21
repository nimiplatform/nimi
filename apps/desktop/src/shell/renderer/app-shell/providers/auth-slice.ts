import {
  DEFAULT_CHAT_SOURCE_FILTER,
  DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
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

function releaseAttachmentDrafts(state: AppStoreState) {
  for (const items of Object.values(state.agentComposerAttachments)) {
    for (const item of items) URL.revokeObjectURL(item.previewUrl);
  }
  return { agentComposerAttachments: {} };
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
                conversationTargetByHandle: state.agentConversationTargetByHandle,
              }
              : state.suspendedAgentSelection,
            lastSelectedThreadByMode: {
              ...state.lastSelectedThreadByMode,
              agent: null,
            },
            agentConversationTargetByHandle: {},
          };
        }
        const suspended = state.suspendedAgentSelection;
        if (projection.status === 'authenticated' && suspended) {
          if (suspended.accountId !== accountIdOf(projection.user)) return { auth, suspendedAgentSelection: null, ...releaseAttachmentDrafts(state) };
          return {
            auth,
            suspendedAgentSelection: null,
            agentConversationTargetByHandle: suspended.conversationTargetByHandle,
          };
        }
        if (projection.status === 'anonymous' || projection.status === 'switching') {
          return { auth, suspendedAgentSelection: null, agentConversationTargetByHandle: {}, pendingAgentComposerPrefill: null, pendingNimiComposerPrefill: null, ...releaseAttachmentDrafts(state) };
        }
        if (projection.status === 'authenticated' && accountIdOf(state.auth.user) && accountIdOf(state.auth.user) !== accountIdOf(projection.user)) {
          return { auth, agentConversationTargetByHandle: {}, pendingAgentComposerPrefill: null, pendingNimiComposerPrefill: null, ...releaseAttachmentDrafts(state) };
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
        chatSourceFilter: DEFAULT_CHAT_SOURCE_FILTER,
        viewModeBySourceTarget: {
          ...DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
        },
        lastSelectedThreadByMode: {
          ...state.lastSelectedThreadByMode,
          human: null,
          agent: null,
        },
        agentConversationTargetByHandle: {},
        agentComposerDrafts: {},
        ...releaseAttachmentDrafts(state),
        chatSetupState: {
          ...state.chatSetupState,
          human: null,
          agent: null,
        },
      })),
  };
}
