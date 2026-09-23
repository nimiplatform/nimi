import type {
  RuntimeAdvancedDiagnosticsPane,
  RuntimeConfigStatusV11,
  RuntimeConfigStateV11,
} from './runtime-config-state-types';
import type { RuntimeBridgeDaemonStatus } from '../../bridge';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import type {
  NimiRuntimeLocalInstallPlanDescriptor,
  NimiRuntimeModelAssetMarketCandidate,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigInstallConfirmationRequest, RuntimeConfigInstallResult } from './runtime-config-panel-controller-install-actions';

// @nimi-authority: rule.nimi.runtime.model-catalog.r037
export type RuntimeConfigLoadoutNavigationContext = {
  readonly capabilityContract: string;
  readonly recipeId?: string;
  readonly recipeRevision?: string;
  readonly slotId?: string;
  readonly draft?: RuntimeConfigLoadoutCreateDraft;
  /** Offer the user installed during a Model Market detour; auto-selected for slotId on return. */
  readonly autoSelectOfferRef?: string;
};

export type RuntimeConfigLoadoutCreateDraft = {
  readonly displayName: string;
  readonly modelAssetIds: Readonly<Record<string, string>>;
};

export type RuntimeConfigModelMarketSlotContext = {
  readonly kind: 'slot';
  readonly capabilityContract: string;
  readonly recipeId: string;
  readonly recipeRevision: string;
  readonly slotId: string;
  readonly candidate: NimiRuntimeModelAssetMarketCandidate;
  readonly draft: RuntimeConfigLoadoutCreateDraft;
};

/** A market detour either discovers models for a capability or inspects one exact slot offer. */
export type RuntimeConfigModelMarketContext =
  | { readonly kind: 'browse'; readonly capabilityContract: string }
  | RuntimeConfigModelMarketSlotContext;

/** Owner context when the profile library runs "use profile" for a consumer. */
export type RuntimeConfigProfileUseOwner =
  | { readonly kind: 'app'; readonly ownerAppId: string; readonly returnFocus?: string }
  | { readonly kind: 'local-agent'; readonly returnFocus?: string };

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
  setupTaskFocus: { readonly taskId: string } | null;
  profileUseOwner: RuntimeConfigProfileUseOwner | null;
  /** Latest deep-link request for an Advanced & Diagnostics sub-pane; revision changes per request. */
  advancedDiagnosticsPaneRequest: { readonly pane: RuntimeAdvancedDiagnosticsPane; readonly revision: number } | null;
  setShowCloudApiKey: (value: boolean | ((prev: boolean) => boolean)) => void;
  setConnectorModelQuery: (value: string) => void;
  setPageFeedback: (value: InlineFeedbackState | null) => void;
  onChangePage: (pageId: RuntimeConfigStateV11['activePage']) => void;
  onOpenSavedConfigs: (context?: RuntimeConfigLoadoutNavigationContext) => void;
  onOpenModelMarket: (context: RuntimeConfigModelMarketContext) => void;
  /** Opens the Model Library on the downloaded files with the import menu open. */
  onOpenModelImport: () => void;
  onOpenSetupTask: (taskId: string) => void;
  onCloseSetupTask: () => void;
  onReturnToContextualLoadout: () => void;
  onOpenProfileUseForOwner: (owner: RuntimeConfigProfileUseOwner) => void;
  onCloseProfileUseOwner: () => void;
  onCloseSavedConfigs: () => void;
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
  runLocalHealthCheck: () => Promise<void>;
  testSelectedConnector: () => Promise<void>;
  installResolvedModelPlan: (plan: NimiRuntimeLocalInstallPlanDescriptor) => Promise<RuntimeConfigInstallResult>;
  installConfirmation: RuntimeConfigInstallConfirmationRequest | null;
  resolveInstallConfirmation: (confirmed: boolean) => void;
  refreshRuntimeDaemonStatus: () => Promise<void>;
  startRuntimeDaemon: () => Promise<void>;
  restartRuntimeDaemon: () => Promise<void>;
  onVaultChanged: () => void;
};
