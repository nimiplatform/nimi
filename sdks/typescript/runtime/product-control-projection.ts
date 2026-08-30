import {
  type ProductControlProjectionJson,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import type {
  NimiFirstRunScreen,
  NimiProductControlAdmissionProjection,
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  NimiProductControlSelectedDataRootProjection,
  NimiProductControlState,
  NimiProductControlStorageDirsProjection,
  NimiProductDataRootStatus,
} from './product-control-types';
import {
  NIMI_PRODUCT_CONTROL_STATES,
  NIMI_PRODUCT_DATA_ROOT_STATUSES,
} from './product-control-types';

const PRODUCT_CONTROL_STATE_SET = new Set<string>(NIMI_PRODUCT_CONTROL_STATES);
const PRODUCT_DATA_ROOT_STATUS_SET = new Set<string>(NIMI_PRODUCT_DATA_ROOT_STATUSES);
const DEGRADED_PRODUCT_CONTROL_STATES = new Set<NimiProductControlState>(
  NIMI_PRODUCT_CONTROL_STATES.filter((state) => state !== 'ready_for_use'),
);

function productControlError(input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
  readonly source?: 'sdk' | 'runtime';
}): Error {
  return createNimiError({
    message: input.message,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source ?? 'runtime',
  });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_PAYLOAD_INVALID',
      message: `${label} returned invalid payload.`,
      actionHint: 'inspect_runtime_product_control_payload',
    });
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseOptionalString(value: unknown): string | null {
  const text = normalizeText(value);
  return text ? text : null;
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

export function isNimiProductControlState(value: unknown): value is NimiProductControlState {
  return typeof value === 'string' && PRODUCT_CONTROL_STATE_SET.has(value.trim());
}

export function parseNimiProductControlState(value: unknown): NimiProductControlState {
  const state = normalizeText(value);
  if (!isNimiProductControlState(state)) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_STATE_INVALID',
      message: `Product-control record returned invalid state: ${state}.`,
      actionHint: 'inspect_runtime_product_control_state',
    });
  }
  return state;
}

export function isNimiProductDataRootStatus(value: unknown): value is NimiProductDataRootStatus {
  return typeof value === 'string' && PRODUCT_DATA_ROOT_STATUS_SET.has(value.trim());
}

export function parseNimiProductDataRootStatus(value: unknown): NimiProductDataRootStatus {
  const status = normalizeText(value);
  if (!isNimiProductDataRootStatus(status)) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_DATA_ROOT_STATUS_INVALID',
      message: `Product-control record returned invalid dataRoot status: ${status}.`,
      actionHint: 'inspect_runtime_product_control_data_root',
    });
  }
  return status;
}

export function parseNimiProductControlRecord(value: unknown): NimiProductControlRecord | null {
  if (value == null) return null;
  const record = asRecord(value, 'product control record');
  const firstRun = asRecord(record.firstRun, 'product control firstRun');
  const pointers = asRecord(record.pointers, 'product control pointers');
  const repair = asRecord(record.repair, 'product control repair');
  const dataRoot = record.dataRoot == null ? null : asRecord(record.dataRoot, 'product control dataRoot');
  const unsupportedFirstRunField = Object.keys(firstRun)
    .find((field) => field !== 'completed' && field !== 'completedAt');
  if (unsupportedFirstRunField) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_FIRST_RUN_INVALID',
      message: `Product-control record returned unsupported firstRun field: ${unsupportedFirstRunField}.`,
      actionHint: 'inspect_runtime_product_control_first_run',
    });
  }
  if (typeof firstRun.completed !== 'boolean') {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_FIRST_RUN_INVALID',
      message: 'Product-control record firstRun.completed must be boolean.',
      actionHint: 'inspect_runtime_product_control_first_run',
    });
  }
  const state = parseNimiProductControlState(record.state);
	const schemaVersion = Number(record.schemaVersion);
	const rootActivationId = dataRoot ? parseOptionalString(dataRoot.rootActivationId) : null;
	if (dataRoot && schemaVersion >= 2 && !rootActivationId) {
		throw productControlError({
			reasonCode: 'SDK_PRODUCT_CONTROL_ROOT_ACTIVATION_INVALID',
			message: 'Current product-control schema requires dataRoot.rootActivationId.',
			actionHint: 'initialize_product_control_root_activation',
		});
	}
  const completedAt = parseOptionalString(firstRun.completedAt);
  if (state === 'ready_for_use' && (!firstRun.completed || !completedAt)) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_FIRST_RUN_INVALID',
      message: 'A ready_for_use product-control record requires completed firstRun truth and completedAt.',
      actionHint: 'inspect_runtime_product_control_first_run',
    });
  }
  return {
    schemaVersion,
    installId: String(record.installId || ''),
    productVersion: String(record.productVersion || ''),
    state,
    dataRoot: dataRoot
      ? {
        path: String(dataRoot.path || ''),
        status: parseNimiProductDataRootStatus(dataRoot.status),
        rootActivationId,
        selectedAt: String(dataRoot.selectedAt || ''),
        verifiedAt: String(dataRoot.verifiedAt || ''),
        selectedAtUnixMs: Number(dataRoot.selectedAtUnixMs || 0),
        verifiedAtUnixMs: Number(dataRoot.verifiedAtUnixMs || 0),
      }
      : null,
    firstRun: {
      completed: firstRun.completed,
      completedAt,
    },
    pointers: {
      factoryProfileIndex: parseOptionalString(pointers.factoryProfileIndex),
    },
    repair: {
      required: repair.required === true,
      reason: parseOptionalString(repair.reason),
    },
  };
}

export function parseNimiProductControlRecordProjection(value: unknown): NimiProductControlRecordProjection {
  const record = asRecord(value, 'product_control_record_get');
  const configMutation = record.configMutation == null
    ? null
    : asRecord(record.configMutation, 'product control configMutation');
	const activation = record.activation == null
		? null
		: asRecord(record.activation, 'product control activation');
  if (configMutation && !(
    (configMutation.disposition === 'applied'
      && configMutation.reasonCode === ReasonCode.CONFIG_APPLIED
      && configMutation.actionHint === 'continue_product_setup')
    || (configMutation.disposition === 'restart_required'
      && configMutation.reasonCode === ReasonCode.CONFIG_RESTART_REQUIRED
      && configMutation.actionHint === 'request_typed_runtime_restart')
		|| (configMutation.disposition === 'repair_required'
			&& configMutation.reasonCode === 'CONFIG_WRITE_FAILED'
			&& configMutation.actionHint === 'repair_runtime_config')
  )) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_CONFIG_MUTATION_INVALID',
      message: 'Runtime product-control config mutation disposition is invalid.',
      actionHint: 'inspect_runtime_product_control_response',
    });
  }
	if (activation && !(
		typeof activation.activated === 'boolean'
		&& ['DATA_ROOT_REPLACED', 'DATA_ROOT_UNCHANGED', 'DATA_ROOT_OVERLAPS_CURRENT'].includes(String(activation.reasonCode))
		&& ['restart_runtime_and_check_sync', 'run_check_sync', 'choose_path_disjoint_root'].includes(String(activation.actionHint))
	)) {
		throw productControlError({
			reasonCode: 'SDK_PRODUCT_CONTROL_ACTIVATION_INVALID',
			message: 'Runtime product-control activation disposition is invalid.',
			actionHint: 'inspect_runtime_product_control_response',
		});
	}
  return {
    path: String(record.path || ''),
    exists: record.exists === true,
    state: parseNimiProductControlState(record.state),
    record: parseNimiProductControlRecord(record.record),
    error: parseOptionalString(record.error),
    configMutation: configMutation
      ? {
			disposition: configMutation.disposition as 'applied' | 'restart_required' | 'repair_required',
			reasonCode: configMutation.reasonCode as typeof ReasonCode.CONFIG_APPLIED | typeof ReasonCode.CONFIG_RESTART_REQUIRED | 'CONFIG_WRITE_FAILED',
			actionHint: configMutation.actionHint as 'continue_product_setup' | 'request_typed_runtime_restart' | 'repair_runtime_config',
      }
      : null,
		activation: activation
			? {
				activated: activation.activated as boolean,
				reasonCode: activation.reasonCode as 'DATA_ROOT_REPLACED' | 'DATA_ROOT_UNCHANGED' | 'DATA_ROOT_OVERLAPS_CURRENT',
				actionHint: activation.actionHint as 'restart_runtime_and_check_sync' | 'run_check_sync' | 'choose_path_disjoint_root',
			}
			: null,
  };
}

export function parseNimiProductControlProjectionJson(
  value: ProductControlProjectionJson | unknown,
): NimiProductControlRecordProjection {
  const envelope = asRecord(value, 'RuntimeLocalService.ProductControlProjectionJson');
  const raw = normalizeText(envelope.json);
  if (!raw) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_JSON_MISSING',
      message: 'Runtime product-control projection json is required.',
      actionHint: 'inspect_runtime_product_control_response',
    });
  }
  return parseNimiProductControlRecordProjection(JSON.parse(raw));
}

export function parseNimiProductControlSelectedDataRootProjection(
  value: unknown,
): NimiProductControlSelectedDataRootProjection {
  const record = asRecord(value, 'product_control_selected_data_root_get');
  const dataRoot = record.dataRoot == null ? null : asRecord(record.dataRoot, 'product control selected dataRoot');
  return {
    path: String(record.path || ''),
    exists: record.exists === true,
    state: parseNimiProductControlState(record.state),
    dataRoot: dataRoot
      ? {
        path: String(dataRoot.path || ''),
        status: parseNimiProductDataRootStatus(dataRoot.status),
        rootActivationId: parseOptionalString(dataRoot.rootActivationId),
        selectedAt: String(dataRoot.selectedAt || ''),
        verifiedAt: String(dataRoot.verifiedAt || ''),
        selectedAtUnixMs: Number(dataRoot.selectedAtUnixMs || 0),
        verifiedAtUnixMs: Number(dataRoot.verifiedAtUnixMs || 0),
      }
      : null,
    error: parseOptionalString(record.error),
  };
}

export function parseNimiProductControlSelectedDataRootProjectionJson(
  value: ProductControlProjectionJson | unknown,
): NimiProductControlSelectedDataRootProjection {
  const envelope = asRecord(value, 'RuntimeLocalService.ProductControlProjectionJson');
  const raw = normalizeText(envelope.json);
  if (!raw) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_DATA_ROOT_JSON_MISSING',
      message: 'Runtime product-control selected-data-root projection json is required.',
      actionHint: 'inspect_runtime_product_control_response',
    });
  }
  return parseNimiProductControlSelectedDataRootProjection(JSON.parse(raw));
}

export function projectUnavailableNimiProductControlRecord(
  error: string,
): NimiProductControlRecordProjection {
  return {
    path: '',
    exists: false,
    state: 'config_missing',
    record: null,
    error,
  };
}

export function projectUnavailableNimiProductControlSelectedDataRoot(
  error: string,
): NimiProductControlSelectedDataRootProjection {
  return {
    path: '',
    exists: false,
    state: 'config_missing',
    dataRoot: null,
    error,
  };
}

export function projectNimiProductControlStorageDirs(
  projection: NimiProductControlSelectedDataRootProjection,
): NimiProductControlStorageDirsProjection {
  const dataRoot = projection.dataRoot?.path?.trim() || '';
  if (!dataRoot) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_STORAGE_ROOT_MISSING',
      message: projection.error || 'Product-control storage dirs require a selected data root.',
      actionHint: 'select_product_control_data_root',
    });
  }
  return {
    dataRoot,
    modelsDir: joinProjectionPath(dataRoot, 'models'),
    dependenciesDir: joinProjectionPath(dataRoot, 'dependencies'),
    environmentsDir: joinProjectionPath(dataRoot, 'environments'),
    appsDir: joinProjectionPath(dataRoot, 'apps'),
    accountsDir: joinProjectionPath(dataRoot, 'accounts'),
    logsDir: joinProjectionPath(dataRoot, 'logs'),
    auditDir: joinProjectionPath(dataRoot, 'audit'),
  };
}

export function projectNimiProductControlFirstRunScreen(
  state: NimiProductControlState,
): NimiFirstRunScreen {
  switch (state) {
    case 'config_missing':
    case 'data_root_missing':
    case 'data_root_selected':
      return { kind: 'phase', phase: 'storage' };
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

export function isNimiProductControlTransientState(state: NimiProductControlState): boolean {
  return state === 'config_missing';
}

export function isNimiProductControlPhaseTransient(state: NimiProductControlState): boolean {
  return isNimiProductControlTransientState(state);
}

export function isNimiProductControlDegradedState(state: NimiProductControlState): boolean {
  return DEGRADED_PRODUCT_CONTROL_STATES.has(state);
}

export function isNimiProductControlRepairRoutedState(state: NimiProductControlState): boolean {
  return state === 'repair_required' || state === 'blocked';
}

export function projectNimiProductControlAdmission(
  state: NimiProductControlState,
): NimiProductControlAdmissionProjection {
  if (state === 'ready_for_use') {
    return { kind: 'ordinary-shell' };
  }
  if (state === 'not_logged_in') {
    return { kind: 'login' };
  }
  return { kind: 'first-run', state };
}
