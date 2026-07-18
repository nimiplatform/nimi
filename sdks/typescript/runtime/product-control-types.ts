import type {
  AdmitProductControlReadyForUseRequest,
  CompleteProductControlFirstRunDeviceEnvironmentScanRequest,
  EnsureProductControlRecordCreatedRequest,
  GetProductControlRecordRequest,
  GetProductControlSelectedDataRootRequest,
  ProductControlProjectionJson,
  ReconcileProductControlFirstRunSetupStateRequest,
  RecordProductControlAccountDefaultProfileEvidenceRequest,
  RecordProductControlFirstRunLocalAiReadyEvidenceRequest,
  RuntimeTypedCallOptions,
  SelectProductControlDataRootRequest,
  SetProductControlFirstRunInstallLevelRequest,
} from '../core-generated/runtime-typed-client';
import { ReasonCode } from '../types';

export const NIMI_PRODUCT_CONTROL_STATES = [
  'not_logged_in',
  'config_missing',
  'data_root_missing',
  'data_root_selected',
  'ai_environment_unconfigured',
  'local_ai_profile_selected_assets_missing',
  'local_ai_profile_selected_environment_not_ready',
  'local_ai_assets_downloaded_environment_not_ready',
  'local_ai_ready',
  'repair_required',
  'blocked',
  'ready_for_use',
] as const;

export type NimiProductControlState = (typeof NIMI_PRODUCT_CONTROL_STATES)[number];

export const NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY = Object.freeze({
  not_logged_in: 'Support.recoveryStateNotLoggedIn',
  config_missing: 'Support.recoveryStateConfigMissing',
  data_root_missing: 'Support.recoveryStateDataRootMissing',
  data_root_selected: 'Support.recoveryStateDataRootSelected',
  ai_environment_unconfigured: 'Support.recoveryStateAiEnvironmentUnconfigured',
  local_ai_profile_selected_assets_missing: 'Support.recoveryStateLocalAiAssetsMissing',
  local_ai_profile_selected_environment_not_ready: 'Support.recoveryStateLocalAiEnvironmentNotReady',
  local_ai_assets_downloaded_environment_not_ready: 'Support.recoveryStateLocalAiAssetsDownloadedEnvironmentNotReady',
  local_ai_ready: 'Support.recoveryStateLocalAiReady',
  repair_required: 'Support.recoveryStateRepairRequired',
  blocked: 'Support.recoveryStateBlocked',
  ready_for_use: 'Support.recoveryStateReadyForUse',
} satisfies Record<NimiProductControlState, string>);

export const NIMI_PRODUCT_DATA_ROOT_STATUSES = [
  'selected',
  'ready',
  'repair_required',
] as const;

export type NimiProductDataRootStatus = (typeof NIMI_PRODUCT_DATA_ROOT_STATUSES)[number];

export interface NimiProductControlRecord {
  readonly schemaVersion: number;
  readonly installId: string;
  readonly productVersion: string;
  readonly state: NimiProductControlState;
  readonly dataRoot?: {
    readonly path: string;
    readonly status: NimiProductDataRootStatus;
    readonly selectedAt: string;
    readonly verifiedAt: string;
    readonly selectedAtUnixMs: number;
    readonly verifiedAtUnixMs: number;
  } | null;
  readonly firstRun: {
    readonly installLevel?: 'minimal' | 'recommended' | null;
    readonly aiProfileAlias?: string | null;
    readonly completed: boolean;
    readonly completedAt?: string | null;
    readonly initializationPlanId?: string | null;
    readonly baselineProfileRef?: string | null;
    readonly baselineCommitId?: string | null;
    readonly accountDefaultProfileRef?: string | null;
    readonly builtInAiConfigRefs: readonly string[];
    readonly runtimeBaselineRef?: string | null;
    readonly executionEvidenceRef?: string | null;
  };
  readonly pointers: {
    readonly runtimeConfigPath?: string | null;
    readonly factoryProfileIndex?: string | null;
    readonly appRegistry?: string | null;
    readonly appPackages?: string | null;
  };
  readonly repair: {
    readonly required: boolean;
    readonly reason?: string | null;
  };
}

export interface NimiProductControlRecordProjection {
  readonly path: string;
  readonly exists: boolean;
  readonly state: NimiProductControlState;
  readonly record: NimiProductControlRecord | null;
  readonly dataRootProposal: NimiProductControlDataRootProposal | null;
  readonly error: string | null;
  readonly configMutation?: NimiProductControlConfigMutation | null;
}

export interface NimiProductControlConfigMutation {
  readonly disposition: 'applied' | 'restart_required';
  readonly reasonCode: typeof ReasonCode.CONFIG_APPLIED | typeof ReasonCode.CONFIG_RESTART_REQUIRED;
  readonly actionHint: 'continue_product_setup' | 'request_typed_runtime_restart';
}

export interface NimiProductControlDataRootProposal {
  readonly path: string;
  readonly authority: 'runtime_protected_product_control';
  readonly profile: 'dev_kernel_checkpoint';
}

export interface NimiProductControlSelectedDataRootProjection {
  readonly path: string;
  readonly exists: boolean;
  readonly state: NimiProductControlState;
  readonly dataRoot: NimiProductControlRecord['dataRoot'] | null;
  readonly error: string | null;
}

export interface NimiProductControlStorageDirsProjection {
  readonly nimiDir: string;
  readonly nimiDataDir: string;
  readonly mediaCacheDir: string;
  readonly logsDir: string;
  readonly localModelsDir: string;
  readonly localRuntimeStatePath: string;
}

export const NIMI_FIRST_RUN_PHASES = [
  'storage',
  'device-scan',
  'local-ai',
  'setup',
] as const;

export type NimiFirstRunPhase = (typeof NIMI_FIRST_RUN_PHASES)[number];
export type NimiFirstRunTerminalScreen = 'login' | 'repair' | 'blocked' | 'ready';
export type NimiFirstRunScreen =
  | { readonly kind: 'phase'; readonly phase: NimiFirstRunPhase }
  | { readonly kind: 'terminal'; readonly screen: NimiFirstRunTerminalScreen };

export type NimiProductControlAdmissionProjection =
  | { readonly kind: 'ordinary-shell' }
  | { readonly kind: 'login' }
  | { readonly kind: 'first-run'; readonly state: NimiProductControlState };

export interface NimiRuntimeProductControlLocalClient {
  getProductControlRecord(
    request: GetProductControlRecordRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
  getProductControlSelectedDataRoot(
    request: GetProductControlSelectedDataRootRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
  ensureProductControlRecordCreated(
    request: EnsureProductControlRecordCreatedRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
  selectProductControlDataRoot(
    request: SelectProductControlDataRootRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
  setProductControlFirstRunInstallLevel(
    request: SetProductControlFirstRunInstallLevelRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
  completeProductControlFirstRunDeviceEnvironmentScan(
    request: CompleteProductControlFirstRunDeviceEnvironmentScanRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
  admitProductControlReadyForUse(
    request: AdmitProductControlReadyForUseRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
  recordProductControlAccountDefaultProfileEvidence(
    request: RecordProductControlAccountDefaultProfileEvidenceRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
  recordProductControlFirstRunLocalAiReadyEvidence(
    request: RecordProductControlFirstRunLocalAiReadyEvidenceRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
  reconcileProductControlFirstRunSetupState(
    request: ReconcileProductControlFirstRunSetupStateRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ProductControlProjectionJson>;
}

export type NimiRuntimeProductControlClient =
  | NimiRuntimeProductControlLocalClient
  | { readonly local: NimiRuntimeProductControlLocalClient };

export type NimiRuntimeProductControlClientFor<Method extends keyof NimiRuntimeProductControlLocalClient> =
  | Pick<NimiRuntimeProductControlLocalClient, Method>
  | { readonly local: Pick<NimiRuntimeProductControlLocalClient, Method> };

export interface NimiRuntimeProductControlCallOptions {
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeProductControlDataRootSelectionInput {
  readonly dataRoot: string;
}

export interface NimiRuntimeProductControlFirstRunInstallLevelInput {
  readonly installLevel: 'minimal' | 'recommended';
  readonly aiProfileAlias: string;
}

export interface NimiRuntimeProductControlReadyForUseAdmissionInput {
  readonly accountDefaultProfileEvidenceJson: string;
  readonly builtInAiConfigEvidenceJson: string;
}

export interface NimiRuntimeProductControlAccountDefaultProfileEvidenceInput {
  readonly accountDefaultProfileEvidenceJson: string;
}

export interface NimiRuntimeProductControlFirstRunLocalAiReadyEvidenceInput {
  readonly runtimeBaselineRef: string;
  readonly builtInAiConfigEvidenceJson: string;
  readonly executionEvidenceRef: string;
}
