import type {
  AdmitProductControlReadyForUseRequest,
  EnsureProductControlRecordCreatedRequest,
  GetProductControlRecordRequest,
  GetProductControlSelectedDataRootRequest,
  ProductControlProjectionJson,
  RuntimeTypedCallOptions,
  SelectProductControlDataRootRequest,
} from '../core-generated/runtime-typed-client';
import { ReasonCode } from '../types';

export const NIMI_PRODUCT_CONTROL_STATES = [
  'not_logged_in',
  'config_missing',
  'data_root_missing',
  'data_root_selected',
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
    readonly rootActivationId: string | null;
    readonly selectedAt: string;
    readonly verifiedAt: string;
    readonly selectedAtUnixMs: number;
    readonly verifiedAtUnixMs: number;
  } | null;
  readonly firstRun: {
    readonly completed: boolean;
    readonly completedAt?: string | null;
  };
  readonly pointers: {
    readonly factoryProfileIndex?: string | null;
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
  readonly error: string | null;
  readonly configMutation?: NimiProductControlConfigMutation | null;
  readonly activation?: NimiProductControlActivation | null;
}

export interface NimiProductControlActivation {
  readonly activated: boolean;
  readonly reasonCode: 'DATA_ROOT_REPLACED' | 'DATA_ROOT_UNCHANGED' | 'DATA_ROOT_OVERLAPS_CURRENT';
  readonly actionHint: 'restart_runtime_and_check_sync' | 'run_check_sync' | 'choose_path_disjoint_root';
}

export interface NimiProductControlConfigMutation {
  readonly disposition: 'applied' | 'restart_required' | 'repair_required';
  readonly reasonCode: typeof ReasonCode.CONFIG_APPLIED | typeof ReasonCode.CONFIG_RESTART_REQUIRED | 'CONFIG_WRITE_FAILED';
  readonly actionHint: 'continue_product_setup' | 'request_typed_runtime_restart' | 'repair_runtime_config';
}

export interface NimiProductControlSelectedDataRootProjection {
  readonly path: string;
  readonly exists: boolean;
  readonly state: NimiProductControlState;
  readonly dataRoot: NimiProductControlRecord['dataRoot'] | null;
  readonly error: string | null;
}

export interface NimiProductControlStorageDirsProjection {
  readonly dataRoot: string;
  readonly modelsDir: string;
  readonly dependenciesDir: string;
  readonly environmentsDir: string;
  readonly appsDir: string;
  readonly accountsDir: string;
  readonly logsDir: string;
  readonly auditDir: string;
}

export const NIMI_FIRST_RUN_PHASES = [
  'storage',
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
  admitProductControlReadyForUse(
    request: AdmitProductControlReadyForUseRequest,
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
