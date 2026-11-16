import type { RuntimeDefaults } from '../../bridge';
import type { ConversationSourceFilter, ConversationSetupState, ConversationViewMode } from '@nimiplatform/kit/features/chat/headless';
import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import type { HomeChatMode, ChatSetupStateByMode, LastSelectedThreadByMode, ViewModeBySourceTarget } from '../../features/chat/chat-shell-types';
import type { ChatThinkingPreference } from '../../features/chat/chat-shared-thinking';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';

export type AuthStatus =
  | 'bootstrapping'
  | 'anonymous'
  | 'login-pending'
  | 'authenticated'
  | 'refresh-pending'
  | 'expired'
  | 'reauth-required'
  | 'switching'
  | 'logging-out'
  | 'unavailable';

export type RuntimeAccountAuthProjection = {
  status: Exclude<AuthStatus, 'bootstrapping'>;
  sequence: string;
  reasonCode: number;
  accountReasonCode: number;
  deletedOwner?: { accountId: string; realmEnvironmentId: string };
  authorizationRevision: string;
  user: Record<string, unknown> | null;
  failureDetail?: string;
};
export type AppTab =
  | 'home'
  | 'chat'
  | 'contacts'
  | 'explore'
  | 'connections'
  | 'apps'
  | 'runtime'
  | 'cloud'
  | 'downloads'
  | 'diagnostics'
  | 'settings'
  | 'profile'
  | 'source-detail'
  | 'world-detail'
  | 'notification';
export type StatusKind = 'info' | 'success' | 'warning' | 'error';
export type WorldDetailInitialSubpage = 'relationship-explorer' | 'reader';
export type WorldDetailNavigationOptions = {
  initialSubpage?: WorldDetailInitialSubpage | null;
};

export type RuntimeFieldMap = {
  targetType: string;
  targetAccountId: string;
  agentId: string;
  targetId: string;
  worldId: string;
  mode: 'STORY' | 'SCENE_TURN';
  turnIndex: number;
  userConfirmedUpload: boolean;
};

export type AppStoreState = {
  bootstrapReady: boolean;
  bootstrapError: string | null;
  // The typed reason while Runtime serves only its maintenance surface
  // because an owner refused the stored data in the selected root.
  runtimeMaintenance: string | null;
  runtimeDefaults: RuntimeDefaults | null;
  auth: {
    status: AuthStatus;
    user: Record<string, unknown> | null;
    sequence: string;
    reasonCode: number;
    accountReasonCode: number;
  deletedOwner?: { accountId: string; realmEnvironmentId: string };
    /** Runtime Account authorization continuity only, never a generic App scope. */
    authorizationRevision: string;
    /** Why the account could not be confirmed, while it is unavailable. */
    failureDetail?: string;
  };
  runtimeFields: RuntimeFieldMap;
  chatThinkingPreference: ChatThinkingPreference;
  chatSourceFilter: ConversationSourceFilter;
  viewModeBySourceTarget: ViewModeBySourceTarget;
  lastSelectedThreadByMode: LastSelectedThreadByMode;
  /**
   * Unsent Home shortcut text by account and view-local partner reference. It outlives route
   * changes and a temporary Runtime/account outage; ending the session clears it.
   */
  homePartnerDrafts: Readonly<Record<string, string>>;
  /** Text typed on Home that Nimi Chat opens a new conversation with. */
  nimiComposerPrefillSerial: number;
  pendingNimiComposerPrefill: { text: string; requestId: number } | null;
  chatSetupState: ChatSetupStateByMode;
  profileDetailOverlayOpen: boolean;
  primaryRailVisible: boolean;
  setPrimaryRailVisible: (visible: boolean) => void;
  offlineTier: OfflineTier;
  setOfflineTier: (tier: OfflineTier) => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (message: string | null) => void;
  setRuntimeMaintenance: (reasonCode: string | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  setAuthBootstrapping: () => void;
  applyRuntimeAccountProjection: (projection: RuntimeAccountAuthProjection) => void;
  applyCurrentUserProfile: (profile: Record<string, unknown>, realmEnvironmentId: string) => void;
  setAuthSession: (user: Record<string, unknown> | null) => void;
  clearAuthSession: () => void;
  setRuntimeField: (key: keyof RuntimeFieldMap, value: string | number | boolean) => void;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
  setChatThinkingPreference: (preference: ChatThinkingPreference) => void;
  setChatSourceFilter: (filter: ConversationSourceFilter) => void;
  setChatViewMode: (
    source: HomeChatMode,
    targetId: string,
    mode: ConversationViewMode,
  ) => void;
  setLastSelectedThreadForMode: (mode: HomeChatMode, threadId: string | null) => void;
  setHomePartnerDraft: (accountId: string, partnerRef: string, text: string) => void;
  setPendingNimiComposerPrefill: (text: string) => void;
  clearPendingNimiComposerPrefill: (requestId: number) => void;
  setChatSetupState: (mode: HomeChatMode, setupState: ConversationSetupState | null) => void;
  setProfileDetailOverlayOpen: (open: boolean) => void;
  setStatusBanner: (banner: InlineFeedbackState | null) => void;
};

export type AppStoreSet = (
  updater: Partial<AppStoreState> | ((state: AppStoreState) => Partial<AppStoreState>),
) => void;

export const INITIAL_RUNTIME_FIELDS: RuntimeFieldMap = {
  targetType: '',
  targetAccountId: '',
  agentId: '',
  targetId: '',
  worldId: '',
  mode: 'STORY',
  turnIndex: 1,
  userConfirmedUpload: false,
};
