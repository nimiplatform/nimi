import type {
  RuntimeDefaults,
  RuntimeModDeveloperModeState,
  RuntimeModDiagnosticRecord,
  RuntimeLocalManifestSummary,
  RuntimeModReloadResult,
  RuntimeModSourceRecord,
} from '@renderer/bridge';
import type { RuntimeModRegisterFailure } from '@runtime/mod';
import type { RuntimeModSettingsMap } from '@nimiplatform/sdk/mod/settings';
import type { OfflineTier } from '@runtime/offline/types.js';

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
  | 'notification'
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
};

export type AppStoreState = {
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;
  auth: {
    status: AuthStatus;
    user: Record<string, unknown> | null;
    token: string;
    refreshToken: string;
  };
  runtimeFields: RuntimeFieldMap;
  activeTab: AppTab;
  previousTab: AppTab | null;
  selectedChatId: string | null;
  selectedProfileId: string | null;
  selectedProfileIsAgent: boolean | null;
  selectedWorldId: string | null;
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
  modWorkspaceTabs: ModWorkspaceTab[];
  fusedRuntimeMods: Record<string, { reason: string; lastError: string; at: string }>;
  runtimeModFailures: RuntimeModRegisterFailure[];
  offlineTier: OfflineTier;
  statusBanner: StatusBanner | null;
  setOfflineTier: (tier: OfflineTier) => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (message: string | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  setAuthBootstrapping: () => void;
  setAuthSession: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => void;
  clearAuthSession: () => void;
  setRuntimeField: <K extends keyof RuntimeFieldMap>(key: K, value: RuntimeFieldMap[K]) => void;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
  setActiveTab: (tab: AppTab) => void;
  setSelectedChatId: (chatId: string | null) => void;
  setSelectedProfileId: (profileId: string | null) => void;
  setSelectedProfileIsAgent: (isAgent: boolean | null) => void;
  setSelectedWorldId: (worldId: string | null) => void;
  setChatProfilePanelTarget: (target: 'self' | 'other' | null) => void;
  navigateToProfile: (profileId: string | null, tab: 'profile' | 'agent-detail') => void;
  navigateToWorld: (worldId: string) => void;
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
  openModWorkspaceTab: (tabId: `mod:${string}`, title: string, modId: string) => void;
  closeModWorkspaceTab: (tabId: `mod:${string}`) => void;
  markRuntimeModFused: (modId: string, error: string, reason: string) => void;
  clearRuntimeModFuse: (modId: string) => void;
  setRuntimeModFailures: (failures: RuntimeModRegisterFailure[]) => void;
  setStatusBanner: (banner: StatusBanner | null) => void;
};

export type AppStoreSet = (
  updater: Partial<AppStoreState> | ((state: AppStoreState) => Partial<AppStoreState>),
) => void;

export const INITIAL_RUNTIME_FIELDS: RuntimeFieldMap = {
  targetType: 'AGENT',
  targetAccountId: '',
  agentId: '',
  targetId: '',
  worldId: '',
  provider: '',
  runtimeModelType: 'chat',
  localProviderEndpoint: 'http://127.0.0.1:1234/v1',
  localProviderModel: 'local-model',
  localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
  connectorId: '',
  mode: 'STORY',
  turnIndex: 1,
  userConfirmedUpload: false,
};
