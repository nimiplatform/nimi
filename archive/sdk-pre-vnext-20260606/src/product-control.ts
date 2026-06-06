import type { RuntimeCallOptions, RuntimeLocalServiceClient } from './runtime/index.js';

export const PRODUCT_CONTROL_STATES = [
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

export type ProductControlState = (typeof PRODUCT_CONTROL_STATES)[number];

export const PRODUCT_DATA_ROOT_STATUSES = [
  'selected',
  'ready',
  'repair_required',
] as const;

export type ProductDataRootStatus = (typeof PRODUCT_DATA_ROOT_STATUSES)[number];

export interface ProductControlRecord {
  readonly schemaVersion: number;
  readonly installId: string;
  readonly productVersion: string;
  readonly state: ProductControlState;
  readonly dataRoot?: {
    readonly path: string;
    readonly status: ProductDataRootStatus;
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

export interface ProductControlRecordProjection {
  readonly path: string;
  readonly exists: boolean;
  readonly state: ProductControlState;
  readonly record: ProductControlRecord | null;
  readonly error: string | null;
}

export interface ProductControlSelectedDataRootProjection {
  readonly path: string;
  readonly exists: boolean;
  readonly state: ProductControlState;
  readonly dataRoot: ProductControlRecord['dataRoot'] | null;
  readonly error: string | null;
}

export interface ProductControlStorageDirsProjection {
  readonly nimiDir: string;
  readonly nimiDataDir: string;
  readonly mediaCacheDir: string;
  readonly logsDir: string;
  readonly localModelsDir: string;
  readonly localRuntimeStatePath: string;
}

export type FirstRunPhase = 'storage' | 'device-scan' | 'local-ai' | 'setup';
export type FirstRunTerminalScreen = 'login' | 'repair' | 'blocked' | 'ready';
export type FirstRunScreen =
  | { readonly kind: 'phase'; readonly phase: FirstRunPhase }
  | { readonly kind: 'terminal'; readonly screen: FirstRunTerminalScreen };

export type ProductControlAdmissionProjection =
  | { readonly kind: 'ordinary-shell' }
  | { readonly kind: 'login' }
  | { readonly kind: 'first-run'; readonly state: ProductControlState };

export type RuntimeProductControlLocalClient = Pick<
  RuntimeLocalServiceClient,
  | 'getProductControlRecord'
  | 'getProductControlSelectedDataRoot'
  | 'ensureProductControlRecordCreated'
  | 'selectProductControlDataRoot'
  | 'setProductControlFirstRunInstallLevel'
  | 'completeProductControlFirstRunDeviceEnvironmentScan'
  | 'admitProductControlReadyForUse'
  | 'recordProductControlAccountDefaultProfileEvidence'
  | 'recordProductControlFirstRunLocalAiReadyEvidence'
  | 'reconcileProductControlFirstRunSetupState'
>;

export type RuntimeProductControlClient =
  | RuntimeProductControlLocalClient
  | { readonly local: RuntimeProductControlLocalClient };

export type RuntimeProductControlClientFor<Method extends keyof RuntimeProductControlLocalClient> =
  | Pick<RuntimeProductControlLocalClient, Method>
  | { readonly local: Pick<RuntimeProductControlLocalClient, Method> };

export type RuntimeProductControlCallOptions = {
  readonly callOptions?: RuntimeCallOptions;
};

export type RuntimeProductControlDataRootSelectionInput = {
  readonly dataRoot: string;
};

export type RuntimeProductControlFirstRunInstallLevelInput = {
  readonly installLevel: 'minimal' | 'recommended';
  readonly aiProfileAlias: string;
};

export type RuntimeProductControlReadyForUseAdmissionInput = {
  readonly accountDefaultProfileEvidenceJson: string;
  readonly builtInAiConfigEvidenceJson: string;
};

export type RuntimeProductControlAccountDefaultProfileEvidenceInput = {
  readonly accountDefaultProfileEvidenceJson: string;
};

export type RuntimeProductControlFirstRunLocalAiReadyEvidenceInput = {
  readonly runtimeBaselineRef: string;
  readonly builtInAiConfigEvidenceJson: string;
  readonly executionEvidenceRef: string;
};

export const FIRST_RUN_PHASES: readonly FirstRunPhase[] = ['storage', 'device-scan', 'local-ai', 'setup'];

export const PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY: Record<ProductControlState, string> = {
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
};

const PRODUCT_CONTROL_STATE_SET = new Set<string>(PRODUCT_CONTROL_STATES);
const PRODUCT_DATA_ROOT_STATUS_SET = new Set<string>(PRODUCT_DATA_ROOT_STATUSES);
const DEGRADED_PRODUCT_CONTROL_STATES = new Set<ProductControlState>(
  PRODUCT_CONTROL_STATES.filter((state) => state !== 'ready_for_use'),
);

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned invalid payload`);
  }
  return value as Record<string, unknown>;
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function pathSeparator(path: string): '/' | '\\' {
  return path.includes('\\') ? '\\' : '/';
}

function trimTrailingSeparator(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function joinProjectionPath(base: string, ...parts: string[]): string {
  const separator = pathSeparator(base);
  const trimmedBase = trimTrailingSeparator(base);
  return [trimmedBase, ...parts.map((part) => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))]
    .filter(Boolean)
    .join(separator);
}

function dirnameProjectionPath(path: string): string {
  const normalized = trimTrailingSeparator(path.trim());
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return index > 0 ? normalized.slice(0, index) : '';
}

export function isProductControlState(value: unknown): value is ProductControlState {
  return typeof value === 'string' && PRODUCT_CONTROL_STATE_SET.has(value.trim());
}

export function parseProductControlState(value: unknown): ProductControlState {
  const state = String(value || '').trim();
  if (!isProductControlState(state)) {
    throw new Error(`product control record returned invalid state: ${state}`);
  }
  return state;
}

export function isProductDataRootStatus(value: unknown): value is ProductDataRootStatus {
  return typeof value === 'string' && PRODUCT_DATA_ROOT_STATUS_SET.has(value.trim());
}

export function parseProductDataRootStatus(value: unknown): ProductDataRootStatus {
  const status = String(value || '').trim();
  if (!isProductDataRootStatus(status)) {
    throw new Error(`product control record returned invalid dataRoot status: ${status}`);
  }
  return status;
}

export function parseProductControlRecord(value: unknown): ProductControlRecord | null {
  if (value == null) return null;
  const record = asRecord(value, 'product control record');
  const firstRun = asRecord(record.firstRun, 'product control firstRun');
  const pointers = asRecord(record.pointers, 'product control pointers');
  const repair = asRecord(record.repair, 'product control repair');
  const dataRoot = record.dataRoot == null ? null : asRecord(record.dataRoot, 'product control dataRoot');
  const installLevelRaw = parseOptionalString(firstRun.installLevel);
  const installLevel = installLevelRaw as 'minimal' | 'recommended' | null;
  if (installLevelRaw && installLevelRaw !== 'minimal' && installLevelRaw !== 'recommended') {
    throw new Error(`product control record returned invalid install level: ${installLevelRaw}`);
  }
  return {
    schemaVersion: Number(record.schemaVersion),
    installId: String(record.installId || ''),
    productVersion: String(record.productVersion || ''),
    state: parseProductControlState(record.state),
    dataRoot: dataRoot
      ? {
          path: String(dataRoot.path || ''),
          status: parseProductDataRootStatus(dataRoot.status),
          selectedAt: String(dataRoot.selectedAt || ''),
          verifiedAt: String(dataRoot.verifiedAt || ''),
          selectedAtUnixMs: Number(dataRoot.selectedAtUnixMs || 0),
          verifiedAtUnixMs: Number(dataRoot.verifiedAtUnixMs || 0),
        }
      : null,
    firstRun: {
      installLevel,
      aiProfileAlias: parseOptionalString(firstRun.aiProfileAlias),
      completed: firstRun.completed === true,
      completedAt: parseOptionalString(firstRun.completedAt),
      initializationPlanId: parseOptionalString(firstRun.initializationPlanId),
      baselineProfileRef: parseOptionalString(firstRun.baselineProfileRef),
      baselineCommitId: parseOptionalString(firstRun.baselineCommitId),
      accountDefaultProfileRef: parseOptionalString(firstRun.accountDefaultProfileRef),
      builtInAiConfigRefs: Array.isArray(firstRun.builtInAiConfigRefs)
        ? firstRun.builtInAiConfigRefs.map((item) => String(item || '')).filter(Boolean)
        : [],
      runtimeBaselineRef: parseOptionalString(firstRun.runtimeBaselineRef),
      executionEvidenceRef: parseOptionalString(firstRun.executionEvidenceRef),
    },
    pointers: {
      runtimeConfigPath: parseOptionalString(pointers.runtimeConfigPath),
      factoryProfileIndex: parseOptionalString(pointers.factoryProfileIndex),
      appRegistry: parseOptionalString(pointers.appRegistry),
      appPackages: parseOptionalString(pointers.appPackages),
    },
    repair: {
      required: repair.required === true,
      reason: parseOptionalString(repair.reason),
    },
  };
}

export function parseProductControlRecordProjection(value: unknown): ProductControlRecordProjection {
  const record = asRecord(value, 'product_control_record_get');
  return {
    path: String(record.path || ''),
    exists: record.exists === true,
    state: parseProductControlState(record.state),
    record: parseProductControlRecord(record.record),
    error: parseOptionalString(record.error),
  };
}

export function parseProductControlProjectionJson(value: unknown): ProductControlRecordProjection {
  const envelope = asRecord(value, 'RuntimeLocalService.ProductControlProjectionJson');
  const raw = String(envelope.json || '').trim();
  if (!raw) {
    throw new Error('Runtime product-control projection json is required');
  }
  return parseProductControlRecordProjection(JSON.parse(raw));
}

export function parseProductControlSelectedDataRootProjection(
  value: unknown,
): ProductControlSelectedDataRootProjection {
  const record = asRecord(value, 'product_control_selected_data_root_get');
  const dataRoot = record.dataRoot == null ? null : asRecord(record.dataRoot, 'product control selected dataRoot');
  return {
    path: String(record.path || ''),
    exists: record.exists === true,
    state: parseProductControlState(record.state),
    dataRoot: dataRoot
      ? {
          path: String(dataRoot.path || ''),
          status: parseProductDataRootStatus(dataRoot.status),
          selectedAt: String(dataRoot.selectedAt || ''),
          verifiedAt: String(dataRoot.verifiedAt || ''),
          selectedAtUnixMs: Number(dataRoot.selectedAtUnixMs || 0),
          verifiedAtUnixMs: Number(dataRoot.verifiedAtUnixMs || 0),
        }
      : null,
    error: parseOptionalString(record.error),
  };
}

export function parseProductControlSelectedDataRootProjectionJson(
  value: unknown,
): ProductControlSelectedDataRootProjection {
  const envelope = asRecord(value, 'RuntimeLocalService.ProductControlProjectionJson');
  const raw = String(envelope.json || '').trim();
  if (!raw) {
    throw new Error('Runtime product-control selected-data-root projection json is required');
  }
  return parseProductControlSelectedDataRootProjection(JSON.parse(raw));
}

function runtimeProductControlLocalClient<Method extends keyof RuntimeProductControlLocalClient>(
  client: RuntimeProductControlClientFor<Method>,
): Pick<RuntimeProductControlLocalClient, Method> {
  if ('local' in client) {
    return client.local;
  }
  return client;
}

export async function getRuntimeProductControlRecord(
  client: RuntimeProductControlClientFor<'getProductControlRecord'>,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlRecordProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .getProductControlRecord({}, options?.callOptions);
  return parseProductControlProjectionJson(response);
}

export async function getRuntimeProductControlSelectedDataRoot(
  client: RuntimeProductControlClientFor<'getProductControlSelectedDataRoot'>,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlSelectedDataRootProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .getProductControlSelectedDataRoot({}, options?.callOptions);
  return parseProductControlSelectedDataRootProjectionJson(response);
}

export async function ensureRuntimeProductControlRecordCreated(
  client: RuntimeProductControlClientFor<'ensureProductControlRecordCreated'>,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlRecordProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .ensureProductControlRecordCreated({}, options?.callOptions);
  return parseProductControlProjectionJson(response);
}

export async function selectRuntimeProductControlDataRoot(
  client: RuntimeProductControlClientFor<'selectProductControlDataRoot'>,
  input: RuntimeProductControlDataRootSelectionInput,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlRecordProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .selectProductControlDataRoot({ dataRoot: input.dataRoot }, options?.callOptions);
  return parseProductControlProjectionJson(response);
}

export async function setRuntimeProductControlFirstRunInstallLevel(
  client: RuntimeProductControlClientFor<'setProductControlFirstRunInstallLevel'>,
  input: RuntimeProductControlFirstRunInstallLevelInput,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlRecordProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .setProductControlFirstRunInstallLevel({
      installLevel: input.installLevel,
      aiProfileAlias: input.aiProfileAlias,
    }, options?.callOptions);
  return parseProductControlProjectionJson(response);
}

export async function completeRuntimeProductControlFirstRunDeviceEnvironmentScan(
  client: RuntimeProductControlClientFor<'completeProductControlFirstRunDeviceEnvironmentScan'>,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlRecordProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .completeProductControlFirstRunDeviceEnvironmentScan({}, options?.callOptions);
  return parseProductControlProjectionJson(response);
}

export async function admitRuntimeProductControlReadyForUse(
  client: RuntimeProductControlClientFor<'admitProductControlReadyForUse'>,
  input: RuntimeProductControlReadyForUseAdmissionInput,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlRecordProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .admitProductControlReadyForUse({
      accountDefaultProfileEvidenceJson: input.accountDefaultProfileEvidenceJson,
      builtInAiConfigEvidenceJson: input.builtInAiConfigEvidenceJson,
    }, options?.callOptions);
  return parseProductControlProjectionJson(response);
}

export async function recordRuntimeProductControlAccountDefaultProfileEvidence(
  client: RuntimeProductControlClientFor<'recordProductControlAccountDefaultProfileEvidence'>,
  input: RuntimeProductControlAccountDefaultProfileEvidenceInput,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlRecordProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .recordProductControlAccountDefaultProfileEvidence({
      accountDefaultProfileEvidenceJson: input.accountDefaultProfileEvidenceJson,
    }, options?.callOptions);
  return parseProductControlProjectionJson(response);
}

export async function recordRuntimeProductControlFirstRunLocalAiReadyEvidence(
  client: RuntimeProductControlClientFor<'recordProductControlFirstRunLocalAiReadyEvidence'>,
  input: RuntimeProductControlFirstRunLocalAiReadyEvidenceInput,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlRecordProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .recordProductControlFirstRunLocalAiReadyEvidence({
      runtimeBaselineRef: input.runtimeBaselineRef,
      builtInAiConfigEvidenceJson: input.builtInAiConfigEvidenceJson,
      executionEvidenceRef: input.executionEvidenceRef,
    }, options?.callOptions);
  return parseProductControlProjectionJson(response);
}

export async function reconcileRuntimeProductControlFirstRunSetupState(
  client: RuntimeProductControlClientFor<'reconcileProductControlFirstRunSetupState'>,
  options?: RuntimeProductControlCallOptions,
): Promise<ProductControlRecordProjection> {
  const response = await runtimeProductControlLocalClient(client)
    .reconcileProductControlFirstRunSetupState({}, options?.callOptions);
  return parseProductControlProjectionJson(response);
}

export function productControlRecordUnavailableProjection(error: string): ProductControlRecordProjection {
  return {
    path: '',
    exists: false,
    state: 'config_missing',
    record: null,
    error,
  };
}

export function productControlSelectedDataRootUnavailableProjection(
  error: string,
): ProductControlSelectedDataRootProjection {
  return {
    path: '',
    exists: false,
    state: 'config_missing',
    dataRoot: null,
    error,
  };
}

export function projectProductControlStorageDirs(
  projection: ProductControlSelectedDataRootProjection,
): ProductControlStorageDirsProjection {
  const nimiDir = dirnameProjectionPath(projection.path || '');
  const dataRoot = projection.dataRoot?.path?.trim() || '';
  if (!nimiDir || !dataRoot) {
    throw new Error(projection.error || 'product-control storage dirs require a selected data root');
  }

  return {
    nimiDir,
    nimiDataDir: dataRoot,
    mediaCacheDir: joinProjectionPath(dataRoot, 'cache', 'media'),
    logsDir: joinProjectionPath(dataRoot, 'logs'),
    localModelsDir: joinProjectionPath(dataRoot, 'models'),
    localRuntimeStatePath: joinProjectionPath(nimiDir, 'runtime', 'local-state.json'),
  };
}

export function firstRunScreenForProductControlState(state: ProductControlState): FirstRunScreen {
  switch (state) {
    case 'config_missing':
    case 'data_root_missing':
      return { kind: 'phase', phase: 'storage' };
    case 'data_root_selected':
      return { kind: 'phase', phase: 'device-scan' };
    case 'ai_environment_unconfigured':
      return { kind: 'phase', phase: 'local-ai' };
    case 'local_ai_profile_selected_assets_missing':
    case 'local_ai_profile_selected_environment_not_ready':
    case 'local_ai_assets_downloaded_environment_not_ready':
    case 'local_ai_ready':
      return { kind: 'phase', phase: 'setup' };
    case 'repair_required':
      return { kind: 'terminal', screen: 'repair' };
    case 'blocked':
      return { kind: 'terminal', screen: 'blocked' };
    case 'ready_for_use':
      return { kind: 'terminal', screen: 'ready' };
    case 'not_logged_in':
      return { kind: 'terminal', screen: 'login' };
  }
}

export function isProductControlTransientState(state: ProductControlState): boolean {
  return state === 'config_missing';
}

export function isProductControlPhaseTransient(state: ProductControlState): boolean {
  return isProductControlTransientState(state);
}

export function isDegradedProductControlState(state: ProductControlState): boolean {
  return DEGRADED_PRODUCT_CONTROL_STATES.has(state);
}

export function isRepairRoutedProductControlState(state: ProductControlState): boolean {
  return state === 'repair_required' || state === 'blocked';
}

export function projectProductControlAdmission(state: ProductControlState): ProductControlAdmissionProjection {
  if (state === 'ready_for_use') {
    return { kind: 'ordinary-shell' };
  }
  if (state === 'not_logged_in') {
    return { kind: 'login' };
  }
  return { kind: 'first-run', state };
}
