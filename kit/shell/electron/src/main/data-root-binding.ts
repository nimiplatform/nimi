import path from 'node:path';
import { getRuntimeWireCodec } from '@nimiplatform/sdk/runtime/generated';
import {
  NimiElectronShellHostError,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
  type NimiElectronIpcMainInvokeEvent,
  type NimiElectronStandardDataRootBinding,
  type NimiElectronStandardShellHost,
  type NimiElectronStandardStorageRoots,
  type RuntimeGrpcBridgeClient,
} from './types.js';
import { createElectronRuntimeEndpointUnavailableError } from './errors.js';
import { invokeElectronRuntimeTrustedUnary } from './runtime.js';

const GET_APP_STORAGE_METHOD_ID = '/nimi.runtime.v1.RuntimeAppService/GetAppStorage';
const GET_APP_STORAGE_TIMEOUT_MS = 10_000;
const APP_STORAGE_STATE_READY = 1;
// GetAppStorage is a main-process control-plane call, not a renderer-forwarded
// Runtime request. The trusted provider still supplies the app/session proof.
const INTERNAL_STANDARD_STORAGE_EVENT: NimiElectronIpcMainInvokeEvent = {
  senderFrame: null,
};

export type NimiElectronStandardDataRootRuntimeResolverDeps = {
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly ensureClient: () => Promise<RuntimeGrpcBridgeClient>;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
};

type DecodedAppStorageProjection = {
  readonly state?: number;
  readonly durableDataRoot?: string;
  readonly cacheRoot?: string;
  readonly tempRoot?: string;
};

const runtimeResolverDeps = new WeakMap<
  NimiElectronStandardShellHost,
  NimiElectronStandardDataRootRuntimeResolverDeps
>();
const resolvedRootsCache = new WeakMap<
  NimiElectronStandardShellHost,
  Promise<NimiElectronStandardStorageRoots>
>();

export function bindElectronStandardDataRootRuntimeResolver(
  host: NimiElectronStandardShellHost,
  deps: NimiElectronStandardDataRootRuntimeResolverDeps,
): void {
  runtimeResolverDeps.set(host, deps);
}

export function createElectronStandardDataRootBindingMissingError(command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'capability-unavailable',
    message: `Electron standard data root binding is missing for command: ${command}`,
    reasonCode: 'electron-standard-data-root-binding-missing',
    actionHint: 'provide_runtime_attested_standard_data_root_binding',
    details: { command },
  });
}

export async function resolveElectronStandardStorageRoots(
  host: NimiElectronStandardShellHost | undefined,
  command: string,
): Promise<NimiElectronStandardStorageRoots> {
  const binding = host?.standardDataRootBinding;
  if (!host) {
    throw createElectronStandardDataRootBindingMissingError(command);
  }
  if (binding?.source === 'runtime-launch-projection') {
    return projectionStorageRoots(binding, command);
  }
  if (!binding) {
    throw createElectronStandardDataRootBindingMissingError(command);
  }
  const existing = resolvedRootsCache.get(host);
  if (existing) {
    return existing;
  }
  const pending = resolveRuntimeStorageRoots(host, command).catch((error: unknown) => {
    resolvedRootsCache.delete(host);
    throw error;
  });
  resolvedRootsCache.set(host, pending);
  return pending;
}

export async function resolveElectronStandardDataRoot(
  host: NimiElectronStandardShellHost | undefined,
  command: string,
): Promise<string> {
  const roots = await resolveElectronStandardStorageRoots(host, command);
  return roots.dataRoot;
}

function projectionStorageRoots(
  binding: Extract<NimiElectronStandardDataRootBinding, { source: 'runtime-launch-projection' }>,
  command: string,
): NimiElectronStandardStorageRoots {
  const projectionRef = String(binding.projectionRef ?? '').trim();
  if (!projectionRef) {
    throw createProjectionBindingInvalidError(command, 'projectionRef', binding.projectionRef);
  }
  return {
    dataRoot: requireAbsoluteBindingRoot(binding.durableDataRoot, 'durableDataRoot', command),
    cacheRoot: optionalAbsoluteBindingRoot(binding.cacheRoot, 'cacheRoot', command),
    tempRoot: optionalAbsoluteBindingRoot(binding.tempRoot, 'tempRoot', command),
  };
}

async function resolveRuntimeStorageRoots(
  host: NimiElectronStandardShellHost,
  command: string,
): Promise<NimiElectronStandardStorageRoots> {
  const deps = runtimeResolverDeps.get(host);
  if (!deps) {
    throw new NimiElectronShellHostError({
      code: 'capability-unavailable',
      message: `Electron standard data root runtime resolver is not bound for command: ${command}`,
      reasonCode: 'electron-standard-data-root-resolver-unbound',
      actionHint: 'register_standard_shell_host_through_runtime_bridge_registration',
      details: { command },
    });
  }
  const codec = getRuntimeWireCodec(GET_APP_STORAGE_METHOD_ID);
  let responseBytes: Uint8Array;
  try {
    const client = await deps.ensureClient();
    const requestBytes = codec.encodeRequest({ appId: deps.appId });
    const response = await invokeElectronRuntimeTrustedUnary({
      client,
      request: {
        methodId: GET_APP_STORAGE_METHOD_ID,
        requestBytesBase64: '',
        timeoutMs: GET_APP_STORAGE_TIMEOUT_MS,
      },
      requestBytes,
      appId: deps.appId,
      event: INTERNAL_STANDARD_STORAGE_EVENT,
      runtimeEndpoint: deps.runtimeEndpoint,
      command,
      trustedRuntimeMetadataProvider: deps.trustedRuntimeMetadataProvider,
    });
    responseBytes = response.responseBytes;
  } catch (error) {
    if (error instanceof NimiElectronShellHostError) {
      throw error;
    }
    throw createElectronRuntimeEndpointUnavailableError(command, deps.runtimeEndpoint, error);
  }
  const decoded = codec.decodeResponse(responseBytes) as { projection?: DecodedAppStorageProjection };
  const projection = decoded.projection;
  if (!projection) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron Runtime app storage projection is missing for app: ${deps.appId}`,
      reasonCode: 'electron-runtime-app-storage-projection-missing',
      actionHint: 'inspect_runtime_get_app_storage_response',
      details: { command, appId: deps.appId },
    });
  }
  if (projection.state !== APP_STORAGE_STATE_READY) {
    throw new NimiElectronShellHostError({
      code: 'capability-unavailable',
      message: `Electron Runtime app storage is not ready for app: ${deps.appId}`,
      reasonCode: 'electron-runtime-app-storage-not-ready',
      actionHint: 'repair_runtime_app_storage_projection',
      details: { command, appId: deps.appId, state: projection.state },
    });
  }
  return {
    dataRoot: requireAbsoluteBindingRoot(projection.durableDataRoot, 'durableDataRoot', command),
    cacheRoot: optionalAbsoluteBindingRoot(projection.cacheRoot, 'cacheRoot', command),
    tempRoot: optionalAbsoluteBindingRoot(projection.tempRoot, 'tempRoot', command),
  };
}

function requireAbsoluteBindingRoot(value: unknown, field: string, command: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || !path.isAbsolute(normalized)) {
    throw createProjectionBindingInvalidError(command, field, value);
  }
  return normalized;
}

function optionalAbsoluteBindingRoot(value: unknown, field: string, command: string): string | undefined {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return undefined;
  }
  if (!path.isAbsolute(normalized)) {
    throw createProjectionBindingInvalidError(command, field, value);
  }
  return normalized;
}

function createProjectionBindingInvalidError(
  command: string,
  field: string,
  value: unknown,
): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'host-internal-error',
    message: `Electron standard data root binding field is invalid: ${field}`,
    reasonCode: 'electron-standard-data-root-binding-invalid',
    actionHint: 'provide_runtime_attested_absolute_storage_roots',
    details: { command, field, valueType: typeof value },
  });
}
