import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';

export type ProductControlState =
  | 'not_logged_in'
  | 'config_missing'
  | 'data_root_missing'
  | 'data_root_selected'
  | 'ai_environment_unconfigured'
  | 'local_ai_profile_selected_assets_missing'
  | 'local_ai_profile_selected_environment_not_ready'
  | 'local_ai_assets_downloaded_environment_not_ready'
  | 'local_ai_ready'
  | 'repair_required'
  | 'blocked'
  | 'ready_for_use';

type ProductDataRootStatus = 'selected' | 'ready' | 'repair_required';

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

const PRODUCT_CONTROL_STATES = new Set<ProductControlState>([
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
]);

const PRODUCT_DATA_ROOT_STATUSES = new Set<ProductDataRootStatus>([
  'selected',
  'ready',
  'repair_required',
]);

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned invalid payload`);
  }
  return value as Record<string, unknown>;
}

function parseState(value: unknown): ProductControlState {
  const state = String(value || '').trim() as ProductControlState;
  if (!PRODUCT_CONTROL_STATES.has(state)) {
    throw new Error(`product control record returned invalid state: ${state}`);
  }
  return state;
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function parseDataRootStatus(value: unknown): ProductDataRootStatus {
  const status = String(value || '').trim() as ProductDataRootStatus;
  if (!PRODUCT_DATA_ROOT_STATUSES.has(status)) {
    throw new Error(`product control record returned invalid dataRoot status: ${status}`);
  }
  return status;
}

function parseRecord(value: unknown): ProductControlRecord | null {
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
    state: parseState(record.state),
    dataRoot: dataRoot
      ? {
          path: String(dataRoot.path || ''),
          status: parseDataRootStatus(dataRoot.status),
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
        ? firstRun.builtInAiConfigRefs.map((value) => String(value || '')).filter(Boolean)
        : [],
      runtimeBaselineRef: parseOptionalString(firstRun.runtimeBaselineRef),
      executionEvidenceRef: parseOptionalString(firstRun.executionEvidenceRef),
    },
    pointers: {
      runtimeConfigPath: parseOptionalString(pointers.runtimeConfigPath),
    },
    repair: {
      required: repair.required === true,
      reason: parseOptionalString(repair.reason),
    },
  };
}

function parseProjection(value: unknown): ProductControlRecordProjection {
  const record = asRecord(value, 'product_control_record_get');
  return {
    path: String(record.path || ''),
    exists: record.exists === true,
    state: parseState(record.state),
    record: parseRecord(record.record),
    error: parseOptionalString(record.error),
  };
}

export async function getProductControlRecord(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    return {
      path: '',
      exists: false,
      state: 'config_missing',
      record: null,
      error: null,
    };
  }
  return invokeChecked('product_control_record_get', {}, parseProjection);
}

export async function selectProductDataRoot(dataRoot: string): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_select_data_root requires Tauri runtime');
  }
  return invokeChecked('product_control_record_select_data_root', {
    payload: { dataRoot },
  }, parseProjection);
}

export async function setProductFirstRunInstallLevel(input: {
  installLevel: 'minimal' | 'recommended';
  aiProfileAlias?: string | null;
}): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_set_first_run_install_level requires Tauri runtime');
  }
  return invokeChecked('product_control_record_set_first_run_install_level', {
    payload: input,
  }, parseProjection);
}

export async function ensureProductAccountDefaultProfile(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_ensure_account_default_profile requires Tauri runtime');
  }
  return invokeChecked('product_control_record_ensure_account_default_profile', {}, parseProjection);
}

export async function setProductFirstRunSetupState(input: {
  state: Exclude<ProductControlState, 'ready_for_use' | 'local_ai_ready' | 'config_missing' | 'data_root_missing' | 'data_root_selected' | 'ai_environment_unconfigured' | 'not_logged_in'>;
  reason?: string | null;
}): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_set_first_run_setup_state requires Tauri runtime');
  }
  return invokeChecked('product_control_record_set_first_run_setup_state', {
    payload: input,
  }, parseProjection);
}

/**
 * Requests backend admission of the first-run transition into `ready_for_use`.
 *
 * The backend admission op is the ONLY authority that may write `ready_for_use`
 * (cold-start-authority-contract P-COLD-016). The renderer only requests this
 * transition and displays the returned projection. On success the projection
 * carries `state: 'ready_for_use'` with the full record; on failure it carries
 * the earliest-failed `state`, a non-null `error`, and `record: null`.
 */
export async function admitProductReadyForUse(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_admit_ready_for_use requires Tauri runtime');
  }
  return invokeChecked('product_control_record_admit_ready_for_use', {}, parseProjection);
}
