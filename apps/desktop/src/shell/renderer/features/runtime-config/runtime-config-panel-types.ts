import type {
  CapabilityV11,
  ProviderStatusV11,
  RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/types';
import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import type {
  LocalAiCatalogItemDescriptor,
  LocalAiDependencyResolutionPlan,
  LocalAiInstallPayload,
  LocalAiInstallPlanDescriptor,
} from '@runtime/local-ai-runtime';

export type RuntimeDependencyTargetDescriptor = {
  modId: string;
  modName: string;
  consumeCapabilities: CapabilityV11[];
};

export type RuntimeConfigPanelControllerModel = {
  state: RuntimeConfigStateV11 | null;
  runtimeStatus: ProviderStatusV11 | null;
  activePage: RuntimeConfigStateV11['activePage'];
  showTokenApiKey: boolean;
  localRuntimeModelQuery: string;
  connectorModelQuery: string;
  vaultEntryCount: number;
  discovering: boolean;
  testingConnector: boolean;
  checkingHealth: boolean;
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  orderedConnectors: RuntimeConfigStateV11['connectors'];
  filteredLocalRuntimeModels: string[];
  filteredConnectorModels: string[];
  runtimeDependencyTargets: RuntimeDependencyTargetDescriptor[];
  registeredRuntimeModIds: string[];
  runtimeDaemonStatus: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonBusyAction: 'start' | 'restart' | 'stop' | null;
  runtimeDaemonError: string;
  runtimeDaemonUpdatedAt: string | null;
  setShowTokenApiKey: (value: boolean | ((prev: boolean) => boolean)) => void;
  setLocalRuntimeModelQuery: (value: string) => void;
  setConnectorModelQuery: (value: string) => void;
  onChangePage: (pageId: RuntimeConfigStateV11['activePage']) => void;
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
  discoverLocalRuntimeModels: () => Promise<void>;
  runLocalRuntimeHealthCheck: () => Promise<void>;
  testSelectedConnector: () => Promise<void>;
  resolveRuntimeDependencies: (
    modId: string,
    capability?: CapabilityV11 | string,
  ) => Promise<LocalAiDependencyResolutionPlan>;
  applyRuntimeDependencies: (
    modId: string,
    capability?: CapabilityV11 | string,
  ) => Promise<void>;
  installCatalogLocalRuntimeModel: (
    item: LocalAiCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  installLocalRuntimeModel: (payload: LocalAiInstallPayload) => Promise<void>;
  installVerifiedLocalRuntimeModel: (templateId: string) => Promise<void>;
  importLocalRuntimeModel: () => Promise<void>;
  installVerifiedLocalRuntimeArtifact: (templateId: string) => Promise<void>;
  importLocalRuntimeArtifact: () => Promise<void>;
  importLocalRuntimeModelFile: (capabilities: string[], engine?: string) => Promise<void>;
  startLocalRuntimeModel: (localModelId: string) => Promise<void>;
  stopLocalRuntimeModel: (localModelId: string) => Promise<void>;
  restartLocalRuntimeModel: (localModelId: string) => Promise<void>;
  removeLocalRuntimeModel: (localModelId: string) => Promise<void>;
  removeLocalRuntimeArtifact: (localArtifactId: string) => Promise<void>;
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
  retryInstall: (plan: LocalAiInstallPlanDescriptor, source: 'catalog' | 'manual' | 'verified') => void;
  installSessionMeta: Map<string, { plan: LocalAiInstallPlanDescriptor; installSource: string }>;
};
