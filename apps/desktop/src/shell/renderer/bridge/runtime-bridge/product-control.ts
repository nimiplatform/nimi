import {
  hasElectronInvoke,
  openShellFileDialog,
  type ShellFileDialogOpenResult,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';
import {
  parseNimiProductControlRecordProjection,
  parseNimiProductControlSelectedDataRootProjection,
  projectUnavailableNimiProductControlRecord,
  projectUnavailableNimiProductControlSelectedDataRoot,
  type NimiProductControlRecordProjection,
  type NimiProductControlSelectedDataRootProjection,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { getRuntimeBridgeStatus, restartRuntimeBridge } from './runtime-daemon';

export type {
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  NimiProductControlSelectedDataRootProjection,
  NimiProductControlState,
} from '@nimiplatform/sdk/runtime';

export type ProductControlCheckSyncResource = {
  readonly kind: string;
  readonly reference?: string;
  readonly locator?: string;
  readonly status: 'available' | 'unavailable' | 'incompatible' | 'unknown' | 'conflict' | 'failed';
  readonly change?: 'rebased' | 'adopted' | 'rebuilt';
  readonly reason: string;
  readonly nextAction?: 'rerun_check_sync';
};

export type ProductControlCheckSyncProjection = {
  readonly run: null | {
    readonly runId: string;
    readonly rootActivationId: string;
    readonly trigger: 'activation' | 'manual' | 'interrupted_recovery';
    readonly state: 'running' | 'completed' | 'failed' | 'superseded';
    readonly owners: readonly {
      readonly ownerId: string;
      readonly state: 'pending' | 'running' | 'completed' | 'failed';
      readonly resources: readonly ProductControlCheckSyncResource[];
    }[];
    readonly unclaimed: readonly { readonly locator: string; readonly status: 'unknown'; readonly reason: string }[];
  };
  readonly obligation: null | { readonly rootActivationId: string; readonly state: 'required' | 'completed' };
  readonly error: string | null;
};

export type ProductControlReplacementProjection = Omit<NimiProductControlRecordProjection, 'configMutation'> & {
  readonly activation?: null | {
    readonly activated: boolean;
    readonly reasonCode: 'DATA_ROOT_REPLACED' | 'DATA_ROOT_UNCHANGED' | 'DATA_ROOT_OVERLAPS_CURRENT';
    readonly actionHint: 'restart_runtime_and_check_sync' | 'run_check_sync' | 'choose_path_disjoint_root';
  };
  readonly configMutation?: null | {
    readonly disposition: 'applied' | 'restart_required' | 'repair_required';
    readonly reasonCode: string;
    readonly actionHint: string;
  };
};

function firstDialogPath(result: ShellFileDialogOpenResult): string | null {
  if (result.canceled) return null;
  const path = typeof result.paths[0] === 'string' ? result.paths[0].trim() : '';
  return path || null;
}

export async function getProductControlRecord(): Promise<NimiProductControlRecordProjection> {
  if (hasElectronInvoke()) {
    return invokeChecked('product_control_record_get', {}, parseNimiProductControlRecordProjection);
  }
  return projectUnavailableNimiProductControlRecord('product_control_record_get requires standard shell Runtime');
}

export async function getProductControlSelectedDataRoot(): Promise<NimiProductControlSelectedDataRootProjection> {
  if (hasElectronInvoke()) {
    return invokeChecked(
      'product_control_selected_data_root_get',
      {},
      parseNimiProductControlSelectedDataRootProjection,
    );
  }
  return projectUnavailableNimiProductControlSelectedDataRoot(
    'product_control_selected_data_root_get requires standard shell Runtime',
  );
}

export async function ensureProductControlRecordCreated(): Promise<NimiProductControlRecordProjection> {
  if (hasElectronInvoke()) {
    return invokeChecked('product_control_record_ensure_created', {}, parseNimiProductControlRecordProjection);
  }
  throw new Error('product_control_record_ensure_created requires standard shell Runtime');
}

export async function selectProductDataRoot(dataRoot: string): Promise<NimiProductControlRecordProjection> {
  if (hasElectronInvoke()) {
    const selected = await invokeChecked('product_control_record_select_data_root', {
      payload: { dataRoot },
    }, parseNimiProductControlRecordProjection);
    if (selected.configMutation?.reasonCode === ReasonCode.CONFIG_RESTART_REQUIRED) {
      const status = await getRuntimeBridgeStatus();
      if (status.launchMode === 'SOURCE') {
        return selected;
      }
      await restartRuntimeBridge();
      return getProductControlRecord();
    }
    return selected;
  }
  throw new Error('product_control_record_select_data_root requires standard shell Runtime');
}

export async function initializeProductControlRootActivation(): Promise<NimiProductControlRecordProjection> {
  if (!hasElectronInvoke()) {
    throw new Error('product_control_root_activation_initialize requires standard shell Runtime');
  }
  return invokeChecked('product_control_root_activation_initialize', {}, parseNimiProductControlRecordProjection);
}

export async function replaceProductDataRoot(targetRoot: string): Promise<ProductControlReplacementProjection> {
  if (!hasElectronInvoke()) {
    throw new Error('product_control_data_root_replace requires standard shell Runtime');
  }
	await initializeProductControlRootActivation();
  return invokeChecked('product_control_data_root_replace', {
    payload: { targetRoot },
  }, parseProductControlReplacementProjection);
}

export async function startProductControlCheckSync(): Promise<ProductControlCheckSyncProjection> {
  if (!hasElectronInvoke()) {
    throw new Error('product_control_check_sync_start requires standard shell Runtime');
  }
	await initializeProductControlRootActivation();
  return invokeChecked('product_control_check_sync_start', {}, parseProductControlCheckSyncProjection);
}

export async function getProductControlCheckSync(): Promise<ProductControlCheckSyncProjection> {
  if (!hasElectronInvoke()) {
    throw new Error('product_control_check_sync_get requires standard shell Runtime');
  }
  return invokeChecked('product_control_check_sync_get', {}, parseProductControlCheckSyncProjection);
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
  if (!hasElectronInvoke()) {
    throw new Error('Product data-root picker requires standard shell file dialog');
  }
  return firstDialogPath(await openShellFileDialog({
    kind: 'directory',
    title: 'Choose where Nimi stores models and data',
  }));
}

/**
 * Requests Runtime product-control admission of `ready_for_use`.
 *
 * Desktop does not write admission; Runtime evaluates its current readiness
 * gates and commits or routes the Product Control state.
 */
export async function admitProductReadyForUse(): Promise<NimiProductControlRecordProjection> {
  if (!hasElectronInvoke()) {
    throw new Error('product_control_record_admit_ready_for_use requires standard shell Runtime');
  }
  return invokeChecked('product_control_record_admit_ready_for_use', {}, parseNimiProductControlRecordProjection);
}

function parseProductControlCheckSyncProjection(value: unknown): ProductControlCheckSyncProjection {
  const projection = checkSyncRecord(value);
  const obligation = projection.obligation == null ? null : checkSyncRecord(projection.obligation);
  const run = projection.run == null ? null : checkSyncRecord(projection.run);
  return {
    run: run ? {
      runId: checkSyncText(run.runId),
      rootActivationId: checkSyncText(run.rootActivationId),
      trigger: checkSyncOneOf(run.trigger, ['activation', 'manual', 'interrupted_recovery'] as const),
      state: checkSyncOneOf(run.state, ['running', 'completed', 'failed', 'superseded'] as const),
      owners: checkSyncArray(run.owners).map((rawOwner) => {
        const owner = checkSyncRecord(rawOwner);
        return {
          ownerId: checkSyncText(owner.ownerId),
          state: checkSyncOneOf(owner.state, ['pending', 'running', 'completed', 'failed'] as const),
          resources: checkSyncArray(owner.resources).map((rawResource) => {
            const resource = checkSyncRecord(rawResource);
            return {
              kind: checkSyncText(resource.kind),
              reference: checkSyncOptionalText(resource.reference) ?? undefined,
              locator: resource.locator == null ? undefined : checkSyncLocator(resource.locator),
              status: checkSyncOneOf(resource.status, ['available', 'unavailable', 'incompatible', 'unknown', 'conflict', 'failed'] as const),
              change: resource.change == null ? undefined : checkSyncOneOf(resource.change, ['rebased', 'adopted', 'rebuilt'] as const),
              reason: checkSyncText(resource.reason),
              nextAction: resource.nextAction == null ? undefined : checkSyncOneOf(resource.nextAction, ['rerun_check_sync'] as const),
            };
          }),
        };
      }),
      unclaimed: checkSyncArray(run.unclaimed).map((rawEntry) => {
        const entry = checkSyncRecord(rawEntry);
        return {
          locator: checkSyncLocator(entry.locator),
          status: checkSyncOneOf(entry.status, ['unknown'] as const),
          reason: checkSyncText(entry.reason),
        };
      }),
    } : null,
    obligation: obligation ? {
      rootActivationId: checkSyncText(obligation.rootActivationId),
      state: checkSyncOneOf(obligation.state, ['required', 'completed'] as const),
    } : null,
    error: checkSyncOptionalText(projection.error),
  };
}

function parseProductControlReplacementProjection(value: unknown): ProductControlReplacementProjection {
	const raw = checkSyncRecord(value);
	const config = raw.configMutation == null ? null : checkSyncRecord(raw.configMutation);
	const parsed = parseNimiProductControlRecordProjection(
		config?.disposition === 'repair_required' ? { ...raw, configMutation: null } : raw,
	);
	const activation = raw.activation == null ? null : checkSyncRecord(raw.activation);
	if (config?.disposition === 'repair_required'
		&& (config.reasonCode !== 'CONFIG_WRITE_FAILED' || config.actionHint !== 'repair_runtime_config')) {
		throw new Error('runtime-product-control-response-invalid');
	}
	return {
		...parsed,
		activation: activation ? {
			activated: activation.activated === true,
			reasonCode: checkSyncOneOf(activation.reasonCode, ['DATA_ROOT_REPLACED', 'DATA_ROOT_UNCHANGED', 'DATA_ROOT_OVERLAPS_CURRENT'] as const),
			actionHint: checkSyncOneOf(activation.actionHint, ['restart_runtime_and_check_sync', 'run_check_sync', 'choose_path_disjoint_root'] as const),
		} : null,
		configMutation: config ? {
			disposition: checkSyncOneOf(config.disposition, ['applied', 'restart_required', 'repair_required'] as const),
			reasonCode: checkSyncText(config.reasonCode),
			actionHint: checkSyncText(config.actionHint),
		} : null,
	};
}

function checkSyncRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('runtime-check-sync-response-invalid');
  }
  return value as Record<string, unknown>;
}

function checkSyncArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('runtime-check-sync-response-invalid');
  return value;
}

function checkSyncText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 32_768) {
    throw new Error('runtime-check-sync-response-invalid');
  }
  return value;
}

function checkSyncOptionalText(value: unknown): string | null {
  return value == null ? null : checkSyncText(value);
}

function checkSyncLocator(value: unknown): string {
  const locator = checkSyncText(value).replaceAll('\\', '/');
  if (locator.startsWith('/') || /^[a-zA-Z]:\//.test(locator) || locator.split('/').includes('..')) {
    throw new Error('runtime-check-sync-private-locator-invalid');
  }
  return locator;
}

function checkSyncOneOf<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  const text = checkSyncText(value);
  if (!(values as readonly string[]).includes(text)) throw new Error('runtime-check-sync-response-invalid');
  return text as Values[number];
}
