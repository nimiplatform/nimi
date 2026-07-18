import type {
  DesktopReleaseInfo,
  DesktopUpdateState,
  RuntimeDefaults,
} from '@renderer/bridge';
import type {
  ConversationMode,
  ConversationSourceFilter,
  ConversationSetupState,
  ConversationViewMode,
} from '@nimiplatform/kit/features/chat/headless';
import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import type {
  NimiConversationSelection,
  AgentComposerPrefill,
  AgentConversationSelection,
  ChatSetupStateByMode,
  LastSelectedThreadByMode,
  SelectedTargetBySource,
  ViewModeBySourceTarget,
} from '@renderer/features/chat/chat-shell-types';
import type { ChatThinkingPreference } from '@renderer/features/chat/chat-shared-thinking';
import type {
  AgentEffectiveCapabilityResolution,
  ConversationCapability,
  ConversationCapabilityProjection,
} from '@renderer/features/chat/conversation-capability';
import type { ExploreSectionId } from '@renderer/features/explore/explore-section-nav';
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import type { CharacterSourceRefV3 } from '@renderer/features/realm-source/realm-source-identity.js';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';

export type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated';
export type AppTab =
  | 'home'
  | 'chat'
  | 'agents'
  | 'explore'
  | 'apps'
  | 'runtime'
  | 'settings'
  | 'support'
  | 'developer-tools'
  | 'profile'
  | 'source-detail'
  | 'world-detail'
  | 'gift-inbox'
  | 'notification'
  | 'privacy-policy'
  | 'terms-of-service';
export type StatusKind = 'info' | 'success' | 'warning' | 'error';
export type WorldDetailInitialSubpage = 'relationship-explorer' | 'people-archive';
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

export type StatusBanner = {
  kind: StatusKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type AppStoreState = {
  bootstrapReady: boolean;
  bootstrapError: string | null;
  desktopReleaseInfo: DesktopReleaseInfo | null;
  desktopReleaseError: string | null;
  desktopUpdateState: DesktopUpdateState | null;
  runtimeDefaults: RuntimeDefaults | null;
  auth: {
    status: AuthStatus;
    user: Record<string, unknown> | null;
  };
  runtimeFields: RuntimeFieldMap;
  aiConfig: NimiAIConfig;
  conversationCapabilityProjectionByCapability: Partial<Record<ConversationCapability, ConversationCapabilityProjection>>;
  agentEffectiveCapabilityResolution: AgentEffectiveCapabilityResolution | null;
  activeTab: AppTab;
  navigationBackStack: AppTab[];
  chatMode: ConversationMode;
  chatThinkingPreference: ChatThinkingPreference;
  chatSourceFilter: ConversationSourceFilter;
  selectedTargetBySource: SelectedTargetBySource;
  viewModeBySourceTarget: ViewModeBySourceTarget;
  lastSelectedThreadByMode: LastSelectedThreadByMode;
  nimiConversationSelection: NimiConversationSelection;
  agentConversationSelection: AgentConversationSelection;
  agentConversationTargetByLocalRef: Record<string, AgentLocalTargetSnapshot>;
  pendingAgentComposerPrefill: AgentComposerPrefill | null;
  agentComposerPrefillSerial: number;
  chatSetupState: ChatSetupStateByMode;
  selectedChatId: string | null;
  selectedProfileId: string | null;
  selectedProfileIsSource: boolean | null;
  selectedSourceRef: CharacterSourceRefV3 | null;
  selectedWorldId: string | null;
  selectedWorldInitialSubpage: WorldDetailInitialSubpage | null;
  selectedGiftTransactionId: string | null;
  exploreActiveSection: ExploreSectionId;
  exploreSearchText: string;
  appsDetailAppId: string | null;
  profileDetailOverlayOpen: boolean;
  chatProfilePanelTarget: 'self' | 'other' | null;
  offlineTier: OfflineTier;
  statusBanner: StatusBanner | null;
  setOfflineTier: (tier: OfflineTier) => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (message: string | null) => void;
  setDesktopReleaseInfo: (info: DesktopReleaseInfo | null) => void;
  setDesktopReleaseError: (message: string | null) => void;
  setDesktopUpdateState: (state: DesktopUpdateState | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  setAuthBootstrapping: () => void;
  setAuthSession: (user: Record<string, unknown> | null) => void;
  clearAuthSession: () => void;
  setRuntimeField: (key: keyof RuntimeFieldMap, value: string | number | boolean) => void;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
  setAIConfig: (config: NimiAIConfig) => void;
  setConversationCapabilityProjections: (
    projections: Partial<Record<ConversationCapability, ConversationCapabilityProjection>>,
  ) => void;
  setAgentEffectiveCapabilityResolution: (resolution: AgentEffectiveCapabilityResolution | null) => void;
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
  setPendingAgentComposerPrefill: (input: { localAgentRef: string; text: string }) => void;
  clearPendingAgentComposerPrefill: (requestId: number) => void;
  setChatSetupState: (mode: ConversationMode, setupState: ConversationSetupState | null) => void;
  setSelectedChatId: (chatId: string | null) => void;
  setSelectedProfileId: (profileId: string | null) => void;
  setSelectedProfileIsSource: (isSource: boolean | null) => void;
  setSelectedSourceRef: (sourceRef: CharacterSourceRefV3 | null) => void;
  setSelectedWorldId: (worldId: string | null) => void;
  setSelectedGiftTransactionId: (giftTransactionId: string | null) => void;
  setExploreActiveSection: (section: ExploreSectionId) => void;
  setExploreSearchText: (text: string) => void;
  setAppsDetailAppId: (appId: string | null) => void;
  setProfileDetailOverlayOpen: (open: boolean) => void;
  setChatProfilePanelTarget: (target: 'self' | 'other' | null) => void;
  navigateToProfile: (profileId: string | null, tab: 'profile' | 'source-detail') => void;
  navigateToSourceDetail: (sourceRef: CharacterSourceRefV3) => void;
  navigateToWorld: (worldId: string, options?: WorldDetailNavigationOptions) => void;
  navigateToGiftInbox: (giftTransactionId?: string | null) => void;
  navigateBack: () => void;
  setStatusBanner: (banner: StatusBanner | null) => void;
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
