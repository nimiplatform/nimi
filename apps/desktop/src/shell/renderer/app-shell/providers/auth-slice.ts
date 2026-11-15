import {
  DEFAULT_CHAT_SOURCE_FILTER,
  DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
} from '../../features/chat/chat-shell-types';
import type { AppStoreSet, AppStoreState, RuntimeAccountAuthProjection } from './store-types';

type AuthSlice = Pick<AppStoreState,
  'auth'
  | 'setAuthBootstrapping'
  | 'applyRuntimeAccountProjection'
  | 'setAuthSession'
  | 'applyCurrentUserProfile'
  | 'clearAuthSession'
>;

function accountIdOf(user: Record<string, unknown> | null): string {
  return typeof user?.id === 'string' ? user.id : '';
}

function preservesProfile(previous: AppStoreState['auth'], next: RuntimeAccountAuthProjection): boolean {
  const continuous = (status: AppStoreState['auth']['status']) => status === 'authenticated' || status === 'refresh-pending';
  const accountId = accountIdOf(previous.user);
  const realmEnvironmentId = previous.user?.realmEnvironmentId;
  return continuous(previous.status) && continuous(next.status)
    && Boolean(accountId.trim()) && accountId === accountIdOf(next.user)
    && typeof realmEnvironmentId === 'string' && Boolean(realmEnvironmentId.trim())
    && realmEnvironmentId === next.user?.realmEnvironmentId
    && Boolean(previous.authorizationRevision.trim()) && previous.authorizationRevision === next.authorizationRevision;
}

export function createAuthSlice(set: AppStoreSet): AuthSlice {
  return {
    auth: {
      status: 'bootstrapping',
      user: null,
      sequence: '0',
      reasonCode: 0,
      accountReasonCode: 0,
      authorizationRevision: '',
    },
    setAuthBootstrapping: () =>
      set((state) => ({
        auth: {
          ...state.auth,
          status: 'bootstrapping',
          authorizationRevision: '',
        },
      })),
    applyRuntimeAccountProjection: (projection) =>
      set((state) => {
        // @nimi-authority: rule.nimi.desktop.shell-runtime.r011
        // Preserve only profile presentation within proven Account continuity.
        // The incoming Runtime identity, state and authorization remain authoritative.
        const user = preservesProfile(state.auth, projection)
          ? { ...state.auth.user, ...projection.user }
          : projection.user;
        const auth = {
          status: projection.status,
          user,
          sequence: projection.sequence,
          reasonCode: projection.reasonCode,
          accountReasonCode: projection.accountReasonCode,
          deletedOwner: projection.deletedOwner,
          authorizationRevision: projection.status === 'authenticated' || projection.status === 'refresh-pending'
            ? projection.authorizationRevision : '',
          ...(projection.status === 'unavailable' && projection.failureDetail
            ? { failureDetail: projection.failureDetail }
            : {}),
        };
        if (projection.status === 'anonymous' || projection.status === 'switching') {
          return { auth, pendingNimiComposerPrefill: null, homePartnerDrafts: {} };
        }
        if (projection.status === 'authenticated' && accountIdOf(state.auth.user) && accountIdOf(state.auth.user) !== accountIdOf(projection.user)) {
          return { auth, pendingNimiComposerPrefill: null };
        }
        return { auth, ...(projection.status === 'unavailable' ? { pendingNimiComposerPrefill: null } : {}) };
      }),
    applyCurrentUserProfile: (profile, realmEnvironmentId) => set((state) => {
      const current = state.auth.user;
      if (state.auth.status !== 'authenticated' || !current || profile.id !== current.id
        || !realmEnvironmentId || current.realmEnvironmentId !== realmEnvironmentId) return state;
      if (Object.entries(profile).every(([key, value]) => key === 'realmEnvironmentId' || current[key] === value)) return state;
      return { auth: { ...state.auth, user: { ...current, ...profile, id: current.id, realmEnvironmentId: current.realmEnvironmentId } } };
    }),
    setAuthSession: (user) =>
      set((state) => ({
        auth: state.auth.status === 'authenticated'
          ? { ...state.auth, user, authorizationRevision: Boolean(accountIdOf(user)) && user?.id === state.auth.user?.id
              && typeof user?.realmEnvironmentId === 'string' && Boolean(user.realmEnvironmentId)
              && user.realmEnvironmentId === state.auth.user?.realmEnvironmentId ? state.auth.authorizationRevision : '' }
          : {
              ...state.auth,
              status: 'authenticated',
              user,
              authorizationRevision: '',
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
          authorizationRevision: '',
        },
        chatSourceFilter: DEFAULT_CHAT_SOURCE_FILTER,
        viewModeBySourceTarget: {
          ...DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
        },
        lastSelectedThreadByMode: {
          ...state.lastSelectedThreadByMode,
          human: null,
        },
        homePartnerDrafts: {},
        pendingNimiComposerPrefill: null,
        chatSetupState: {
          ...state.chatSetupState,
          human: null,
        },
      })),
  };
}
