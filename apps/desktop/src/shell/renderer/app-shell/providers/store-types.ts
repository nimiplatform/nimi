import type { RuntimeDefaults } from '../../bridge';
import type {
  ConversationMode,
  ConversationSourceFilter,
  ConversationSetupState,
  ConversationViewMode,
} from '@nimiplatform/kit/features/chat/headless';
import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import type { NimiDesktopOpenAppsSection } from '@nimiplatform/kit/core/desktop-open';
import type {
  NimiConversationSelection,
  AgentComposerPrefill,
  AgentConversationSelection,
  ChatSetupStateByMode,
  LastSelectedThreadByMode,
  SelectedTargetBySource,
  ViewModeBySourceTarget,
} from '../../features/chat/chat-shell-types';
import type { ChatThinkingPreference } from '../../features/chat/chat-shared-thinking';
import type { ExploreSectionId } from '../../features/explore/explore-section-nav';
import type { CharacterSourceRefV3 } from '../../features/realm-source/realm-source-identity.js';
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

export type RuntimeAccountAuthProjection = {
  status: Exclude<AuthStatus, 'bootstrapping'>;
  sequence: string;
  reasonCode: number;
  accountReasonCode: number;
  user: Record<string, unknown> | null;
};
export type AppTab =
  | 'home'
  | 'chat'
  | 'explore'
  | 'apps'
  | 'runtime'
  | 'settings'
  | 'support'
  | 'profile'
  | 'source-detail'
  | 'world-detail'
  | 'notification'
  | 'privacy-policy'
  | 'terms-of-service';
export type StatusKind = 'info' | 'success' | 'warning' | 'error';
export type WorldDetailInitialSubpage = 'relationship-explorer' | 'people-archive';
export type WorldDetailNavigationOptions = {
  initialSubpage?: WorldDetailInitialSubpage | null;
};

export type NavigationRouteSnapshot = {
  activeTab: AppTab;
  selectedProfileId: string | null;
  selectedSourceRef: CharacterSourceRefV3 | null;
  selectedWorldId: string | null;
  selectedWorldInitialSubpage: WorldDetailInitialSubpage | null;
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
  runtimeDefaults: RuntimeDefaults | null;
  auth: {
    status: AuthStatus;
    user: Record<string, unknown> | null;
    sequence: string;
    reasonCode: number;
    accountReasonCode: number;
  };
  runtimeFields: RuntimeFieldMap;
  activeTab: AppTab;
  navigationBackStack: NavigationRouteSnapshot[];
  chatMode: ConversationMode;
  chatThinkingPreference: ChatThinkingPreference;
  chatSourceFilter: ConversationSourceFilter;
  selectedTargetBySource: SelectedTargetBySource;
  viewModeBySourceTarget: ViewModeBySourceTarget;
  lastSelectedThreadByMode: LastSelectedThreadByMode;
  nimiConversationSelection: NimiConversationSelection;
  agentConversationSelection: AgentConversationSelection;
  agentConversationTargetByHandle: Record<string, AgentLocalTargetSnapshot>;
  pendingAgentComposerPrefill: AgentComposerPrefill | null;
  agentComposerPrefillSerial: number;
  chatSetupState: ChatSetupStateByMode;
  selectedChatId: string | null;
  selectedProfileId: string | null;
  selectedSourceRef: CharacterSourceRefV3 | null;
  selectedWorldId: string | null;
  selectedWorldInitialSubpage: WorldDetailInitialSubpage | null;
  exploreActiveSection: ExploreSectionId;
  exploreSearchText: string;
  appsDetailAppId: string | null;
  appsDetailSection: NimiDesktopOpenAppsSection | null;
  appsDetailNavigationRevision: number;
  profileDetailOverlayOpen: boolean;
  chatProfilePanelTarget: 'self' | 'other' | null;
  offlineTier: OfflineTier;
  setOfflineTier: (tier: OfflineTier) => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (message: string | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  setAuthBootstrapping: () => void;
  applyRuntimeAccountProjection: (projection: RuntimeAccountAuthProjection) => void;
  setAuthSession: (user: Record<string, unknown> | null) => void;
  clearAuthSession: () => void;
  setRuntimeField: (key: keyof RuntimeFieldMap, value: string | number | boolean) => void;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
  setActiveTab: (tab: AppTab) => void;
  setChatMode: (mode: ConversationMode) => void;
  setChatThinkingPreference: (preference: ChatThinkingPreference) => void;
  setChatSourceFilter: (filter: ConversationSourceFilter) => void;
  setSelectedTargetForSource: (source: ConversationMode, targetId: string | null) => void;
  setChatViewMode: (
    source: ConversationMode,
    targetId: string,
    mode: ConversationViewMode,
  ) => void;
  setLastSelectedThreadForMode: (mode: ConversationMode, threadId: string | null) => void;
  setNimiConversationSelection: (selection: NimiConversationSelection) => void;
  setAgentConversationSelection: (selection: AgentConversationSelection) => void;
  setAgentConversationTargetSnapshot: (target: AgentLocalTargetSnapshot) => void;
  setPendingAgentComposerPrefill: (input: { agentHandle: string; text: string }) => void;
  clearPendingAgentComposerPrefill: (requestId: number) => void;
  setChatSetupState: (mode: ConversationMode, setupState: ConversationSetupState | null) => void;
  setSelectedChatId: (chatId: string | null) => void;
  setSelectedProfileId: (profileId: string | null) => void;
  setSelectedWorldId: (worldId: string | null) => void;
  setExploreActiveSection: (section: ExploreSectionId) => void;
  setExploreSearchText: (text: string) => void;
  setAppsDetailAppId: (
    appId: string | null,
    section?: NimiDesktopOpenAppsSection | null,
  ) => void;
  setProfileDetailOverlayOpen: (open: boolean) => void;
  setChatProfilePanelTarget: (target: 'self' | 'other' | null) => void;
  navigateToProfile: (profileId: string) => void;
  navigateToSourceDetail: (sourceRef: CharacterSourceRefV3) => void;
  navigateToWorld: (worldId: string, options?: WorldDetailNavigationOptions) => void;
  navigateBack: () => void;
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
