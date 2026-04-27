import type {
  DesktopReleaseInfo,
  DesktopUpdateState,
  RuntimeDefaults,
  RuntimeModDeveloperModeState,
  RuntimeModDiagnosticRecord,
  RuntimeLocalManifestSummary,
  RuntimeModReloadResult,
  RuntimeModSourceRecord,
} from '@renderer/bridge';
import type { RuntimeModRegisterFailure } from '@runtime/mod';
import type { RuntimeModSettingsMap } from '@nimiplatform/sdk/mod';
import type {
  ConversationMode,
  ConversationSourceFilter,
  ConversationSetupState,
  ConversationViewMode,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type { OfflineTier } from '@runtime/offline/types.js';
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
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type { AIConfig, AIProfile } from '@nimiplatform/sdk/mod';
import type { OpenModWorkspaceTabResult } from './mod-workspace-policy';

export type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated';
export type AppTab =
  | 'home'
  | 'chat'
  | 'contacts'
  | 'world'
  | 'explore'
  | 'runtime'
  | 'settings'
  | 'mods'
  | 'profile'
  | 'agent-detail'
  | 'world-detail'
  | 'gift-inbox'
  | 'notification'
  | 'tester'
  | 'privacy-policy'
  | 'terms-of-service'
  | `mod:${string}`;
export type StatusKind = 'info' | 'success' | 'warning' | 'error';

export type RuntimeFieldMap = {
  targetType: string;
  targetAccountId: string;
  agentId: string;
  targetId: string;
  worldId: string;
  provider: string;
  runtimeModelType: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId: string;
  mode: 'STORY' | 'SCENE_TURN';
  turnIndex: number;
  userConfirmedUpload: boolean;
  [key: string]: string | number | boolean;
};

export type StatusBanner = {
  kind: StatusKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type ModWorkspaceTab = {
  tabId: `mod:${string}`;
  modId: string;
  title: string;
  fused: boolean;
  lastAccessedAt: number;
};

export type RuntimeModHydrationStatus =
  | 'not_requested'
  | 'scheduled'
  | 'hydrating'
  | 'hydrated'
  | 'failed';

export type RuntimeModHydrationRecord = {
  modId: string;
  status: RuntimeModHydrationStatus;
  generation: string;
  updatedAt: string;
  stage?: RuntimeModRegisterFailure['stage'];
  error?: string;
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
    token: string;
    refreshToken: string;
  };
  runtimeFields: RuntimeFieldMap;
  aiConfig: AIConfig;
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
  localManifestSummaries: RuntimeLocalManifestSummary[];
  runtimeModSources: RuntimeModSourceRecord[];
  runtimeModDeveloperMode: RuntimeModDeveloperModeState;
  runtimeModDiagnostics: RuntimeModDiagnosticRecord[];
  runtimeModRecentReloads: RuntimeModReloadResult[];
  registeredRuntimeModIds: string[];
  runtimeModDisabledIds: string[];
  runtimeModUninstalledIds: string[];
  runtimeModSettingsById: RuntimeModSettingsMap;
  runtimeModHydrationById: Record<string, RuntimeModHydrationRecord>;
  modWorkspaceTabs: ModWorkspaceTab[];
  fusedRuntimeMods: Record<string, { reason: string; lastError: string; at: string }>;
  runtimeModFailures: RuntimeModRegisterFailure[];
  offlineTier: OfflineTier;
  statusBanner: StatusBanner | null;
  modsFeedback: StatusBanner | null;
  setOfflineTier: (tier: OfflineTier) => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (message: string | null) => void;
  setDesktopReleaseInfo: (info: DesktopReleaseInfo | null) => void;
  setDesktopReleaseError: (message: string | null) => void;
  setDesktopUpdateState: (state: DesktopUpdateState | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  setAuthBootstrapping: () => void;
  setAuthSession: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => void;
  clearAuthSession: () => void;
  setRuntimeField: (key: string, value: string | number | boolean) => void;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
  setRuntimeRouteProjection: (updates: Partial<RuntimeFieldMap>) => void;
  setAIConfig: (config: AIConfig) => void;
  applyAIProfile: (profile: AIProfile) => void;
  /**
   * Internal convenience delegate — writes a single capability binding into
   * AIConfig and commits through the AIConfigSDKSurface (D-AIPC-003).
   * Prefer calling `getDesktopAIConfigService().aiConfig.update()` directly
   * in product-facing UI code. This action exists for runtime-config effects
   * and bootstrap paths that operate within the Zustand set() context.
   */
  setConversationCapabilityBinding: (
    capability: ConversationCapability,
    binding: RuntimeRouteBinding | null | undefined,
  ) => void;
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
  setLocalManifestSummaries: (manifests: RuntimeLocalManifestSummary[]) => void;
  setRuntimeModSources: (sources: RuntimeModSourceRecord[]) => void;
  setRuntimeModDeveloperMode: (value: RuntimeModDeveloperModeState) => void;
  setRuntimeModDiagnostics: (records: RuntimeModDiagnosticRecord[]) => void;
  pushRuntimeModReloadResults: (records: RuntimeModReloadResult[]) => void;
  setRegisteredRuntimeModIds: (modIds: string[]) => void;
  setRuntimeModDisabledIds: (modIds: string[]) => void;
  setRuntimeModUninstalledIds: (modIds: string[]) => void;
  setRuntimeModSettings: (modId: string, settings: Record<string, unknown>) => void;
  setRuntimeModHydrationRecords: (records: RuntimeModHydrationRecord[]) => void;
  clearRuntimeModHydrationRecords: () => void;
  openModWorkspaceTab: (tabId: `mod:${string}`, title: string, modId: string) => OpenModWorkspaceTabResult;
  closeModWorkspaceTab: (tabId: `mod:${string}`) => void;
  touchModWorkspaceTab: (tabId: `mod:${string}`) => void;
  markRuntimeModFused: (modId: string, error: string, reason: string) => void;
  clearRuntimeModFuse: (modId: string) => void;
  setRuntimeModFailures: (failures: RuntimeModRegisterFailure[]) => void;
  setStatusBanner: (banner: StatusBanner | null) => void;
  setModsFeedback: (banner: StatusBanner | null) => void;
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
  provider: '',
  runtimeModelType: 'chat',
  localProviderEndpoint: '',
  localProviderModel: '',
  localOpenAiEndpoint: '',
  connectorId: '',
  mode: 'STORY',
  turnIndex: 1,
  userConfirmedUpload: false,
};
