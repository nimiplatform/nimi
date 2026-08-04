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
const DIRECT_COMMANDS = [
  'product_control_record_get',
  'product_control_selected_data_root_get',
  'product_control_record_ensure_created',
  'product_control_record_select_data_root',
  'product_control_record_complete_first_run_device_environment_scan',
  'product_control_record_set_first_run_install_level',
  'product_control_record_reconcile_first_run_setup_state',
  'product_control_record_admit_ready_for_use',
] as const;

const COMMANDS = DIRECT_COMMANDS;

const METHOD = {
  getRecord: '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
  getSelectedDataRoot: '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot',
  ensureRecord: '/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated',
  selectDataRoot: '/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot',
  completeDeviceScan: '/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan',
  setInstallLevel: '/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel',
  reconcileSetup: '/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState',
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
  /** Runtime-validated data root after Product Control has reached ready_for_use. */
  readonly resolveReadyDataRoot: () => Promise<string>;
};

export function createDesktopElectronProductControlHost(input: {
  readonly control?: DesktopProductControlTransport;
} = {}): DesktopElectronProductControlHost {
  const host = new ElectronProductControlHost(
    input.control ?? createNimiElectronDesktopControlHost(),
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
  };
}
class ElectronProductControlHost {
  constructor(
    private readonly control: DesktopProductControlTransport,
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
