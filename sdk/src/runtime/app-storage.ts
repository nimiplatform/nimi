import type { RuntimeCallOptions } from './types.js';
import type {
  RuntimeAppLifecycleModule,
  RuntimeAppStorageProjection,
} from './runtime-app-lifecycle-types.js';
import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';

export type RuntimeAppStorageRoots = {
  dataRoot: string;
  cacheRoot: string;
  tempRoot: string;
};

export type RuntimeAppActiveStorageRoots = RuntimeAppStorageRoots & {
  releaseRoot: string;
};

export type ResolveRuntimeAppStorageRootsInput = {
  appLifecycle: Pick<RuntimeAppLifecycleModule, 'storage'>;
  appId: string;
  label?: string;
  options?: RuntimeCallOptions;
};

function requireNonEmptyText(value: unknown, fieldName: string): string {
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

function storageUnavailableError(
  appId: string,
  projection: RuntimeAppStorageProjection,
  label: string,
): Error {
  return createNimiError({
    message: projection.detail
      || `${label} storage projection for ${appId} is ${projection.state}`,
    reasonCode: ReasonCode.ACTION_INPUT_INVALID,
    actionHint: 'repair_runtime_app_storage_projection',
    source: 'runtime',
  });
}

export async function resolveRuntimeAppStorageRoots(
  input: ResolveRuntimeAppStorageRootsInput,
): Promise<RuntimeAppStorageRoots> {
  const appId = requireNonEmptyText(input.appId, 'appId');
  const label = requireNonEmptyText(input.label || 'app', 'label');
  const projection = await input.appLifecycle.storage({ appId }, input.options);
  if (projection.state === 'storage_unavailable' || projection.state === 'repair_required') {
    throw storageUnavailableError(appId, projection, label);
  }
  const dataRoot = requireNonEmptyText(projection.durableDataRoot, 'durableDataRoot');
  const cacheRoot = requireNonEmptyText(projection.cacheRoot, 'cacheRoot');
  const tempRoot = requireNonEmptyText(projection.tempRoot, 'tempRoot');
  return { dataRoot, cacheRoot, tempRoot };
}

export async function resolveRuntimeAppActiveStorageRoots(
  input: ResolveRuntimeAppStorageRootsInput,
): Promise<RuntimeAppActiveStorageRoots | undefined> {
  const appId = requireNonEmptyText(input.appId, 'appId');
  const label = requireNonEmptyText(input.label || 'app', 'label');
  const projection = await input.appLifecycle.storage({ appId }, input.options);
  if (projection.state === 'storage_unavailable' || projection.state === 'repair_required') {
    throw storageUnavailableError(appId, projection, label);
  }
  if (!projection.activeReleaseRoot) {
    return undefined;
  }
  return {
    releaseRoot: requireNonEmptyText(projection.activeReleaseRoot, 'activeReleaseRoot'),
    dataRoot: requireNonEmptyText(projection.durableDataRoot, 'durableDataRoot'),
    cacheRoot: requireNonEmptyText(projection.cacheRoot, 'cacheRoot'),
    tempRoot: requireNonEmptyText(projection.tempRoot, 'tempRoot'),
  };
}
