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
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';

export type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated';
export type AppTab =
  | 'home'
  | 'chat'
  | 'explore'
  | 'apps'
  | 'runtime'
  | 'settings'
  | 'support'
  | 'developer-tools'
  | 'profile'
  | 'agent-detail'
  | 'world-detail'
  | 'gift-inbox'
  | 'notification'
  | 'privacy-policy'
  | 'terms-of-service';
export type StatusKind = 'info' | 'success' | 'warning' | 'error';

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
  previousTab: AppTab | null;
  chatMode: ConversationMode;
  chatThinkingPreference: ChatThinkingPreference;
  chatSourceFilter: ConversationSourceFilter;
  selectedTargetBySource: SelectedTargetBySource;
  viewModeBySourceTarget: ViewModeBySourceTarget;
  lastSelectedThreadByMode: LastSelectedThreadByMode;
  nimiConversationSelection: NimiConversationSelection;
  agentConversationSelection: AgentConversationSelection;
  chatSetupState: ChatSetupStateByMode;
  selectedChatId: string | null;
  selectedProfileId: string | null;
  selectedProfileIsAgent: boolean | null;
  selectedWorldId: string | null;
  selectedGiftTransactionId: string | null;
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
  setChatSetupState: (mode: ConversationMode, setupState: ConversationSetupState | null) => void;
  setSelectedChatId: (chatId: string | null) => void;
  setSelectedProfileId: (profileId: string | null) => void;
  setSelectedProfileIsAgent: (isAgent: boolean | null) => void;
  setSelectedWorldId: (worldId: string | null) => void;
  setSelectedGiftTransactionId: (giftTransactionId: string | null) => void;
  setProfileDetailOverlayOpen: (open: boolean) => void;
  setChatProfilePanelTarget: (target: 'self' | 'other' | null) => void;
  navigateToProfile: (profileId: string | null, tab: 'profile' | 'agent-detail') => void;
  navigateToWorld: (worldId: string) => void;
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
