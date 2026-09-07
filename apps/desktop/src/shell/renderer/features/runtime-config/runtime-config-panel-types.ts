import type {
  RuntimeConfigStatusV11,
  RuntimeConfigStateV11,
} from './runtime-config-state-types';
import type { RuntimeBridgeDaemonStatus } from '../../bridge';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import type {
  NimiRuntimeLocalInstallPlanDescriptor,
  NimiRuntimeModelAssetMarketCandidate,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigInstallConfirmationRequest } from './runtime-config-panel-controller-install-actions';

export type RuntimeConfigLoadoutNavigationContext = {
  readonly capabilityContract: string;
  readonly recipeId?: string;
  readonly recipeRevision?: string;
  readonly slotId?: string;
};

export type RuntimeConfigModelMarketContext = {
  readonly capabilityContract: string;
  readonly recipeId: string;
  readonly recipeRevision: string;
  readonly slotId: string;
  readonly candidate: NimiRuntimeModelAssetMarketCandidate;
};

export type RuntimeConfigPanelControllerModel = {
  state: RuntimeConfigStateV11 | null;
  hydrated: boolean;
  runtimeStatus: RuntimeConfigStatusV11 | null;
  activePage: RuntimeConfigStateV11['activePage'];
  showCloudApiKey: boolean;
  connectorModelQuery: string;
  vaultEntryCount: number;
  testingConnector: boolean;
  checkingHealth: boolean;
  runtimeWritesDisabled: boolean;
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  orderedConnectors: RuntimeConfigStateV11['connectors'];
  filteredConnectorModels: string[];
  registeredRuntimePackageIds: string[];
  runtimeDaemonStatus: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonBusyAction: 'start' | 'restart' | 'stop' | null;
  runtimeDaemonError: string;
  runtimeDaemonUpdatedAt: string | null;
  loadoutNavigationContext: RuntimeConfigLoadoutNavigationContext | null;
  modelMarketContext: RuntimeConfigModelMarketContext | null;
  setShowCloudApiKey: (value: boolean | ((prev: boolean) => boolean)) => void;
  setConnectorModelQuery: (value: string) => void;
  setPageFeedback: (value: InlineFeedbackState | null) => void;
  onChangePage: (pageId: RuntimeConfigStateV11['activePage']) => void;
  onOpenLoadouts: (context?: RuntimeConfigLoadoutNavigationContext) => void;
  onOpenModelMarket: (context: RuntimeConfigModelMarketContext) => void;
  onReturnToContextualLoadout: () => void;
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
  runLocalHealthCheck: () => Promise<void>;
  testSelectedConnector: () => Promise<void>;
  installResolvedModelPlan: (plan: NimiRuntimeLocalInstallPlanDescriptor) => Promise<void>;
  installConfirmation: RuntimeConfigInstallConfirmationRequest | null;
  resolveInstallConfirmation: (confirmed: boolean) => void;
  refreshRuntimeDaemonStatus: () => Promise<void>;
  startRuntimeDaemon: () => Promise<void>;
  restartRuntimeDaemon: () => Promise<void>;
  onVaultChanged: () => void;
};
