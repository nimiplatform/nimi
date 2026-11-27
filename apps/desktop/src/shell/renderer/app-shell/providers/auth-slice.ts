import {
  DEFAULT_CHAT_SETUP_STATE,
  DEFAULT_CHAT_SOURCE_FILTER,
  DEFAULT_LAST_SELECTED_THREAD_BY_MODE,
  DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
} from '../../features/chat/chat-shell-types';
import {
  INITIAL_RUNTIME_FIELDS,
  type AppStoreSet,
  type AppStoreState,
  type RuntimeAccountAuthProjection,
} from './store-types';

type AuthSlice = Pick<AppStoreState,
  'auth'
  | 'setAuthBootstrapping'
  | 'applyRuntimeAccountProjection'
  | 'setAuthSession'
  | 'applyCurrentUserProfile'
  | 'clearAuthSession'
>;

type AccountScopedViewStateReset = Pick<AppStoreState,
  | 'chatSourceFilter'
  | 'viewModeBySourceTarget'
  | 'lastSelectedThreadByMode'
  | 'chatSetupState'
  | 'runtimeFields'
  | 'homePartnerDrafts'
  | 'pendingNimiComposerPrefill'
  | 'profileDetailOverlayOpen'
>;

type EstablishedAuthIdentity = {
  readonly accountId: string;
  readonly realmEnvironmentId: string;
  readonly authorizationRevision: string;
};

function accountIdOf(user: Record<string, unknown> | null): string {
  return typeof user?.id === 'string' ? user.id : '';
}

function realmEnvironmentIdOf(user: Record<string, unknown> | null): string {
  return typeof user?.realmEnvironmentId === 'string' ? user.realmEnvironmentId : '';
}

function isContinuousAuthStatus(status: AppStoreState['auth']['status']): boolean {
  return status === 'authenticated' || status === 'refresh-pending';
}

function establishedIdentityOf(
  auth: Pick<AppStoreState['auth'], 'status' | 'user' | 'authorizationRevision'>,
): EstablishedAuthIdentity | null {
  if (!isContinuousAuthStatus(auth.status)) {
    return null;
  }
  const accountId = accountIdOf(auth.user).trim();
  const realmEnvironmentId = realmEnvironmentIdOf(auth.user).trim();
  const authorizationRevision = auth.authorizationRevision.trim();
  if (!accountId || !realmEnvironmentId || !authorizationRevision) {
    return null;
  }
  return { accountId, realmEnvironmentId, authorizationRevision };
}

function sameEstablishedIdentity(
  left: EstablishedAuthIdentity | null,
  right: EstablishedAuthIdentity | null,
): boolean {
  return Boolean(left && right)
    && left!.accountId === right!.accountId
    && left!.realmEnvironmentId === right!.realmEnvironmentId
    && left!.authorizationRevision === right!.authorizationRevision;
}

function preservesProfile(previous: AppStoreState['auth'], next: RuntimeAccountAuthProjection): boolean {
  return sameEstablishedIdentity(establishedIdentityOf(previous), establishedIdentityOf(next));
}

function createAccountScopedViewStateReset(): AccountScopedViewStateReset {
  return {
    chatSourceFilter: DEFAULT_CHAT_SOURCE_FILTER,
    viewModeBySourceTarget: { ...DEFAULT_VIEW_MODE_BY_SOURCE_TARGET },
    lastSelectedThreadByMode: { ...DEFAULT_LAST_SELECTED_THREAD_BY_MODE },
    chatSetupState: { ...DEFAULT_CHAT_SETUP_STATE },
    runtimeFields: { ...INITIAL_RUNTIME_FIELDS },
    homePartnerDrafts: {},
    pendingNimiComposerPrefill: null,
    profileDetailOverlayOpen: false,
  };
}

function endsAccountSession(status: RuntimeAccountAuthProjection['status']): boolean {
  return status === 'anonymous'
    || status === 'switching'
    || status === 'reauth-required'
    || status === 'expired'
    || status === 'logging-out';
}

export function createAuthSlice(set: AppStoreSet): AuthSlice {
  let lastEstablishedIdentity: EstablishedAuthIdentity | null = null;
  return {
    auth: {
      status: 'bootstrapping',
      user: null,
      sequence: '0',
      reasonCode: 0,
      accountReasonCode: 0,
      authorizationRevision: '',
    },
    setAuthBootstrapping: () => set((state) => {
      lastEstablishedIdentity = establishedIdentityOf(state.auth) ?? lastEstablishedIdentity;
      return {
        auth: {
          ...state.auth,
          status: 'bootstrapping',
          authorizationRevision: '',
        },
      };
    }),
    applyRuntimeAccountProjection: (projection) =>
      set((state) => {
        // @nimi-authority: rule.nimi.desktop.shell-runtime.r011
        // Preserve only profile presentation within proven Account continuity.
        // The incoming Runtime identity, state and authorization remain authoritative.
        const continuous = preservesProfile(state.auth, projection);
        const user = continuous
          ? { ...state.auth.user, ...projection.user }
          : projection.user;
        const auth = {
          status: projection.status,
          user,
          sequence: projection.sequence,
          reasonCode: projection.reasonCode,
          accountReasonCode: projection.accountReasonCode,
          deletedOwner: projection.deletedOwner,
          authorizationRevision: isContinuousAuthStatus(projection.status)
            ? projection.authorizationRevision : '',
          ...(projection.status === 'unavailable' && projection.failureDetail
            ? { failureDetail: projection.failureDetail }
            : {}),
        };
        if (endsAccountSession(projection.status)) {
          lastEstablishedIdentity = null;
          return { auth, ...createAccountScopedViewStateReset() };
        }
        if (projection.status === 'unavailable') {
          const priorIdentity = establishedIdentityOf(state.auth);
          if (priorIdentity) {
            lastEstablishedIdentity = priorIdentity;
          }
          return { auth, pendingNimiComposerPrefill: null };
        }
        if (isContinuousAuthStatus(projection.status)) {
          const nextIdentity = establishedIdentityOf(projection);
          const previousContinuous = isContinuousAuthStatus(state.auth.status);
          const identityChanged = previousContinuous
            ? !continuous
            : lastEstablishedIdentity !== null && !sameEstablishedIdentity(lastEstablishedIdentity, nextIdentity);
          lastEstablishedIdentity = nextIdentity;
          if (identityChanged) {
            return { auth, ...createAccountScopedViewStateReset() };
          }
          return { auth };
        }
        // login-pending: if we somehow left an established account, clear account-scoped view state.
        if (isContinuousAuthStatus(state.auth.status) || lastEstablishedIdentity !== null) {
          lastEstablishedIdentity = null;
          return { auth, ...createAccountScopedViewStateReset() };
        }
        return { auth };
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
    clearAuthSession: () => {
      lastEstablishedIdentity = null;
      set((state) => ({
        auth: {
          status: 'anonymous',
          user: null,
          sequence: state.auth.sequence,
          reasonCode: state.auth.reasonCode,
          accountReasonCode: state.auth.accountReasonCode,
          authorizationRevision: '',
        },
        ...createAccountScopedViewStateReset(),
      }));
    },
  };
}
