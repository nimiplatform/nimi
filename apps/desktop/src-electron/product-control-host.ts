import {
  createNimiElectronDesktopAccountHost,
  createNimiElectronDesktopControlHost,
  type NimiElectronDesktopAccountHost,
  type NimiElectronDesktopControlHost,
} from '@nimiplatform/kit/shell/electron/main';
import { getRuntimeWireCodec } from '@nimiplatform/sdk/runtime/generated';
import {
  parseNimiProductControlRecordProjection,
  parseNimiProductControlSelectedDataRootProjection,
  type NimiProductControlRecordProjection,
} from '@nimiplatform/sdk/runtime';
import {
  createDesktopAccountProfileHost,
  type DesktopAccountProfileHost,
} from './account-profile-host.js';

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

const ACCOUNT_PROFILE_LIBRARY_COMMANDS = [
  'account_profile_library_list',
  'account_profile_library_create',
  'account_profile_library_edit',
  'account_profile_library_import',
  'account_profile_library_export',
  'account_profile_library_delete',
] as const;

const COMMANDS = [
  ...DIRECT_COMMANDS,
  ...ACCOUNT_PROFILE_LIBRARY_COMMANDS,
] as const;

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
  readonly account?: NimiElectronDesktopAccountHost;
  readonly profiles?: DesktopAccountProfileHost;
} = {}): DesktopElectronProductControlHost {
  const host = new ElectronProductControlHost(
    input.control ?? createNimiElectronDesktopControlHost(),
    input.account ?? createNimiElectronDesktopAccountHost(),
    input.profiles ?? createDesktopAccountProfileHost(),
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
    private readonly account: NimiElectronDesktopAccountHost,
    private readonly profiles: DesktopAccountProfileHost,
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
    if (command === 'account_profile_library_list') {
      requireEmptyPayload(payload);
      const context = await this.accountProfileLibraryContext();
      return this.profiles.listAccountProfileLibrary(context);
    }
    if (command === 'account_profile_library_create') {
      const nested = exactPayload(payload, ['profile']);
      const profile = profilePayload(nested.profile);
      return this.profiles.createAccountProfileLibraryProfile({
        ...await this.accountProfileLibraryContext(),
        profile,
      });
    }
    if (command === 'account_profile_library_edit') {
      const nested = exactPayload(payload, ['profile']);
      const profile = profilePayload(nested.profile);
      return this.profiles.editAccountProfileLibraryProfile({
        ...await this.accountProfileLibraryContext(),
        profile,
      });
    }
    if (command === 'account_profile_library_import') {
      const nested = exactPayload(payload, ['profiles']);
      const profiles = profilePayloads(nested.profiles);
      return this.profiles.importAccountProfileLibraryProfiles({
        ...await this.accountProfileLibraryContext(),
        profiles,
      });
    }
    if (command === 'account_profile_library_export') {
      const nested = exactPayload(payload, ['profileIds']);
      const requestedProfileIds = profileIds(nested.profileIds);
      return this.profiles.exportAccountProfileLibraryProfiles({
        ...await this.accountProfileLibraryContext(),
        profileIds: requestedProfileIds,
      });
    }
    const nested = exactPayload(payload, ['profileId']);
    const profileId = payloadText(nested.profileId, 256);
    return this.profiles.deleteAccountProfileLibraryProfile({
      ...await this.accountProfileLibraryContext(),
      profileId,
    });
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

  private async authenticatedAccountId(): Promise<string> {
    const response = asRecord(await this.account.invoke('runtime_account_session_status', {}));
    if (response.state !== 'authenticated') throw new Error('authenticated-runtime-account-required');
    return boundedText(asRecord(response.accountProjection).accountId);
  }

  private async accountProfileLibraryContext(): Promise<{
    readonly dataRoot: string;
    readonly accountId: string;
  }> {
    const [dataRoot, accountId] = await Promise.all([
      this.resolveReadyDataRoot(),
      this.authenticatedAccountId(),
    ]);
    return { dataRoot, accountId };
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

function profilePayload(value: unknown): Readonly<Record<string, unknown>> {
  return asRecord(value);
}

function profilePayloads(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new Error('desktop-product-control-payload-invalid');
  }
  return value.map(profilePayload);
}

function profileIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error('desktop-product-control-payload-invalid');
  }
  const ids = value.map((profileId) => payloadText(profileId, 256));
  if (new Set(ids).size !== ids.length) {
    throw new Error('desktop-product-control-payload-invalid');
  }
  return ids;
}
