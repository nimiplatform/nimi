import { createNimiError, ReasonCode } from '../types';

export type NimiRuntimeAppStorageRoots = {
  dataRoot: string;
  cacheRoot: string;
  tempRoot: string;
};

export type NimiRuntimeAppActiveStorageRoots = NimiRuntimeAppStorageRoots & {
  releaseRoot: string;
};

export type NimiRuntimeAppStorageState =
  | 'ready'
  | 'install_required'
  | 'repair_required'
  | 'storage_unavailable';

export type NimiRuntimeAppStorageProjection = {
  appId: string;
  state: NimiRuntimeAppStorageState;
  appRoot: string;
  activeReleaseRoot?: string;
  durableDataRoot: string;
  cacheRoot: string;
  tempRoot: string;
  activeVersion?: string;
  storagePolicyRef: string;
  reasonCode?: string;
  detail?: string;
};

export type NimiRuntimeAppStorageClient = {
  storage(
    input: { readonly appId: string },
    options?: unknown,
  ): Promise<NimiRuntimeAppStorageProjection>;
};

export type ResolveNimiRuntimeAppStorageRootsInput = {
  appLifecycle: Pick<NimiRuntimeAppStorageClient, 'storage'>;
  appId: string;
  label?: string;
  options?: unknown;
};

/**
 * Host-side primitive. Resolved roots are host-owned Runtime storage truth and
 * must never be placed into renderer→host command payloads; the standard shell
 * storage payload policy forbids renderer-carried `storageRoot`/`root`/
 * `absolutePath` fields (platform standard-shell-capabilities table).
 */
export async function resolveNimiRuntimeAppStorageRoots(
  input: ResolveNimiRuntimeAppStorageRootsInput,
): Promise<NimiRuntimeAppStorageRoots> {
  const appId = requireText(input.appId, 'appId');
  const label = requireText(input.label || 'app', 'label');
  const projection = await input.appLifecycle.storage({ appId }, input.options);
  ensureStorageAvailable(appId, projection, label);
  return {
    dataRoot: requireText(projection.durableDataRoot, 'durableDataRoot'),
    cacheRoot: requireText(projection.cacheRoot, 'cacheRoot'),
    tempRoot: requireText(projection.tempRoot, 'tempRoot'),
  };
}

/**
 * Host-side primitive. See resolveNimiRuntimeAppStorageRoots: returned roots
 * must not enter renderer→host command payloads.
 */
export async function resolveNimiRuntimeAppActiveStorageRoots(
  input: ResolveNimiRuntimeAppStorageRootsInput,
): Promise<NimiRuntimeAppActiveStorageRoots | undefined> {
  const appId = requireText(input.appId, 'appId');
  const label = requireText(input.label || 'app', 'label');
  const projection = await input.appLifecycle.storage({ appId }, input.options);
  ensureStorageAvailable(appId, projection, label);
  if (!projection.activeReleaseRoot) {
    return undefined;
  }
  return {
    releaseRoot: requireText(projection.activeReleaseRoot, 'activeReleaseRoot'),
    dataRoot: requireText(projection.durableDataRoot, 'durableDataRoot'),
    cacheRoot: requireText(projection.cacheRoot, 'cacheRoot'),
    tempRoot: requireText(projection.tempRoot, 'tempRoot'),
  };
}

function requireText(value: unknown, fieldName: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw createNimiError({
      message: `runtime app storage ${fieldName} is required`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'use_runtime_get_app_storage_projection',
      source: 'sdk',
    });
  }
  return text;
}

function ensureStorageAvailable(
  appId: string,
  projection: NimiRuntimeAppStorageProjection,
  label: string,
): void {
  if (projection.state !== 'storage_unavailable' && projection.state !== 'repair_required') {
    return;
  }
  throw createNimiError({
    message: projection.detail
      || `${label} storage projection for ${appId} is ${projection.state}`,
    reasonCode: ReasonCode.ACTION_INPUT_INVALID,
    actionHint: 'repair_runtime_app_storage_projection',
    source: 'runtime',
  });
}
