import type {
  CapabilityV11,
  ProviderStatusV11,
  RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import type {
  LocalRuntimeAssetKind,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeInstallPayload,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileResolutionPlan,
} from '@runtime/local-runtime';

export type RuntimeProfileTargetDescriptor = {
  modId: string;
  modName: string;
  consumeCapabilities: CapabilityV11[];
  profiles: LocalRuntimeProfileDescriptor[];
};

export type RuntimeConfigPanelControllerModel = {
  state: RuntimeConfigStateV11 | null;
  hydrated: boolean;
  runtimeStatus: ProviderStatusV11 | null;
  activePage: RuntimeConfigStateV11['activePage'];
  showCloudApiKey: boolean;
  localModelQuery: string;
  connectorModelQuery: string;
  vaultEntryCount: number;
  discovering: boolean;
  testingConnector: boolean;
  checkingHealth: boolean;
  runtimeWritesDisabled: boolean;
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  orderedConnectors: RuntimeConfigStateV11['connectors'];
  filteredLocalModels: string[];
  filteredConnectorModels: string[];
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[];
  registeredRuntimeModIds: string[];
  runtimeDaemonStatus: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonBusyAction: 'start' | 'restart' | 'stop' | null;
  runtimeDaemonError: string;
  runtimeDaemonUpdatedAt: string | null;
  pageFeedback: InlineFeedbackState | null;
  connectorTestFeedback: InlineFeedbackState | null;
  localModelLifecycleById: Record<string, string>;
  localModelLifecycleErrorById: Record<string, string>;
  setShowCloudApiKey: (value: boolean | ((prev: boolean) => boolean)) => void;
  setLocalModelQuery: (value: string) => void;
  setConnectorModelQuery: (value: string) => void;
  setPageFeedback: (value: InlineFeedbackState | null) => void;
  setConnectorTestFeedback: (value: InlineFeedbackState | null) => void;
  onChangePage: (pageId: RuntimeConfigStateV11['activePage']) => void;
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
  discoverLocalModels: () => Promise<void>;
  runLocalHealthCheck: () => Promise<void>;
  testSelectedConnector: () => Promise<void>;
  resolveRuntimeProfile: (
    modId: string,
    profileId: string,
    capability?: string,
  ) => Promise<LocalRuntimeProfileResolutionPlan>;
  applyRuntimeProfile: (
    modId: string,
    profileId: string,
    capability?: string,
  ) => Promise<LocalRuntimeProfileApplyResult>;
  installCatalogLocalModel: (
    item: LocalRuntimeCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  installLocalModel: (payload: LocalRuntimeInstallPayload) => Promise<void>;
  installVerifiedLocalModel: (templateId: string) => Promise<void>;
  importLocalModel: () => Promise<void>;
  installVerifiedLocalAsset: (templateId: string) => Promise<void>;
  importLocalAsset: () => Promise<void>;
  scaffoldLocalAssetOrphan: (path: string, kind: LocalRuntimeAssetKind) => Promise<void>;
  importLocalModelFile: (capabilities: string[], engine?: string) => Promise<void>;
  startLocalModel: (localModelId: string) => Promise<void>;
  stopLocalModel: (localModelId: string) => Promise<void>;
  restartLocalModel: (localModelId: string) => Promise<void>;
  removeLocalModel: (localModelId: string) => Promise<void>;
  removeLocalAsset: (localAssetId: string) => Promise<void>;
  refreshRuntimeDaemonStatus: () => Promise<void>;
  startRuntimeDaemon: () => Promise<void>;
  restartRuntimeDaemon: () => Promise<void>;
  stopRuntimeDaemon: () => Promise<void>;
  onVaultChanged: () => void;
  onDownloadComplete: (
    installSessionId: string,
    success: boolean,
    message?: string,
    localModelId?: string,
    modelId?: string,
  ) => Promise<void>;
  retryInstall: (plan: LocalRuntimeInstallPlanDescriptor, source: 'catalog' | 'manual' | 'verified') => void;
  installSessionMeta: Map<string, { plan: LocalRuntimeInstallPlanDescriptor; installSource: string }>;
};
