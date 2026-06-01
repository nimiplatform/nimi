import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';
import {
  parseProductControlRecordProjection,
  parseProductControlSelectedDataRootProjection,
  productControlRecordUnavailableProjection,
  productControlSelectedDataRootUnavailableProjection,
  type ProductControlRecordProjection,
  type ProductControlSelectedDataRootProjection,
} from '@nimiplatform/sdk';
import {
  parseAIProfile,
  type AIConfig,
  type AIProfile,
} from '@nimiplatform/sdk/ai';

export type {
  ProductControlRecord,
  ProductControlRecordProjection,
  ProductControlSelectedDataRootProjection,
  ProductControlState,
} from '@nimiplatform/sdk';

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned invalid payload`);
  }
  return value as Record<string, unknown>;
}

export async function getProductControlRecord(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    return productControlRecordUnavailableProjection('product_control_record_get requires Tauri runtime');
  }
  return invokeChecked('product_control_record_get', {}, parseProductControlRecordProjection);
}

export async function getProductControlSelectedDataRoot(): Promise<ProductControlSelectedDataRootProjection> {
  if (!hasTauriInvoke()) {
    return productControlSelectedDataRootUnavailableProjection(
      'product_control_selected_data_root_get requires Tauri runtime',
    );
  }
  return invokeChecked(
    'product_control_selected_data_root_get',
    {},
    parseProductControlSelectedDataRootProjection,
  );
}

export async function ensureProductControlRecordCreated(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_ensure_created requires Tauri runtime');
  }
  return invokeChecked('product_control_record_ensure_created', {}, parseProductControlRecordProjection);
}

export async function selectProductDataRoot(dataRoot: string): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_select_data_root requires Tauri runtime');
  }
  return invokeChecked('product_control_record_select_data_root', {
    payload: { dataRoot },
  }, parseProductControlRecordProjection);
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
  }, parseProductControlRecordProjection);
}

export async function ensureProductAccountDefaultProfile(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_ensure_account_default_profile requires Tauri runtime');
  }
  return invokeChecked(
    'product_control_record_ensure_account_default_profile',
    {},
    parseProductControlRecordProjection,
  );
}

export async function prepareProductFirstRunLocalAiReady(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_prepare_first_run_local_ai_ready requires Tauri runtime');
  }
  return invokeChecked(
    'product_control_record_prepare_first_run_local_ai_ready',
    {},
    parseProductControlRecordProjection,
  );
}

export async function reconcileProductFirstRunSetupState(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_reconcile_first_run_setup_state requires Tauri runtime');
  }
  return invokeChecked(
    'product_control_record_reconcile_first_run_setup_state',
    {},
    parseProductControlRecordProjection,
  );
}

export async function completeProductFirstRunDeviceEnvironmentScan(): Promise<ProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_complete_first_run_device_environment_scan requires Tauri runtime');
  }
  return invokeChecked(
    'product_control_record_complete_first_run_device_environment_scan',
    {},
    parseProductControlRecordProjection,
  );
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
  return invokeChecked('product_control_record_admit_ready_for_use', {}, parseProductControlRecordProjection);
}
