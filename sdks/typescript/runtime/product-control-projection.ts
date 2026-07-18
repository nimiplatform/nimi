import {
  RoutePolicy,
  ScenarioType,
  type ProductControlProjectionJson,
} from '../core-generated/runtime-typed-client';
import type { NimiAIConfigTargetRef } from '../core/ai';
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

export type NimiFirstRunExecutionCapabilityProof = {
  readonly capability: string;
  readonly scenarioType: ScenarioType;
  readonly boundConsumerId: string;
  readonly boundAssetId: string;
  readonly localRouteTarget: string;
  readonly routePolicy: RoutePolicy;
  readonly modelResolved: string;
  readonly terminalResult: string;
  readonly traceId: string;
};

export interface NimiFirstRunExecutionEvidenceForAIConfig {
  readonly executionEvidenceRef: string;
  readonly runtimeBaselineRef: string;
  readonly terminalResult: string;
  readonly selectedBaselineCapabilityProof: readonly NimiFirstRunExecutionCapabilityProof[];
}

export type NimiFirstRunAIConfigCapability =
  | 'text.generate'
  | 'audio.transcribe'
  | 'audio.synthesize';

export interface NimiFirstRunExecutionAIConfigCapabilityTarget {
  readonly capability: NimiFirstRunAIConfigCapability;
  readonly targetRef: Extract<NimiAIConfigTargetRef, { readonly kind: 'local-runtime' }>;
  readonly runtime: {
    readonly executionEvidenceRef: string;
    readonly runtimeBaselineRef: string;
    readonly boundConsumerId: string;
    readonly boundAssetId: string;
    readonly localRouteTarget: string;
    readonly modelResolved: string;
    readonly traceId: string;
  };
}

const PRODUCT_CONTROL_STATE_SET = new Set<string>(NIMI_PRODUCT_CONTROL_STATES);
const PRODUCT_DATA_ROOT_STATUS_SET = new Set<string>(NIMI_PRODUCT_DATA_ROOT_STATUSES);
const DEGRADED_PRODUCT_CONTROL_STATES = new Set<NimiProductControlState>(
  NIMI_PRODUCT_CONTROL_STATES.filter((state) => state !== 'ready_for_use'),
);
const FIRST_RUN_EXECUTION_TERMINAL_READY = 'local_ai_ready';
const FIRST_RUN_CAPABILITY_TERMINAL_EXECUTED = 'local_executed';
const FIRST_RUN_BUILT_IN_AI_CONFIG_CAPABILITY_FLOOR: readonly NimiFirstRunAIConfigCapability[] = [
  'audio.synthesize',
  'audio.transcribe',
  'text.generate',
];

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

function dirnameProjectionPath(path: string): string {
  const normalized = trimTrailingSeparator(path.trim());
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return index > 0 ? normalized.slice(0, index) : '';
}

function requireNimiRuntimeProofString(value: unknown, field: string, capability?: string): string {
  const trimmed = normalizeText(value);
  if (!trimmed) {
    throw productControlError({
      reasonCode: 'SDK_FIRST_RUN_EXECUTION_EVIDENCE_INVALID',
      message: capability
        ? `Runtime execution proof for ${capability} is missing ${field}.`
        : `Runtime execution evidence is missing ${field}.`,
      actionHint: 'repair_first_run_execution_evidence',
    });
  }
  return trimmed;
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
  const installLevelRaw = parseOptionalString(firstRun.installLevel);
  const installLevel = installLevelRaw as 'minimal' | 'recommended' | null;
  if (installLevelRaw && installLevelRaw !== 'minimal' && installLevelRaw !== 'recommended') {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_INSTALL_LEVEL_INVALID',
      message: `Product-control record returned invalid install level: ${installLevelRaw}.`,
      actionHint: 'inspect_runtime_product_control_first_run',
    });
  }
  return {
    schemaVersion: Number(record.schemaVersion),
    installId: String(record.installId || ''),
    productVersion: String(record.productVersion || ''),
    state: parseNimiProductControlState(record.state),
    dataRoot: dataRoot
      ? {
        path: String(dataRoot.path || ''),
        status: parseNimiProductDataRootStatus(dataRoot.status),
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

export function parseNimiProductControlRecordProjection(value: unknown): NimiProductControlRecordProjection {
  const record = asRecord(value, 'product_control_record_get');
  const proposal = record.dataRootProposal == null
    ? null
    : asRecord(record.dataRootProposal, 'product control dataRootProposal');
  if (proposal && (
    normalizeText(proposal.path).length === 0
    || proposal.authority !== 'runtime_protected_product_control'
    || proposal.profile !== 'dev_kernel_checkpoint'
  )) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_DATA_ROOT_PROPOSAL_INVALID',
      message: 'Runtime product-control data-root proposal is invalid.',
      actionHint: 'inspect_runtime_product_control_response',
    });
  }
  const configMutation = record.configMutation == null
    ? null
    : asRecord(record.configMutation, 'product control configMutation');
  if (configMutation && !(
    (configMutation.disposition === 'applied'
      && configMutation.reasonCode === ReasonCode.CONFIG_APPLIED
      && configMutation.actionHint === 'continue_product_setup')
    || (configMutation.disposition === 'restart_required'
      && configMutation.reasonCode === ReasonCode.CONFIG_RESTART_REQUIRED
      && configMutation.actionHint === 'request_typed_runtime_restart')
  )) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_CONFIG_MUTATION_INVALID',
      message: 'Runtime product-control config mutation disposition is invalid.',
      actionHint: 'inspect_runtime_product_control_response',
    });
  }
  return {
    path: String(record.path || ''),
    exists: record.exists === true,
    state: parseNimiProductControlState(record.state),
    record: parseNimiProductControlRecord(record.record),
    dataRootProposal: proposal
      ? {
        path: normalizeText(proposal.path),
        authority: 'runtime_protected_product_control',
        profile: 'dev_kernel_checkpoint',
      }
      : null,
    error: parseOptionalString(record.error),
    configMutation: configMutation
      ? {
        disposition: configMutation.disposition as 'applied' | 'restart_required',
        reasonCode: configMutation.reasonCode as typeof ReasonCode.CONFIG_APPLIED | typeof ReasonCode.CONFIG_RESTART_REQUIRED,
        actionHint: configMutation.actionHint as 'continue_product_setup' | 'request_typed_runtime_restart',
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
    dataRootProposal: null,
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
  const nimiDir = dirnameProjectionPath(projection.path || '');
  const dataRoot = projection.dataRoot?.path?.trim() || '';
  if (!nimiDir || !dataRoot) {
    throw productControlError({
      reasonCode: 'SDK_PRODUCT_CONTROL_STORAGE_ROOT_MISSING',
      message: projection.error || 'Product-control storage dirs require a selected data root.',
      actionHint: 'select_product_control_data_root',
    });
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

export function projectNimiProductControlFirstRunScreen(
  state: NimiProductControlState,
): NimiFirstRunScreen {
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

function aiConfigCapabilityForExecutionScenario(
  scenarioType: ScenarioType,
): NimiFirstRunAIConfigCapability {
  switch (scenarioType) {
    case ScenarioType.TEXT_GENERATE:
      return 'text.generate';
    case ScenarioType.SPEECH_TRANSCRIBE:
      return 'audio.transcribe';
    case ScenarioType.SPEECH_SYNTHESIZE:
      return 'audio.synthesize';
    default:
      throw productControlError({
        reasonCode: 'SDK_FIRST_RUN_EXECUTION_SCENARIO_UNSUPPORTED',
        message: `Runtime execution proof scenario ${ScenarioType[scenarioType] || scenarioType} is not admitted for first-run built-in AIConfig.`,
        actionHint: 'provide_admitted_first_run_execution_scenarios',
      });
  }
}

export function projectNimiFirstRunExecutionEvidenceToAIConfigTargets(
  evidence: NimiFirstRunExecutionEvidenceForAIConfig,
): NimiFirstRunExecutionAIConfigCapabilityTarget[] {
  const executionEvidenceRef = requireNimiRuntimeProofString(
    evidence.executionEvidenceRef,
    'executionEvidenceRef',
  );
  const runtimeBaselineRef = requireNimiRuntimeProofString(
    evidence.runtimeBaselineRef,
    'runtimeBaselineRef',
  );
  if (normalizeText(evidence.terminalResult) !== FIRST_RUN_EXECUTION_TERMINAL_READY) {
    throw productControlError({
      reasonCode: 'SDK_FIRST_RUN_EXECUTION_TERMINAL_NOT_READY',
      message: 'Runtime execution evidence terminalResult is not local_ai_ready.',
      actionHint: 'complete_first_run_runtime_execution_evidence',
    });
  }

  const seen = new Set<NimiFirstRunAIConfigCapability>();
  const missing = new Set(FIRST_RUN_BUILT_IN_AI_CONFIG_CAPABILITY_FLOOR);
  const targets: NimiFirstRunExecutionAIConfigCapabilityTarget[] = [];
  for (const proof of evidence.selectedBaselineCapabilityProof || []) {
    if (proof.routePolicy !== RoutePolicy.LOCAL) {
      throw productControlError({
        reasonCode: 'SDK_FIRST_RUN_EXECUTION_ROUTE_NOT_LOCAL',
        message: `Runtime execution proof for ${normalizeText(proof.capability)} is not a local route.`,
        actionHint: 'provide_local_first_run_execution_evidence',
      });
    }
    if (normalizeText(proof.terminalResult) !== FIRST_RUN_CAPABILITY_TERMINAL_EXECUTED) {
      throw productControlError({
        reasonCode: 'SDK_FIRST_RUN_EXECUTION_CAPABILITY_NOT_EXECUTED',
        message: `Runtime execution proof for ${normalizeText(proof.capability)} was not locally executed.`,
        actionHint: 'complete_first_run_runtime_execution_evidence',
      });
    }
    const capability = aiConfigCapabilityForExecutionScenario(proof.scenarioType);
    if (seen.has(capability)) {
      throw productControlError({
        reasonCode: 'SDK_FIRST_RUN_EXECUTION_CAPABILITY_DUPLICATE',
        message: `Runtime execution proof contains duplicate AIConfig capability ${capability}.`,
        actionHint: 'deduplicate_first_run_execution_evidence',
      });
    }
    seen.add(capability);
    missing.delete(capability);

    const boundAssetId = requireNimiRuntimeProofString(proof.boundAssetId, 'boundAssetId', capability);
    const boundConsumerId = requireNimiRuntimeProofString(proof.boundConsumerId, 'boundConsumerId', capability);
    const localRouteTarget = requireNimiRuntimeProofString(proof.localRouteTarget, 'localRouteTarget', capability);
    const modelResolved = normalizeText(proof.modelResolved) || boundAssetId;
    const traceId = normalizeText(proof.traceId);
    targets.push({
      capability,
      targetRef: {
        kind: 'local-runtime',
        version: 'v2',
        readinessRef: executionEvidenceRef,
      },
      runtime: {
        executionEvidenceRef,
        runtimeBaselineRef,
        boundConsumerId,
        boundAssetId,
        localRouteTarget,
        modelResolved,
        traceId,
      },
    });
  }

  if (missing.size > 0) {
    throw productControlError({
      reasonCode: 'SDK_FIRST_RUN_EXECUTION_CAPABILITY_INCOMPLETE',
      message: `Runtime execution proof is incomplete for first-run built-in AIConfig: missing ${[...missing].join(',')}.`,
      actionHint: 'complete_first_run_runtime_execution_evidence',
    });
  }
  return targets.sort((a, b) => a.capability.localeCompare(b.capability));
}
