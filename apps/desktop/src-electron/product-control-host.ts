import path from 'node:path';
import {
  createNimiElectronDesktopControlHost,
  type NimiElectronDesktopControlHost,
} from '@nimiplatform/kit/shell/electron/main';
import { getRuntimeWireCodec } from '@nimiplatform/sdk/runtime/generated';
import {
  parseNimiProductControlRecordProjection,
  parseNimiProductControlSelectedDataRootProjection,
  type NimiProductControlRecordProjection,
} from '@nimiplatform/sdk/runtime';
import {
  createDesktopDataRootOperationGate,
  type DesktopDataRootOperationGate,
} from './data-root-operation-gate.js';
const DIRECT_COMMANDS = [
  'product_control_record_get',
  'product_control_selected_data_root_get',
  'product_control_record_ensure_created',
  'product_control_record_select_data_root',
  'product_control_root_activation_initialize',
  'product_control_data_root_replace',
  'product_control_check_sync_start',
  'product_control_check_sync_get',
  'product_control_record_admit_ready_for_use',
] as const;

const COMMANDS = DIRECT_COMMANDS;

const METHOD = {
  getRecord: '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
  getSelectedDataRoot: '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot',
  ensureRecord: '/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated',
  selectDataRoot: '/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot',
  initializeRootActivation: '/nimi.runtime.v1.RuntimeLocalService/InitializeProductControlRootActivation',
  replaceDataRoot: '/nimi.runtime.v1.RuntimeLocalService/ReplaceProductControlDataRoot',
  startCheckSync: '/nimi.runtime.v1.RuntimeLocalService/StartProductControlCheckSync',
  getCheckSync: '/nimi.runtime.v1.RuntimeLocalService/GetProductControlCheckSync',
  admitReady: '/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse',
} as const;

type ProductCommand = typeof COMMANDS[number];

type ProductControlHostActivation = {
  readonly activated: boolean;
  readonly reasonCode: 'DATA_ROOT_REPLACED' | 'DATA_ROOT_UNCHANGED' | 'DATA_ROOT_OVERLAPS_CURRENT';
  readonly actionHint: 'restart_runtime_and_check_sync' | 'run_check_sync' | 'choose_path_disjoint_root';
};

type ProductControlHostProjection = Omit<NimiProductControlRecordProjection, 'record' | 'configMutation'> & {
  readonly record: null | (NonNullable<NimiProductControlRecordProjection['record']> & {
    readonly dataRoot: null | (NonNullable<NonNullable<NimiProductControlRecordProjection['record']>['dataRoot']> & {
      readonly rootActivationId: string | null;
    });
  });
  readonly configMutation?: null | {
    readonly disposition: 'applied' | 'restart_required' | 'repair_required';
    readonly reasonCode: string;
    readonly actionHint: string;
  };
  readonly activation?: ProductControlHostActivation | null;
  readonly rootHandoff?: null | {
    readonly disposition: 'active_current_process' | 'activation_not_bound' | 'committed_restart_required' | 'committed_repair_required';
    readonly rootActivationId: string;
    readonly actionHint: 'continue' | 'restart_runtime_and_check_sync' | 'repair_runtime_config';
  };
};

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
  /** Runtime-validated data root after Product Control has reached ready_for_use. */
  readonly resolveReadyDataRoot: () => Promise<string>;
  /** Canonical selected root retained for Support diagnostics in repair/blocked states. */
  readonly resolveSupportDataRoot: () => Promise<string>;
  readonly bootstrapDataRootHandoff: () => Promise<void>;
  readonly recoverDataRootHandoff: () => Promise<unknown>;
};

type PendingDataRootHandoff = {
  readonly beforeActivationId: string | null;
  readonly beforePath: string | null;
  readonly targetPath: string;
  readonly committedActivationId: string | null;
  readonly disposition: 'ambiguous' | 'committed';
};

export type DesktopCheckSyncResourceResult = {
  readonly kind: string;
  readonly reference?: string;
  readonly locator?: string;
  readonly status: 'available' | 'unavailable' | 'incompatible' | 'unknown' | 'conflict' | 'failed';
  readonly change?: 'rebased' | 'adopted' | 'rebuilt';
  readonly reason: string;
  readonly nextAction?: 'rerun_check_sync';
};

export type DesktopCheckSyncProjection = {
  readonly run: null | {
    readonly runId: string;
    readonly rootActivationId: string;
    readonly trigger: 'activation' | 'manual' | 'interrupted_recovery';
    readonly state: 'running' | 'completed' | 'failed' | 'superseded';
    readonly startedAt: string;
    readonly completedAt?: string;
    readonly owners: readonly {
      readonly ownerId: string;
      readonly state: 'pending' | 'running' | 'completed' | 'failed';
      readonly resources: readonly DesktopCheckSyncResourceResult[];
    }[];
    readonly unclaimed: readonly { readonly locator: string; readonly status: 'unknown'; readonly reason: string }[];
  };
  readonly obligation: null | { readonly rootActivationId: string; readonly state: 'required' | 'completed' };
  readonly error: string | null;
};

export function createDesktopElectronProductControlHost(input: {
  readonly control?: DesktopProductControlTransport;
  readonly operationGate?: DesktopDataRootOperationGate;
  readonly runtimeLifecycleProfile?: 'source' | 'fixed';
  readonly restartRuntime?: () => Promise<unknown>;
  readonly quiesceHostDataRoot?: () => Promise<void>;
  readonly abortHostDataRoot?: () => void;
  readonly commitHostDataRoot?: () => void;
  readonly activateHostDataRoot?: () => void;
} = {}): DesktopElectronProductControlHost {
  const host = new ElectronProductControlHost(
    input.control ?? createNimiElectronDesktopControlHost(),
    input.operationGate ?? createDesktopDataRootOperationGate(),
    input.runtimeLifecycleProfile ?? 'source',
    input.restartRuntime ?? (async () => { throw new Error('desktop-product-control-runtime-restart-unavailable'); }),
    input.quiesceHostDataRoot ?? (async () => undefined),
    input.abortHostDataRoot ?? (() => undefined),
    input.commitHostDataRoot ?? (() => undefined),
    input.activateHostDataRoot ?? (() => undefined),
  );
  return {
    commandHandlers: Object.fromEntries(COMMANDS.map((command) => [
      command,
      (context: { readonly command: string; readonly payload: Readonly<Record<string, unknown>> }) => (
        host.invoke(command, context.payload)
      ),
    ])) as DesktopElectronProductControlHost['commandHandlers'],
    resolveSelectedDataRoot: () => host.resolveSelectedDataRoot(),
    resolveReadyDataRoot: () => host.resolveReadyDataRoot(),
    resolveSupportDataRoot: () => host.resolveSupportDataRoot(),
    bootstrapDataRootHandoff: () => host.bootstrapDataRootHandoff(),
    recoverDataRootHandoff: () => host.recoverDataRootHandoff(),
  };
}
class ElectronProductControlHost {
  private pendingHandoff: PendingDataRootHandoff | null = null;

  constructor(
    private readonly control: DesktopProductControlTransport,
    private readonly operationGate: DesktopDataRootOperationGate,
    private readonly runtimeLifecycleProfile: 'source' | 'fixed',
    private readonly restartRuntime: () => Promise<unknown>,
    private readonly quiesceHostDataRoot: () => Promise<void>,
    private readonly abortHostDataRoot: () => void,
    private readonly commitHostDataRoot: () => void,
    private readonly activateHostDataRoot: () => void,
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
    if (command === 'product_control_root_activation_initialize') {
      requireEmptyPayload(payload);
      return this.projection(METHOD.initializeRootActivation, {}, 10_000);
    }
    if (command === 'product_control_data_root_replace') {
      const nested = exactPayload(payload, ['targetRoot']);
      return this.replaceDataRoot(payloadText(nested.targetRoot, 32_768));
    }
    if (command === 'product_control_check_sync_start') {
      requireEmptyPayload(payload);
      if (this.operationGate.isClosed()) {
        await this.recoverDataRootHandoff();
      }
      return this.operationGate.runExclusive(() => this.checkSyncProjection(METHOD.startCheckSync, 10_000));
    }
    if (command === 'product_control_check_sync_get') {
      requireEmptyPayload(payload);
      return this.checkSyncProjection(METHOD.getCheckSync, 10_000);
    }
    if (command === 'product_control_record_admit_ready_for_use') {
      requireEmptyPayload(payload);
      return this.projection(METHOD.admitReady, {}, 30_000);
    }
    throw new Error('desktop-product-control-command-unadmitted');
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

  async resolveReadyDataRoot(): Promise<string> {
    const projection = await this.selectedDataRoot();
    const selectedPath = String(projection.dataRoot?.path || '').trim();
    if (
      !projection.exists
      || projection.state !== 'ready_for_use'
      || projection.dataRoot?.status !== 'ready'
      || !selectedPath
    ) {
      throw new Error('desktop-product-control-data-root-not-ready');
    }
    return selectedPath;
  }

  async resolveSupportDataRoot(): Promise<string> {
    const projection = await this.selectedDataRoot();
    const selectedPath = String(projection.dataRoot?.path || '').trim();
    if (
      !projection.exists
      || !selectedPath
      || !['selected', 'ready', 'repair_required'].includes(String(projection.dataRoot?.status || ''))
    ) {
      throw new Error('desktop-product-control-support-data-root-unavailable');
    }
    return selectedPath;
  }

  async bootstrapDataRootHandoff(): Promise<void> {
    this.operationGate.close('desktop-data-root-handoff-bootstrap-recovery');
    try {
      const projection = await this.record();
      if (!projection.exists || !projection.record?.dataRoot) {
        this.operationGate.open();
        return;
      }
      if (projection.state !== 'ready_for_use') {
        if (projection.state === 'data_root_selected' || projection.state === 'not_logged_in') {
          this.operationGate.open();
        }
        return;
      }
      await this.recoverCanonicalActivation(projection);
    } catch {
      // Canonical disposition is unknown. Ordinary root operations remain
      // closed, while the Support diagnostic queue stays available.
    }
  }

  async recoverDataRootHandoff(): Promise<ProductControlHostProjection> {
    const projection = await this.record();
    if (this.pendingHandoff?.disposition === 'ambiguous') {
      if (sameCanonicalRoot(this.pendingHandoff, projection)) {
        if (projection.rootHandoff?.disposition === 'active_current_process') {
          this.abortHostDataRoot();
          this.pendingHandoff = null;
          this.operationGate.open();
          return projection;
        }
        throw new Error('desktop-product-control-data-root-handoff-disposition-ambiguous');
      }
      const activation = projection.record?.dataRoot?.rootActivationId ?? null;
      const currentPath = projection.record?.dataRoot?.path?.trim() || '';
      const disposition = projection.rootHandoff?.disposition;
      if (
        !activation
        || activation === this.pendingHandoff.beforeActivationId
        || !hostPathsEqual(currentPath, this.pendingHandoff.targetPath)
        || !['active_current_process', 'committed_restart_required', 'committed_repair_required'].includes(disposition ?? '')
      ) {
        throw new Error('desktop-product-control-data-root-handoff-disposition-ambiguous');
      }
      this.pendingHandoff = {
        ...this.pendingHandoff,
        committedActivationId: activation,
        disposition: 'committed',
      };
      this.commitHostDataRoot();
    }
    await this.recoverCanonicalActivation(projection, this.pendingHandoff?.committedActivationId ?? null);
    this.pendingHandoff = null;
    return projection;
  }

  // @nimi-authority: rule.nimi.desktop.product-surfaces.r034
  private async replaceDataRoot(targetRoot: string): Promise<ProductControlHostProjection> {
    return this.operationGate.runExclusive(async () => {
      const before = await this.record();
      const beforeActivationId = before.record?.dataRoot?.rootActivationId ?? null;
      const beforePath = before.record?.dataRoot?.path?.trim() || null;
      try {
        await this.quiesceHostDataRoot();
      } catch (error) {
        this.abortHostDataRoot();
        throw error;
      }
      let projection: ProductControlHostProjection;
      try {
        projection = await this.projection(METHOD.replaceDataRoot, { targetRoot }, 30_000);
      } catch (error) {
        this.pendingHandoff = {
          beforeActivationId,
          beforePath,
          targetPath: targetRoot,
          committedActivationId: null,
          disposition: 'ambiguous',
        };
        let canonical: ProductControlHostProjection;
        try {
          canonical = await this.record();
        } catch {
          this.operationGate.close('desktop-data-root-handoff-disposition-ambiguous');
          throw error;
        }
        if (
          sameCanonicalRoot(this.pendingHandoff, canonical)
          && canonical.rootHandoff?.disposition === 'active_current_process'
        ) {
          this.abortHostDataRoot();
          this.pendingHandoff = null;
          throw error;
        }
        const committedActivationId = canonical.record?.dataRoot?.rootActivationId ?? null;
        const committedPath = canonical.record?.dataRoot?.path?.trim() || '';
        if (
          !committedActivationId
          || committedActivationId === beforeActivationId
          || !hostPathsEqual(committedPath, targetRoot)
          || !['committed_restart_required', 'committed_repair_required'].includes(
            canonical.rootHandoff?.disposition ?? '',
          )
        ) {
          this.operationGate.close('desktop-data-root-handoff-disposition-ambiguous');
          throw error;
        }
        this.pendingHandoff = {
          beforeActivationId,
          beforePath,
          targetPath: targetRoot,
          committedActivationId,
          disposition: 'committed',
        };
        this.operationGate.close('desktop-data-root-handoff-committed');
        this.commitHostDataRoot();
        return this.completeCommittedHandoff(canonical, {
          transportLost: true,
          activation: null,
          configMutation: null,
        });
      }
      if (!projection.activation?.activated) {
        this.abortHostDataRoot();
        return projection;
      }
      const committedActivationId = projection.record?.dataRoot?.rootActivationId ?? null;
      this.pendingHandoff = {
        beforeActivationId,
        beforePath,
        targetPath: targetRoot,
        committedActivationId,
        disposition: 'committed',
      };
      this.operationGate.close('desktop-data-root-handoff-committed');
      this.commitHostDataRoot();
      return this.completeCommittedHandoff(projection, {
        transportLost: false,
        activation: projection.activation,
        configMutation: projection.configMutation ?? null,
      });
    });
  }

  private async completeCommittedHandoff(
    projection: ProductControlHostProjection,
    response: {
      readonly transportLost: boolean;
      readonly activation: ProductControlHostActivation | null;
      readonly configMutation: ProductControlHostProjection['configMutation'];
    },
  ): Promise<ProductControlHostProjection> {
    if (
      projection.configMutation?.disposition === 'repair_required'
      || projection.rootHandoff?.disposition === 'committed_repair_required'
    ) {
      this.operationGate.close('desktop-data-root-handoff-repair-required');
      return projection;
    }
    if (this.runtimeLifecycleProfile !== 'fixed') {
      this.operationGate.close('desktop-source-runtime-restart-required-after-data-root-activation');
      return {
        ...projection,
        error: projection.error ?? (response.transportLost
          ? 'SOURCE_RUNTIME_RESTART_THEN_RUN_CHECK_SYNC_REQUIRED_AFTER_REPLACEMENT_TRANSPORT_LOSS'
          : 'SOURCE_RUNTIME_RESTART_THEN_RUN_CHECK_SYNC_REQUIRED_AFTER_DATA_ROOT_ACTIVATION'),
      };
    }
    try {
      await this.restartRuntime();
      const rebound = await this.recoverDataRootHandoff();
      return {
        ...rebound,
        activation: response.activation,
        configMutation: response.configMutation,
        error: response.transportLost
          ? 'REPLACEMENT_TRANSPORT_LOST_AFTER_DATA_ROOT_ACTIVATION'
          : rebound.error,
      };
    } catch (error) {
      this.operationGate.close('desktop-runtime-restart-failed-after-data-root-activation');
      return {
        ...projection,
        error: error instanceof Error ? error.message : 'DESKTOP_RUNTIME_RESTART_FAILED_AFTER_DATA_ROOT_ACTIVATION',
      };
    }
  }

  private async recoverCanonicalActivation(
    projection: ProductControlHostProjection,
    expectedActivationId: string | null = null,
  ): Promise<void> {
    if (
      projection.state !== 'ready_for_use'
      || projection.record?.dataRoot?.status !== 'ready'
    ) {
      throw new Error('desktop-product-control-data-root-repair-required');
    }
    const activation = projection.record.dataRoot.rootActivationId;
    if (!activation) throw new Error('desktop-product-control-current-activation-unavailable');
    if (
      projection.rootHandoff?.rootActivationId !== activation
      || projection.rootHandoff.disposition !== 'active_current_process'
    ) {
      throw new Error('desktop-product-control-current-activation-not-bound');
    }
    if (expectedActivationId && activation !== expectedActivationId) {
      throw new Error('desktop-product-control-runtime-rebound-activation-mismatch');
    }
    await this.awaitCheckSyncActivation(activation);
    this.activateHostDataRoot();
    this.operationGate.open();
  }

  private async record(): Promise<ProductControlHostProjection> {
    return this.projection(METHOD.getRecord, {}, 10_000);
  }

  private async selectedDataRoot() {
    const response = asRecord(await this.unary(METHOD.getSelectedDataRoot, {}, 10_000));
    const json = boundedText(response.json, 2_000_000);
    return parseNimiProductControlSelectedDataRootProjection(JSON.parse(json) as unknown);
  }

  private async projection(methodId: string, request: Readonly<Record<string, unknown>>, timeoutMs: number): Promise<ProductControlHostProjection> {
    const response = asRecord(await this.unary(methodId, request, timeoutMs));
    const json = boundedText(response.json, 2_000_000);
    const raw = asRecord(JSON.parse(json) as unknown);
    const rawConfig = raw.configMutation == null ? null : asRecord(raw.configMutation);
    const parsed = parseNimiProductControlRecordProjection(
      rawConfig?.disposition === 'repair_required' ? { ...raw, configMutation: null } : raw,
    );
    return extendProductControlProjection(parsed, raw);
  }

  private async checkSyncProjection(methodId: string, timeoutMs: number): Promise<DesktopCheckSyncProjection> {
    const response = asRecord(await this.unary(methodId, {}, timeoutMs));
    const json = boundedText(response.json, 2_000_000);
    return parseDesktopCheckSyncProjection(JSON.parse(json) as unknown);
  }

  private async awaitCheckSyncActivation(rootActivationId: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const projection = await this.checkSyncProjection(METHOD.getCheckSync, 2_000);
      if (
        projection.obligation?.rootActivationId === rootActivationId
        && (
          projection.obligation.state === 'completed'
          || (
            projection.run?.rootActivationId === rootActivationId
            && (projection.run.state === 'running' || projection.run.state === 'completed')
          )
        )
      ) {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('desktop-product-control-check-sync-activation-unavailable');
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

function sameCanonicalRoot(
  pending: Pick<PendingDataRootHandoff, 'beforeActivationId' | 'beforePath'>,
  projection: ProductControlHostProjection,
): boolean {
  const currentActivationId = projection.record?.dataRoot?.rootActivationId ?? null;
  const currentPath = projection.record?.dataRoot?.path?.trim() || null;
  return currentActivationId === pending.beforeActivationId && currentPath === pending.beforePath;
}

function hostPathsEqual(left: string, right: string): boolean {
  if (!left || !right) return false;
  const windowsAbsolute = (value: string): boolean => /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\');
  if (windowsAbsolute(left) || windowsAbsolute(right)) {
    return windowsAbsolute(left)
      && windowsAbsolute(right)
      && path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
  }
  return path.posix.isAbsolute(left)
    && path.posix.isAbsolute(right)
    && path.posix.normalize(left) === path.posix.normalize(right);
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
  if (Object.keys(payload).join('|') !== 'payload') throw new Error('desktop-product-control-payload-invalid');
  const nested = asRecord(payload.payload);
  const actualKeys = Object.keys(nested).sort();
  if (keys.some((key) => !actualKeys.includes(key))
    || actualKeys.some((key) => !keys.includes(key))) {
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

function extendProductControlProjection(
  projection: NimiProductControlRecordProjection,
  raw: Readonly<Record<string, unknown>>,
): ProductControlHostProjection {
  const rawRecord = raw.record == null ? null : asRecord(raw.record);
  const rawDataRoot = rawRecord?.dataRoot == null ? null : asRecord(rawRecord.dataRoot);
  const rawActivation = raw.activation == null ? null : asRecord(raw.activation);
  const rawConfig = raw.configMutation == null ? null : asRecord(raw.configMutation);
  const rawRootHandoff = raw.rootHandoff == null ? null : asRecord(raw.rootHandoff);
  if (rawConfig?.disposition === 'repair_required'
    && (rawConfig.reasonCode !== 'CONFIG_WRITE_FAILED' || rawConfig.actionHint !== 'repair_runtime_config')) {
    throw new Error('runtime-product-control-response-invalid');
  }
  const activation = rawActivation ? {
    activated: rawActivation.activated === true,
    reasonCode: oneOf(rawActivation.reasonCode, ['DATA_ROOT_REPLACED', 'DATA_ROOT_UNCHANGED', 'DATA_ROOT_OVERLAPS_CURRENT'] as const),
    actionHint: oneOf(rawActivation.actionHint, ['restart_runtime_and_check_sync', 'run_check_sync', 'choose_path_disjoint_root'] as const),
  } : null;
  const configMutation = rawConfig ? {
    disposition: oneOf(rawConfig.disposition, ['applied', 'restart_required', 'repair_required'] as const),
    reasonCode: boundedText(rawConfig.reasonCode),
    actionHint: boundedText(rawConfig.actionHint),
  } : null;
  const rootHandoff = rawRootHandoff ? parseProductControlRootHandoff(rawRootHandoff) : null;
  if (
    rootHandoff
    && rawDataRoot?.rootActivationId !== rootHandoff.rootActivationId
  ) {
    throw new Error('runtime-product-control-response-invalid');
  }
  return {
    ...projection,
    record: projection.record ? {
      ...projection.record,
      dataRoot: projection.record.dataRoot ? {
        ...projection.record.dataRoot,
        rootActivationId: optionalText(rawDataRoot?.rootActivationId),
      } : null,
    } : null,
    activation,
    configMutation,
    rootHandoff,
  };
}

function parseProductControlRootHandoff(value: Readonly<Record<string, unknown>>): NonNullable<ProductControlHostProjection['rootHandoff']> {
  const disposition = oneOf(value.disposition, [
    'active_current_process',
    'activation_not_bound',
    'committed_restart_required',
    'committed_repair_required',
  ] as const);
  const actionHint = oneOf(value.actionHint, [
    'continue',
    'restart_runtime_and_check_sync',
    'repair_runtime_config',
  ] as const);
  const valid = (disposition === 'active_current_process' && actionHint === 'continue')
    || (disposition === 'activation_not_bound' && actionHint === 'restart_runtime_and_check_sync')
    || (disposition === 'committed_restart_required' && actionHint === 'restart_runtime_and_check_sync')
    || (disposition === 'committed_repair_required' && actionHint === 'repair_runtime_config');
  if (!valid) throw new Error('runtime-product-control-response-invalid');
  return {
    disposition,
    rootActivationId: boundedText(value.rootActivationId),
    actionHint,
  };
}

function parseDesktopCheckSyncProjection(value: unknown): DesktopCheckSyncProjection {
  const projection = asRecord(value);
  const obligation = projection.obligation == null ? null : asRecord(projection.obligation);
  const run = projection.run == null ? null : asRecord(projection.run);
  const parsedObligation = obligation
    ? {
      rootActivationId: boundedText(obligation.rootActivationId),
      state: oneOf(obligation.state, ['required', 'completed'] as const),
    }
    : null;
  if (!run) {
    return { run: null, obligation: parsedObligation, error: optionalText(projection.error) };
  }
  const owners = requiredArray(run.owners).map((rawOwner) => {
    const owner = asRecord(rawOwner);
    return {
      ownerId: boundedText(owner.ownerId),
      state: oneOf(owner.state, ['pending', 'running', 'completed', 'failed'] as const),
      resources: requiredArray(owner.resources).map(parseDesktopCheckSyncResource),
    };
  });
  const unclaimed = requiredArray(run.unclaimed).map((rawEntry) => {
    const entry = asRecord(rawEntry);
    return {
      locator: relativeLocator(entry.locator),
      status: oneOf(entry.status, ['unknown'] as const),
      reason: boundedText(entry.reason),
    };
  });
  return {
    run: {
      runId: boundedText(run.runId),
      rootActivationId: boundedText(run.rootActivationId),
      trigger: oneOf(run.trigger, ['activation', 'manual', 'interrupted_recovery'] as const),
      state: oneOf(run.state, ['running', 'completed', 'failed', 'superseded'] as const),
      startedAt: boundedText(run.startedAt),
      completedAt: optionalText(run.completedAt) ?? undefined,
      owners,
      unclaimed,
    },
    obligation: parsedObligation,
    error: optionalText(projection.error),
  };
}

function parseDesktopCheckSyncResource(value: unknown): DesktopCheckSyncResourceResult {
  const resource = asRecord(value);
  return {
    kind: boundedText(resource.kind),
    reference: optionalText(resource.reference) ?? undefined,
    locator: resource.locator == null ? undefined : relativeLocator(resource.locator),
    status: oneOf(resource.status, ['available', 'unavailable', 'incompatible', 'unknown', 'conflict', 'failed'] as const),
    change: resource.change == null ? undefined : oneOf(resource.change, ['rebased', 'adopted', 'rebuilt'] as const),
    reason: boundedText(resource.reason),
    nextAction: resource.nextAction == null ? undefined : oneOf(resource.nextAction, ['rerun_check_sync'] as const),
  };
}

function requiredArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('runtime-check-sync-response-invalid');
  return value;
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  return boundedText(value);
}

function relativeLocator(value: unknown): string {
  const locator = boundedText(value, 32_768);
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(locator) || locator.split(/[\\/]/).includes('..')) {
    throw new Error('runtime-check-sync-private-locator-invalid');
  }
  return locator.replaceAll('\\', '/');
}

function oneOf<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  const text = boundedText(value);
  if (!values.includes(text)) throw new Error('runtime-check-sync-response-invalid');
  return text as Values[number];
}
