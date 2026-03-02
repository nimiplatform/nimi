import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/types';
import type {
  LocalAiCatalogItemDescriptor,
  LocalAiDependencyResolutionPlan,
  LocalAiInstallPayload,
} from '@runtime/local-ai-runtime';
import type { RuntimeDependencyTargetDescriptor } from '../../runtime-config-panel-types';

export type ProviderConnectorsStateModel = {
  state: RuntimeConfigStateV11;
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  orderedConnectors: RuntimeConfigStateV11['connectors'];
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
};

export type ProviderConnectorsViewModel = {
  activeSetupPage: RuntimeConfigStateV11['activeSetupPage'];
  onChangeSetupPage: (pageId: RuntimeConfigStateV11['activeSetupPage']) => void;
  showTokenApiKey: boolean;
  localRuntimeModelQuery: string;
  connectorModelQuery: string;
  filteredLocalRuntimeModels: string[];
  filteredConnectorModels: string[];
  runtimeDependencyTargets: RuntimeDependencyTargetDescriptor[];
  activeConfigScope: 'runtime' | 'eaa' | 'mod';
  activeRuntimeDependencyTarget: RuntimeDependencyTargetDescriptor | null;
  selectedRuntimeDependencyModId: string;
  setSelectedRuntimeDependencyModId: (modId: string) => void;
};

export type ProviderConnectorsCommandModel = {
  checkingHealth: boolean;
  discovering: boolean;
  testingConnector: boolean;
  setShowTokenApiKey: (next: boolean | ((prev: boolean) => boolean)) => void;
  setLocalRuntimeModelQuery: (value: string) => void;
  setConnectorModelQuery: (value: string) => void;
  discoverLocalRuntimeModels: () => Promise<void>;
  runLocalRuntimeHealthCheck: () => Promise<void>;
  testSelectedConnector: () => Promise<void>;
  runtimeDaemonStatus: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonBusyAction: 'start' | 'restart' | 'stop' | null;
  runtimeDaemonError: string;
  runtimeDaemonUpdatedAt: string | null;
  refreshRuntimeDaemonStatus: () => Promise<void>;
  startRuntimeDaemon: () => Promise<void>;
  restartRuntimeDaemon: () => Promise<void>;
  stopRuntimeDaemon: () => Promise<void>;
  resolveRuntimeDependencies: (
    modId: string,
    capability?: string,
  ) => Promise<LocalAiDependencyResolutionPlan>;
  applyRuntimeDependencies: (
    modId: string,
    capability?: string,
  ) => Promise<void>;
  installCatalogLocalRuntimeModel: (item: LocalAiCatalogItemDescriptor) => Promise<void>;
  installLocalRuntimeModel: (payload: LocalAiInstallPayload) => Promise<void>;
  installVerifiedLocalRuntimeModel: (templateId: string) => Promise<void>;
  importLocalRuntimeModel: () => Promise<void>;
  startLocalRuntimeModel: (localModelId: string) => Promise<void>;
  stopLocalRuntimeModel: (localModelId: string) => Promise<void>;
  restartLocalRuntimeModel: (localModelId: string) => Promise<void>;
  removeLocalRuntimeModel: (localModelId: string) => Promise<void>;
  onVaultChanged: () => void;
  vaultEntryCount: number;
};

export type ProviderConnectorsPanelProps = {
  stateModel: ProviderConnectorsStateModel;
  viewModel: ProviderConnectorsViewModel;
  commandModel: ProviderConnectorsCommandModel;
};

export type ProviderConnectorsPanelViewProps = ProviderConnectorsPanelProps & {
  onAddConnector: () => void;
  onRemoveSelectedConnector: () => void;
  onSelectConnector: (connectorId: string) => void;
  onChangeLocalRuntimeEndpoint: (endpoint: string) => void;
  onRenameSelectedConnector: (label: string) => void;
  onChangeConnectorEndpoint: (endpoint: string) => void;
  onChangeConnectorToken: (secret: string) => Promise<void>;
  onChangeConnectorVendor: (vendor: string) => void;
};
