import type { RuntimeDefaults } from '../../bridge';
import type { ConversationMode, ConversationSourceFilter, ConversationSetupState, ConversationViewMode } from '@nimiplatform/kit/features/chat/headless';
import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import type { AgentComposerPrefill, ChatSetupStateByMode, LastSelectedThreadByMode, ViewModeBySourceTarget } from '../../features/chat/chat-shell-types';
import type { ChatThinkingPreference } from '../../features/chat/chat-shared-thinking';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
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

export type SuspendedAgentSelection = {
  readonly accountId: string;
  readonly conversationTargetByHandle: Record<string, AgentLocalTargetSnapshot>;
};

export type RuntimeAccountAuthProjection = {
  status: Exclude<AuthStatus, 'bootstrapping'>;
  sequence: string;
  reasonCode: number;
  accountReasonCode: number;
  authorizationRevision: string;
  user: Record<string, unknown> | null;
  failureDetail?: string;
};
export type AppTab =
  | 'home'
  | 'chat'
  | 'agent-center'
  | 'explore'
  | 'apps'
  | 'runtime'
  | 'cloud'
  | 'downloads'
  | 'diagnostics'
  | 'settings'
  | 'support'
  | 'profile'
  | 'source-detail'
  | 'world-detail'
  | 'notification'
  | 'privacy-policy'
  | 'terms-of-service';
export type StatusKind = 'info' | 'success' | 'warning' | 'error';
export type WorldDetailInitialSubpage = 'relationship-explorer';
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
  agentConversationTargetByHandle: Record<string, AgentLocalTargetSnapshot>;
  /**
   * The partner and conversation that were open when Runtime stopped proving
   * the account. They stay hidden while it is unavailable and come back only
   * when the same account is confirmed again.
   */
  suspendedAgentSelection: SuspendedAgentSelection | null;
  pendingAgentComposerPrefill: AgentComposerPrefill | null;
  agentComposerPrefillSerial: number;
  /**
   * Unsent partner-chat text by account and Agent handle. It outlives route
   * changes and a temporary Runtime/account outage; ending the session clears it.
   */
  agentComposerDrafts: Readonly<Record<string, string>>;
  agentComposerAttachments: Readonly<Record<string, readonly import('../../features/turns/turn-input-attachments.js').PendingAttachment[]>>;
  setAgentComposerAttachments: (accountId: string, threadId: string, attachments: readonly import('../../features/turns/turn-input-attachments.js').PendingAttachment[]) => void;
  /** Text typed on Home that Nimi Chat opens a new conversation with. */
  pendingNimiComposerPrefill: { text: string; requestId: number } | null;
  chatSetupState: ChatSetupStateByMode;
  profileDetailOverlayOpen: boolean;
  primaryRailVisible: boolean;
  setPrimaryRailVisible: (visible: boolean) => void;
  chatProfilePanelTarget: 'self' | 'other' | null;
  offlineTier: OfflineTier;
  setOfflineTier: (tier: OfflineTier) => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (message: string | null) => void;
  setRuntimeMaintenance: (reasonCode: string | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  setAuthBootstrapping: () => void;
  applyRuntimeAccountProjection: (projection: RuntimeAccountAuthProjection) => void;
  setAuthSession: (user: Record<string, unknown> | null) => void;
  clearAuthSession: () => void;
  setRuntimeField: (key: keyof RuntimeFieldMap, value: string | number | boolean) => void;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
  setChatThinkingPreference: (preference: ChatThinkingPreference) => void;
  setChatSourceFilter: (filter: ConversationSourceFilter) => void;
  setChatViewMode: (
    source: ConversationMode,
    targetId: string,
    mode: ConversationViewMode,
  ) => void;
  setLastSelectedThreadForMode: (mode: ConversationMode, threadId: string | null) => void;
  setAgentConversationTargetSnapshot: (target: AgentLocalTargetSnapshot) => void;
  setPendingAgentComposerPrefill: (input: { agentHandle?: string | null; sourceKey?: string | null; text: string }) => void;
  clearPendingAgentComposerPrefill: (requestId: number) => void;
  setAgentComposerDraft: (accountId: string, agentHandle: string, text: string) => void;
  setPendingNimiComposerPrefill: (text: string) => void;
  clearPendingNimiComposerPrefill: (requestId: number) => void;
  setChatSetupState: (mode: ConversationMode, setupState: ConversationSetupState | null) => void;
  setProfileDetailOverlayOpen: (open: boolean) => void;
  setChatProfilePanelTarget: (target: 'self' | 'other' | null) => void;
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
