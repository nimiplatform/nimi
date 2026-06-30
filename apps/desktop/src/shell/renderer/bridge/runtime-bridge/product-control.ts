import { hasShellHostInvoke, hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';
import {
  completeNimiRuntimeProductControlFirstRunDeviceEnvironmentScan,
  ensureNimiRuntimeProductControlRecordCreated,
  getNimiRuntimeProductControlRecord,
  getNimiRuntimeProductControlSelectedDataRoot,
  parseNimiProductControlRecordProjection,
  parseNimiProductControlSelectedDataRootProjection,
  projectUnavailableNimiProductControlRecord,
  projectUnavailableNimiProductControlSelectedDataRoot,
  reconcileNimiRuntimeProductControlFirstRunSetupState,
  selectNimiRuntimeProductControlDataRoot,
  setNimiRuntimeProductControlFirstRunInstallLevel,
  type NimiProductControlRecordProjection,
  type NimiProductControlSelectedDataRootProjection,
  type NimiRuntimeProductControlClientFor,
  type NimiRuntimeProductControlLocalClient,
} from '@nimiplatform/sdk/runtime';
import {
  parseNimiAIProfile,
  type NimiAIConfig,
  type NimiAIProfile,
} from '@nimiplatform/sdk/ai';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

export type {
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  NimiProductControlSelectedDataRootProjection,
  NimiProductControlState,
} from '@nimiplatform/sdk/runtime';

const PRODUCT_CONTROL_SURFACE_ID = 'desktop.product-control';
const PRODUCT_CONTROL_CALL_OPTIONS = {
  callOptions: {
    metadata: {
      surfaceId: PRODUCT_CONTROL_SURFACE_ID,
    },
  },
} as const;

function electronProductControlClient<Method extends keyof NimiRuntimeProductControlLocalClient>():
  NimiRuntimeProductControlClientFor<Method> {
  return getDesktopRuntime().generated as unknown as NimiRuntimeProductControlClientFor<Method>;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned invalid payload`);
  }
  return value as Record<string, unknown>;
}

export async function getProductControlRecord(): Promise<NimiProductControlRecordProjection> {
  if (hasTauriInvoke()) {
    return invokeChecked('product_control_record_get', {}, parseNimiProductControlRecordProjection);
  }
  if (hasShellHostInvoke()) {
    return getNimiRuntimeProductControlRecord(
      electronProductControlClient<'getProductControlRecord'>(),
      PRODUCT_CONTROL_CALL_OPTIONS,
    );
  }
  return projectUnavailableNimiProductControlRecord('product_control_record_get requires standard shell Runtime');
}

export async function getProductControlSelectedDataRoot(): Promise<NimiProductControlSelectedDataRootProjection> {
  if (hasTauriInvoke()) {
    return invokeChecked(
      'product_control_selected_data_root_get',
      {},
      parseNimiProductControlSelectedDataRootProjection,
    );
  }
  if (hasShellHostInvoke()) {
    return getNimiRuntimeProductControlSelectedDataRoot(
      electronProductControlClient<'getProductControlSelectedDataRoot'>(),
      PRODUCT_CONTROL_CALL_OPTIONS,
    );
  }
  return projectUnavailableNimiProductControlSelectedDataRoot(
    'product_control_selected_data_root_get requires standard shell Runtime',
  );
}

export async function ensureProductControlRecordCreated(): Promise<NimiProductControlRecordProjection> {
  if (hasTauriInvoke()) {
    return invokeChecked('product_control_record_ensure_created', {}, parseNimiProductControlRecordProjection);
  }
  if (hasShellHostInvoke()) {
    return ensureNimiRuntimeProductControlRecordCreated(
      electronProductControlClient<'ensureProductControlRecordCreated'>(),
      PRODUCT_CONTROL_CALL_OPTIONS,
    );
  }
  throw new Error('product_control_record_ensure_created requires standard shell Runtime');
}

export async function selectProductDataRoot(dataRoot: string): Promise<NimiProductControlRecordProjection> {
  if (hasTauriInvoke()) {
    return invokeChecked('product_control_record_select_data_root', {
      payload: { dataRoot },
    }, parseNimiProductControlRecordProjection);
  }
  if (hasShellHostInvoke()) {
    return selectNimiRuntimeProductControlDataRoot(
      electronProductControlClient<'selectProductControlDataRoot'>(),
      { dataRoot },
      PRODUCT_CONTROL_CALL_OPTIONS,
    );
  }
  throw new Error('product_control_record_select_data_root requires standard shell Runtime');
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
}): Promise<NimiProductControlRecordProjection> {
  if (hasTauriInvoke()) {
    return invokeChecked('product_control_record_set_first_run_install_level', {
      payload: input,
    }, parseNimiProductControlRecordProjection);
  }
  if (hasShellHostInvoke()) {
    return setNimiRuntimeProductControlFirstRunInstallLevel(
      electronProductControlClient<'setProductControlFirstRunInstallLevel'>(),
      {
        installLevel: input.installLevel,
        aiProfileAlias: input.aiProfileAlias || '',
      },
      PRODUCT_CONTROL_CALL_OPTIONS,
    );
  }
  throw new Error('product_control_record_set_first_run_install_level requires standard shell Runtime');
}

export async function ensureProductAccountDefaultProfile(): Promise<NimiProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_ensure_account_default_profile requires Tauri runtime');
  }
  return invokeChecked(
    'product_control_record_ensure_account_default_profile',
    {},
    parseNimiProductControlRecordProjection,
  );
}

export async function prepareProductFirstRunLocalAiReady(): Promise<NimiProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_prepare_first_run_local_ai_ready requires Tauri runtime');
  }
  return invokeChecked(
    'product_control_record_prepare_first_run_local_ai_ready',
    {},
    parseNimiProductControlRecordProjection,
  );
}

export async function reconcileProductFirstRunSetupState(): Promise<NimiProductControlRecordProjection> {
  if (hasTauriInvoke()) {
    return invokeChecked(
      'product_control_record_reconcile_first_run_setup_state',
      {},
      parseNimiProductControlRecordProjection,
    );
  }
  if (hasShellHostInvoke()) {
    return reconcileNimiRuntimeProductControlFirstRunSetupState(
      electronProductControlClient<'reconcileProductControlFirstRunSetupState'>(),
      PRODUCT_CONTROL_CALL_OPTIONS,
    );
  }
  throw new Error('product_control_record_reconcile_first_run_setup_state requires standard shell Runtime');
}

export async function completeProductFirstRunDeviceEnvironmentScan(): Promise<NimiProductControlRecordProjection> {
  if (hasTauriInvoke()) {
    return invokeChecked(
      'product_control_record_complete_first_run_device_environment_scan',
      {},
      parseNimiProductControlRecordProjection,
    );
  }
  if (hasShellHostInvoke()) {
    return completeNimiRuntimeProductControlFirstRunDeviceEnvironmentScan(
      electronProductControlClient<'completeProductControlFirstRunDeviceEnvironmentScan'>(),
      PRODUCT_CONTROL_CALL_OPTIONS,
    );
  }
  throw new Error('product_control_record_complete_first_run_device_environment_scan requires standard shell Runtime');
}

/** The Account Default Profile projected as a portable AIProfile payload. */
export type AccountDefaultProfileAIProfile = NimiAIProfile;

/**
 * Read + verify the Account Default Profile as a portable AIProfile payload.
 *
 * Used by the Desktop host AIConfig scope-init rule in
 * `.nimi/spec/desktop/kernel/ai-config-host-contract.md`: a new AIConfig scope
 * initializes from the Account Default Profile only when no prior AIConfig
 * exists for that scope. The payload is the verified content of the durable
 * `default.json` record.
 */
export async function getAccountDefaultProfileForScopeInit(): Promise<AccountDefaultProfileAIProfile> {
  if (!hasTauriInvoke()) {
    throw new Error('account_default_profile_for_scope_init requires Tauri runtime');
  }
  return invokeChecked(
    'account_default_profile_for_scope_init',
    {},
    (value) => parseNimiAIProfile(value, {
      label: 'Account Default Profile payload',
      allowMissingOptionalFields: true,
    }),
  );
}

function parseBuiltInAIConfigForScopeInit(value: unknown): NimiAIConfig {
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
  const targetRefs = asRecord(capabilities.targetRefs, 'built-in AIConfig targetRefs');
  const selectedParams = capabilities.selectedParams
    ? asRecord(capabilities.selectedParams, 'built-in AIConfig selectedParams')
    : {};
  return {
    scopeRef: { kind: 'feature', ownerId, surfaceId },
    capabilities: {
      targetRefs: targetRefs as NimiAIConfig['capabilities']['targetRefs'],
      selectedParams: selectedParams as NimiAIConfig['capabilities']['selectedParams'],
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
): Promise<NimiAIConfig> {
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
 * Requests Runtime product-control admission of `ready_for_use`.
 *
 * The legacy Desktop command name is retained as a shell bridge seam, but
 * Desktop no longer writes admission; the backend submits Desktop-owned host
 * evidence to Runtime, and Runtime commits or routes the product-control state.
 */
export async function admitProductReadyForUse(): Promise<NimiProductControlRecordProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('product_control_record_admit_ready_for_use requires Tauri runtime');
  }
  return invokeChecked('product_control_record_admit_ready_for_use', {}, parseNimiProductControlRecordProjection);
}
