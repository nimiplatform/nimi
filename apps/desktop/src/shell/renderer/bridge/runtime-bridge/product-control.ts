import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';
import {
  parseAIProfile,
  type AIConfig,
  type AIProfile,
} from '@nimiplatform/sdk/ai';

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

function parseSelectedDataRootProjection(value: unknown): ProductControlSelectedDataRootProjection {
  const record = asRecord(value, 'product_control_selected_data_root_get');
  const dataRoot = record.dataRoot == null ? null : asRecord(record.dataRoot, 'product control selected dataRoot');
  return {
    path: String(record.path || ''),
    exists: record.exists === true,
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

export async function getProductControlSelectedDataRoot(): Promise<ProductControlSelectedDataRootProjection> {
  if (!hasTauriInvoke()) {
    return {
      path: '',
      exists: false,
      state: 'config_missing',
      dataRoot: null,
      error: null,
    };
  }
  return invokeChecked('product_control_selected_data_root_get', {}, parseSelectedDataRootProjection);
}

export async function ensureProductControlRecordCreated(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_ensure_created requires Tauri runtime');
  }
  return invokeChecked('product_control_record_ensure_created', {}, parseProjection);
}

export async function selectProductDataRoot(dataRoot: string): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_select_data_root requires Tauri runtime');
  }
  return invokeChecked('product_control_record_select_data_root', {
    payload: { dataRoot },
  }, parseProjection);
}

/**
 * Opens the OS native directory picker for the first-run Storage phase.
 *
 * Returns the picked absolute directory path, or `null` when the user
 * cancelled the dialog. The path is only a candidate; the caller must pass it
 * to {@link selectProductDataRoot}, which is the sole owner of recording and
 * fail-closed validation of the selected `nimi_data` root (P-COLD-010).
 */
export async function pickProductDataRootDirectory(): Promise<string | null> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_pick_data_root_directory requires Tauri runtime');
  }
  return invokeChecked('product_control_pick_data_root_directory', {}, (value) => {
    if (value == null) return null;
    if (typeof value !== 'string') {
      throw new Error('product_control_pick_data_root_directory returned invalid payload');
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });
}

/**
 * Resolves the OS-conventional default `nimi_data` directory proposed during
 * first-run Storage selection.
 *
 * This is a read-only proposal — it neither creates the directory nor mutates
 * the product-control record. The renderer pre-fills the returned absolute
 * path so the Storage phase never starts from an empty field; the user still
 * explicitly confirms it via {@link selectProductDataRoot}, the sole owner of
 * recording and fail-closed validation (P-COLD-010). Outside the Tauri runtime
 * — and on any non-string payload — it resolves to `null` so the field fails
 * closed (empty) rather than showing a fabricated path.
 */
export async function defaultProductDataRootDirectory(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  return invokeChecked('product_control_default_data_root_directory', {}, (value) => {
    if (typeof value !== 'string') {
      throw new Error('product_control_default_data_root_directory returned invalid payload');
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });
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

export async function prepareProductFirstRunLocalAiReady(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_prepare_first_run_local_ai_ready requires Tauri runtime');
  }
  return invokeChecked('product_control_record_prepare_first_run_local_ai_ready', {}, parseProjection);
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

/** The Account Default Profile projected as a portable AIProfile payload. */
export type AccountDefaultProfileAIProfile = AIProfile;

/**
 * Read + verify the Account Default Profile as a portable AIProfile payload.
 *
 * Used by the Desktop host AIConfig scope-init rule (product manual "Profile
 * And AIConfig Model"): a new AIConfig scope initializes from the Account
 * Default Profile only when no prior AIConfig exists for that scope. The
 * payload is the verified content of the durable `default.json` record.
 */
export async function getAccountDefaultProfileForScopeInit(): Promise<AccountDefaultProfileAIProfile> {
  if (!hasTauriInvoke()) {
    throw new Error('account_default_profile_for_scope_init requires Tauri runtime');
  }
  return invokeChecked(
    'account_default_profile_for_scope_init',
    {},
    (value) => parseAIProfile(value, {
      label: 'Account Default Profile payload',
      allowMissingOptionalFields: true,
    }),
  );
}

function parseBuiltInAIConfigForScopeInit(value: unknown): AIConfig {
  const record = asRecord(value, 'built_in_ai_config_for_scope_init');
  const scopeRef = asRecord(record.scopeRef, 'built-in AIConfig scopeRef');
  const capabilities = asRecord(record.capabilities, 'built-in AIConfig capabilities');
  const profileOrigin = asRecord(record.profileOrigin, 'built-in AIConfig profileOrigin');
  const kind = String(scopeRef.kind || '').trim();
  const ownerId = String(scopeRef.ownerId || '').trim();
  const surfaceId = String(scopeRef.surfaceId || '').trim();
  if (kind !== 'feature' || ownerId !== 'desktop.chat' || (surfaceId !== 'nimi' && surfaceId !== 'agent')) {
    throw new Error('built-in AIConfig returned a non-canonical chat scope');
  }
  const selectedBindings = asRecord(capabilities.selectedBindings, 'built-in AIConfig selectedBindings');
  return {
    scopeRef: { kind: 'feature', ownerId, surfaceId },
    capabilities: {
      selectedBindings: selectedBindings as AIConfig['capabilities']['selectedBindings'],
      localProfileRefs: {},
      selectedParams: {},
    },
    profileOrigin: {
      profileId: String(profileOrigin.profileId || '').trim(),
      title: String(profileOrigin.title || '').trim(),
      appliedAt: String(profileOrigin.appliedAt || '').trim(),
    },
  };
}

export async function getBuiltInAIConfigForScopeInit(
  surfaceId: 'nimi' | 'agent',
): Promise<AIConfig> {
  if (!hasTauriInvoke()) {
    throw new Error('built_in_ai_config_for_scope_init requires Tauri runtime');
  }
  return invokeChecked(
    'built_in_ai_config_for_scope_init',
    { payload: { surfaceId } },
    parseBuiltInAIConfigForScopeInit,
  );
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
