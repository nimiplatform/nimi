import {
  createNimiElectronDesktopAccountHost,
  createNimiElectronDesktopControlHost,
  type NimiElectronDesktopAccountHost,
  type NimiElectronDesktopControlHost,
} from '@nimiplatform/kit/shell/electron/main';
import { verifyNimiFirstRunFactoryAiProfile } from '@nimiplatform/kit/shell/capabilities';
import { getRuntimeWireCodec } from '@nimiplatform/sdk/runtime/generated';
import {
  parseNimiProductControlRecordProjection,
  parseNimiProductControlSelectedDataRootProjection,
  type NimiProductControlRecord,
  type NimiProductControlRecordProjection,
} from '@nimiplatform/sdk/runtime';
import {
  createDesktopProductControlEvidence,
  type DesktopProductControlEvidence,
} from './product-control-evidence.js';

const DIRECT_COMMANDS = [
  'product_control_record_get',
  'product_control_selected_data_root_get',
  'product_control_record_ensure_created',
  'product_control_record_select_data_root',
  'product_control_record_complete_first_run_device_environment_scan',
  'product_control_record_set_first_run_install_level',
  'product_control_record_reconcile_first_run_setup_state',
] as const;

const EVIDENCE_COMMANDS = [
  'product_control_record_ensure_account_default_profile',
  'product_control_record_prepare_first_run_local_ai_ready',
  'product_control_record_admit_ready_for_use',
  'account_default_profile_for_scope_init',
  'built_in_ai_config_for_scope_init',
] as const;

const COMMANDS = [...DIRECT_COMMANDS, ...EVIDENCE_COMMANDS] as const;

// One First Run mint performs three bounded, real local executions after any
// required cold engine activation. The Runtime budgets those executions at
// 120s (text), 90s (STT), and 45s (TTS); the carrier deadline must bound the
// complete operation instead of expiring during the first cold start.
export const FIRST_RUN_LOCAL_AI_MINT_TIMEOUT_MS = 10 * 60_000;

const METHOD = {
  collectDeviceProfile: '/nimi.runtime.v1.RuntimeLocalService/CollectDeviceProfile',
  getRecord: '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
  getSelectedDataRoot: '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot',
  ensureRecord: '/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated',
  selectDataRoot: '/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot',
  completeDeviceScan: '/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan',
  setInstallLevel: '/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel',
  reconcileSetup: '/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState',
  resolveBaseline: '/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness',
  mintBaseline: '/nimi.runtime.v1.RuntimeLocalService/MintRuntimeBaselineReadiness',
  resolveExecution: '/nimi.runtime.v1.RuntimeLocalService/ResolveFirstRunExecutionEvidence',
  mintExecution: '/nimi.runtime.v1.RuntimeLocalService/MintFirstRunExecutionEvidence',
  recordAccount: '/nimi.runtime.v1.RuntimeLocalService/RecordProductControlAccountDefaultProfileEvidence',
  recordLocalAi: '/nimi.runtime.v1.RuntimeLocalService/RecordProductControlFirstRunLocalAiReadyEvidence',
  admitReady: '/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse',
} as const;

type ProductCommand = typeof COMMANDS[number];

export type DesktopProductControlTransport = Pick<
  NimiElectronDesktopControlHost,
  'machineProductUnary'
>;

export type DesktopElectronProductControlHost = {
  readonly commandHandlers: Readonly<Record<ProductCommand, (context: {
    readonly command: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }) => Promise<unknown>>>;
  /** Runtime-validated selected data root from the canonical Product Control record. */
  readonly resolveSelectedDataRoot: () => Promise<string>;
};

export function createDesktopElectronProductControlHost(input: {
  readonly control?: DesktopProductControlTransport;
  readonly account?: NimiElectronDesktopAccountHost;
  readonly evidence?: DesktopProductControlEvidence;
} = {}): DesktopElectronProductControlHost {
  const host = new ElectronProductControlHost(
    input.control ?? createNimiElectronDesktopControlHost(),
    input.account ?? createNimiElectronDesktopAccountHost(),
    input.evidence ?? createDesktopProductControlEvidence(),
  );
  return {
    commandHandlers: Object.fromEntries(COMMANDS.map((command) => [
      command,
      (context: { readonly command: string; readonly payload: Readonly<Record<string, unknown>> }) => (
        host.invoke(command, context.payload)
      ),
    ])) as DesktopElectronProductControlHost['commandHandlers'],
    resolveSelectedDataRoot: () => host.resolveSelectedDataRoot(),
  };
}
class ElectronProductControlHost {
  constructor(
    private readonly control: DesktopProductControlTransport,
    private readonly account: NimiElectronDesktopAccountHost,
    private readonly evidence: DesktopProductControlEvidence,
  ) {}

  async invoke(command: ProductCommand, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (command === 'product_control_record_get') {
      requireEmptyPayload(payload);
      return this.record();
    }
    if (command === 'product_control_selected_data_root_get') {
      requireEmptyPayload(payload);
      return this.selectedDataRoot();
    }
    if (command === 'product_control_record_ensure_created') {
      requireEmptyPayload(payload);
      return this.projection(METHOD.ensureRecord, {}, 10_000);
    }
    if (command === 'product_control_record_select_data_root') {
      const nested = exactPayload(payload, ['dataRoot']);
      return this.projection(METHOD.selectDataRoot, {
        dataRoot: payloadText(nested.dataRoot, 32_768),
      }, 30_000);
    }
    if (command === 'product_control_record_complete_first_run_device_environment_scan') {
      requireEmptyPayload(payload);
      return this.projection(METHOD.completeDeviceScan, {}, 10_000);
    }
    if (command === 'product_control_record_set_first_run_install_level') {
      const nested = exactPayloadWithOptional(payload, ['installLevel'], ['aiProfileAlias']);
      const installLevel = payloadText(nested.installLevel, 64);
      if (installLevel !== 'minimal' && installLevel !== 'recommended') {
        throw new Error('desktop-product-control-payload-invalid');
      }
      return this.projection(METHOD.setInstallLevel, {
        installLevel,
        aiProfileAlias: nested.aiProfileAlias == null
          ? ''
          : payloadText(nested.aiProfileAlias, 256),
      }, 10_000);
    }
    if (command === 'product_control_record_reconcile_first_run_setup_state') {
      requireEmptyPayload(payload);
      return this.projection(METHOD.reconcileSetup, {}, 10_000);
    }
    if (command === 'product_control_record_ensure_account_default_profile') {
      requireEmptyPayload(payload);
      return this.ensureAccountDefaultProfile();
    }
    if (command === 'product_control_record_prepare_first_run_local_ai_ready') {
      requireEmptyPayload(payload);
      return this.prepareLocalAiReady();
    }
    if (command === 'product_control_record_admit_ready_for_use') {
      requireEmptyPayload(payload);
      return this.admitReadyForUse();
    }
    if (command === 'account_default_profile_for_scope_init') {
      requireEmptyPayload(payload);
      return this.accountProfileForScopeInit();
    }
    const nested = exactPayload(payload, ['surfaceId']);
    const surfaceId = payloadText(nested.surfaceId, 64);
    if (surfaceId !== 'nimi' && surfaceId !== 'agent') throw new Error('built-in-ai-config-surface-invalid');
    return this.builtInAiConfigForScopeInit(surfaceId);
  }

  async resolveSelectedDataRoot(): Promise<string> {
    const projection = await this.selectedDataRoot();
    const selectedPath = String(projection.dataRoot?.path || '').trim();
    const status = String(projection.dataRoot?.status || '');
    if (
      !projection.exists
      || ['config_missing', 'data_root_missing', 'repair_required', 'blocked'].includes(projection.state)
      || !['selected', 'ready'].includes(status)
      || (projection.state === 'ready_for_use' && status !== 'ready')
      || !selectedPath
    ) {
      throw new Error('desktop-product-control-selected-data-root-unavailable');
    }
    return selectedPath;
  }

  private async ensureAccountDefaultProfile(): Promise<NimiProductControlRecordProjection> {
    const projection = await this.record();
    const record = requireRecord(projection, 'Account Default Profile');
    const firstRun = requireFirstRun(record);
    const dataRoot = requireDataRoot(record);
    const accountId = await this.authenticatedAccountId();
    const installLevel = requireInstallLevel(firstRun);
    const alias = requireAiProfileAlias(firstRun);
    verifyNimiFirstRunFactoryAiProfile(alias, installLevel);
    const evidence = this.evidence.ensureAccountDefaultProfile({
      dataRoot,
      accountId,
      aiProfileAlias: alias,
      installLevel,
    });
    return this.projection(METHOD.recordAccount, {
      accountDefaultProfileEvidenceJson: JSON.stringify(evidence),
    }, 10_000);
  }

  private async prepareLocalAiReady(): Promise<NimiProductControlRecordProjection> {
    await this.ensureAccountDefaultProfile();
    const record = requireRecord(await this.record(), 'local AI finalization');
    const firstRun = requireFirstRun(record);
    const dataRoot = requireDataRoot(record);
    const accountId = await this.authenticatedAccountId();
    const installLevel = requireInstallLevel(firstRun);
    const alias = requireAiProfileAlias(firstRun);
    const factory = verifyNimiFirstRunFactoryAiProfile(alias, installLevel);
    const profileResponse = asRecord(await this.unary(METHOD.collectDeviceProfile, { extraPorts: [] }, 10_000));
    const hostProfile = asRecord(profileResponse.profile);
    const selectedFactoryRef = `aiprofile/nimi.first-run.local-factory.${installLevel}@1`;

    const baseline = await this.resolveOrMintBaseline({
      existingRef: optionalText(firstRun.runtimeBaselineRef),
      selectedFactoryRef,
      installLevel,
      dataRoot,
      hostProfile,
    });
    const runtimeBaselineRef = boundedText(baseline.runtimeBaselineRef);
    const execution = await this.resolveOrMintExecution({
      existingRef: optionalText(firstRun.executionEvidenceRef),
      runtimeBaselineRef,
      selectedFactoryRef,
      installLevel,
      dataRoot,
      hostProfile,
      recommendedCapabilities: installLevel === 'recommended'
        ? factory.capabilitySet.filter((capability) => ![
          'text.generate', 'audio.transcribe', 'audio.synthesize',
        ].includes(capability))
        : [],
    });
    const executionEvidenceRef = boundedText(execution.executionEvidenceRef);
    const builtInEvidence = this.evidence.ensureBuiltInAiConfigEvidenceSet({
      dataRoot,
      accountId,
      aiProfileAlias: alias,
      installLevel,
      executionEvidence: execution,
    });
    return this.projection(METHOD.recordLocalAi, {
      runtimeBaselineRef,
      builtInAiConfigEvidenceJson: JSON.stringify(builtInEvidence),
      executionEvidenceRef,
    }, 30_000);
  }

  private async accountProfileForScopeInit(): Promise<unknown> {
    const record = requireRecord(await this.record(), 'Account Default Profile scope init');
    return this.evidence.readAccountDefaultProfile({
      dataRoot: requireDataRoot(record),
      accountId: await this.authenticatedAccountId(),
    });
  }

  private async builtInAiConfigForScopeInit(surfaceId: 'nimi' | 'agent'): Promise<unknown> {
    const record = requireRecord(await this.record(), 'built-in AIConfig scope init');
    const firstRun = requireFirstRun(record);
    const dataRoot = requireDataRoot(record);
    const installLevel = requireInstallLevel(firstRun);
    const execution = await this.resolveExecution(record, dataRoot, installLevel);
    try {
      return this.evidence.readBuiltInAiConfigForScopeInit({
        dataRoot,
        accountId: await this.authenticatedAccountId(),
        aiProfileAlias: requireAiProfileAlias(firstRun),
        installLevel,
        executionEvidence: execution,
        surfaceId,
        builtInAiConfigRefs: firstRun.builtInAiConfigRefs,
      });
    } catch {
      await this.prepareLocalAiReady();
      const refreshed = requireRecord(await this.record(), 'built-in AIConfig scope init repair');
      const refreshedFirstRun = requireFirstRun(refreshed);
      const refreshedExecution = await this.resolveExecution(refreshed, requireDataRoot(refreshed), requireInstallLevel(refreshedFirstRun));
      return this.evidence.readBuiltInAiConfigForScopeInit({
        dataRoot: requireDataRoot(refreshed),
        accountId: await this.authenticatedAccountId(),
        aiProfileAlias: requireAiProfileAlias(refreshedFirstRun),
        installLevel: requireInstallLevel(refreshedFirstRun),
        executionEvidence: refreshedExecution,
        surfaceId,
        builtInAiConfigRefs: refreshedFirstRun.builtInAiConfigRefs,
      });
    }
  }

  private async admitReadyForUse(): Promise<NimiProductControlRecordProjection> {
    const record = requireRecord(await this.record(), 'ready admission');
    const firstRun = requireFirstRun(record);
    const dataRoot = requireDataRoot(record);
    const accountId = await this.authenticatedAccountId();
    const installLevel = requireInstallLevel(firstRun);
    const alias = requireAiProfileAlias(firstRun);
    const accountDefaultProfileRef = requiredText(firstRun.accountDefaultProfileRef, 'accountDefaultProfileRef');
    const execution = await this.resolveExecution(record, dataRoot, installLevel);
    const accountEvidence = this.evidence.verifyAccountDefaultProfile({
      dataRoot,
      accountId,
      accountDefaultProfileRef,
    });
    const builtInEvidence = this.evidence.verifyBuiltInAiConfigEvidenceSet({
      dataRoot,
      accountId,
      aiProfileAlias: alias,
      installLevel,
      executionEvidence: execution,
      builtInAiConfigRefs: firstRun.builtInAiConfigRefs,
    });
    return this.projection(METHOD.admitReady, {
      accountDefaultProfileEvidenceJson: JSON.stringify(accountEvidence),
      builtInAiConfigEvidenceJson: JSON.stringify(builtInEvidence),
    }, 30_000);
  }

  private async resolveOrMintBaseline(input: {
    readonly existingRef: string;
    readonly selectedFactoryRef: string;
    readonly installLevel: string;
    readonly dataRoot: string;
    readonly hostProfile: Readonly<Record<string, unknown>>;
  }): Promise<Record<string, unknown>> {
    if (input.existingRef) {
      const response = asRecord(await this.unary(METHOD.resolveBaseline, {
        runtimeBaselineRef: input.existingRef,
        hostProfile: input.hostProfile,
      }, 60_000));
      if (response.state === 'ready') return asRecord(response.ref);
      if (![
        'RUNTIME_BASELINE_READINESS_REF_UNKNOWN',
        'RUNTIME_BASELINE_READINESS_REF_BINDING_MISMATCH',
      ].includes(String(response.reasonCode))) {
        throw new Error(formatRuntimeReadinessFailure('runtime-baseline-not-ready', response));
      }
    }
    const response = asRecord(await this.unary(METHOD.mintBaseline, {
      selectedLocalFactoryAiProfileRef: input.selectedFactoryRef,
      installLevel: input.installLevel,
      runtimeDataRootOrDataRootRef: input.dataRoot,
      hostProfile: input.hostProfile,
      baselineConsumers: [],
    }, 60_000));
    if (response.state !== 'ready') {
      throw new Error(formatRuntimeReadinessFailure('runtime-baseline-not-ready', response));
    }
    return asRecord(response.ref);
  }

  private async resolveOrMintExecution(input: {
    readonly existingRef: string;
    readonly runtimeBaselineRef: string;
    readonly selectedFactoryRef: string;
    readonly installLevel: string;
    readonly dataRoot: string;
    readonly hostProfile: Readonly<Record<string, unknown>>;
    readonly recommendedCapabilities: readonly string[];
  }): Promise<Record<string, unknown>> {
    if (input.existingRef) {
      const response = asRecord(await this.unary(METHOD.resolveExecution, {
        executionEvidenceRef: input.existingRef,
        expectedRuntimeBaselineRef: input.runtimeBaselineRef,
        expectedDataRootRef: input.dataRoot,
        expectedInstallLevel: input.installLevel,
        hostProfile: input.hostProfile,
      }, 60_000));
      if (response.state === 'local_ai_ready') return asRecord(response.ref);
      if (![
        'FIRST_RUN_EXECUTION_EVIDENCE_REF_UNKNOWN',
        'FIRST_RUN_EXECUTION_EVIDENCE_REF_BINDING_MISMATCH',
        'FIRST_RUN_EXECUTION_EVIDENCE_BASELINE_NOT_READY',
      ].includes(String(response.reasonCode))) {
        throw new Error(formatRuntimeReadinessFailure('first-run-execution-not-ready', response));
      }
    }
    const response = asRecord(await this.unary(METHOD.mintExecution, {
      runtimeBaselineRef: input.runtimeBaselineRef,
      selectedLocalFactoryAiProfileRef: input.selectedFactoryRef,
      installLevel: input.installLevel,
      dataRootRef: input.dataRoot,
      hostProfile: input.hostProfile,
      recommendedCapabilities: input.recommendedCapabilities,
      submitSchedulingEvaluated: false,
    }, FIRST_RUN_LOCAL_AI_MINT_TIMEOUT_MS));
    if (response.state !== 'local_ai_ready') {
      throw new Error(formatRuntimeReadinessFailure('first-run-execution-not-ready', response));
    }
    return asRecord(response.ref);
  }

  private async resolveExecution(
    record: NimiProductControlRecord,
    dataRoot: string,
    installLevel: string,
  ): Promise<Record<string, unknown>> {
    const firstRun = requireFirstRun(record);
    const response = asRecord(await this.unary(METHOD.resolveExecution, {
      executionEvidenceRef: requiredText(firstRun.executionEvidenceRef, 'executionEvidenceRef'),
      expectedRuntimeBaselineRef: requiredText(firstRun.runtimeBaselineRef, 'runtimeBaselineRef'),
      expectedDataRootRef: dataRoot,
      expectedInstallLevel: installLevel,
    }, 60_000));
    if (response.state !== 'local_ai_ready') {
      throw new Error(formatRuntimeReadinessFailure('first-run-execution-not-ready', response));
    }
    return asRecord(response.ref);
  }

  private async authenticatedAccountId(): Promise<string> {
    const response = asRecord(await this.account.invoke('runtime_account_session_status', {}));
    if (response.state !== 'authenticated') throw new Error('authenticated-runtime-account-required');
    return boundedText(asRecord(response.accountProjection).accountId);
  }

  private async record(): Promise<NimiProductControlRecordProjection> {
    return this.projection(METHOD.getRecord, {}, 10_000);
  }

  private async selectedDataRoot() {
    const response = asRecord(await this.unary(METHOD.getSelectedDataRoot, {}, 10_000));
    const json = boundedText(response.json, 2_000_000);
    return parseNimiProductControlSelectedDataRootProjection(JSON.parse(json) as unknown);
  }

  private async projection(methodId: string, request: Readonly<Record<string, unknown>>, timeoutMs: number) {
    const response = asRecord(await this.unary(methodId, request, timeoutMs));
    const json = boundedText(response.json, 2_000_000);
    return parseNimiProductControlRecordProjection(JSON.parse(json) as unknown);
  }

  private async unary(methodId: string, request: Readonly<Record<string, unknown>>, timeoutMs: number): Promise<unknown> {
    const codec = getRuntimeWireCodec(methodId);
    const response = await this.control.machineProductUnary({
      methodId,
      requestBytes: codec.encodeRequest(request),
      timeoutMs,
    });
    return codec.decodeResponse(response);
  }
}

function requireRecord(projection: NimiProductControlRecordProjection, action: string): NimiProductControlRecord {
  const record = projection.record;
  if (
    !projection.exists
    || projection.error
    || !record
    || ['config_missing', 'data_root_missing', 'repair_required', 'blocked'].includes(projection.state)
    || ['repair_required', 'blocked'].includes(record.state)
    || record.repair.required
  ) {
    throw new Error(`desktop-product-control-projection-unusable:${action}`);
  }
  return record;
}

function requireFirstRun(record: NimiProductControlRecord): NimiProductControlRecord['firstRun'] {
  if (!record.firstRun || !Array.isArray(record.firstRun.builtInAiConfigRefs)) {
    throw new Error('product-control-first-run-invalid');
  }
  return record.firstRun;
}

function requireDataRoot(record: NimiProductControlRecord): string {
  if (
    !record.dataRoot
    || !['selected', 'ready'].includes(record.dataRoot.status)
    || ['repair_required', 'blocked'].includes(record.state)
    || record.repair.required
  ) {
    throw new Error('desktop-product-control-projection-unusable:dataRoot');
  }
  return requiredText(record.dataRoot?.path, 'selected nimi_data');
}

function requireInstallLevel(firstRun: NimiProductControlRecord['firstRun']): 'minimal' | 'recommended' {
  if (firstRun.installLevel !== 'minimal' && firstRun.installLevel !== 'recommended') {
    throw new Error('first-run-install-level-required');
  }
  return firstRun.installLevel;
}

function requireAiProfileAlias(firstRun: NimiProductControlRecord['firstRun']): string {
  return requiredText(firstRun.aiProfileAlias, 'aiProfileAlias');
}

function requiredText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (!text) throw new Error(`${label}-required`);
  return text;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function formatRuntimeReadinessFailure(
  prefix: string,
  response: Readonly<Record<string, unknown>>,
): string {
  const reason = boundedText(response.reasonCode);
  const detail = typeof response.detail === 'string'
    ? response.detail.trim().slice(0, 4_096)
    : '';
  return detail ? `${prefix}:${reason}: ${detail}` : `${prefix}:${reason}`;
}

function boundedText(value: unknown, max = 16_384): string {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > max) {
    throw new Error('runtime-product-control-response-invalid');
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('runtime-product-control-response-invalid');
  }
  return value as Record<string, unknown>;
}

function requireEmptyPayload(payload: Readonly<Record<string, unknown>>): void {
  if (Object.keys(payload).length !== 0) throw new Error('desktop-product-control-payload-invalid');
}

function exactPayload(payload: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, unknown> {
  return exactPayloadWithOptional(payload, keys, []);
}

function exactPayloadWithOptional(
  payload: Readonly<Record<string, unknown>>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): Record<string, unknown> {
  if (Object.keys(payload).join('|') !== 'payload') throw new Error('desktop-product-control-payload-invalid');
  const nested = asRecord(payload.payload);
  const actualKeys = Object.keys(nested).sort();
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  if (requiredKeys.some((key) => !actualKeys.includes(key))
    || actualKeys.some((key) => !allowedKeys.has(key))) {
    throw new Error('desktop-product-control-payload-invalid');
  }
  return nested;
}

function payloadText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > max) {
    throw new Error('desktop-product-control-payload-invalid');
  }
  return value;
}
