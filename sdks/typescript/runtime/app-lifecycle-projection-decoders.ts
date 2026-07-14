import {
  AppPackageReadinessState,
  AppStorageState,
  type AppPackageReadinessProjection,
  type AppStorageProjection,
} from '../core-generated/runtime-typed-client';
import type { NimiRuntimeAppPackageReadinessProjection } from './app-lifecycle-types';
import type {
  NimiRuntimeAppStorageProjection,
  NimiRuntimeAppStorageState,
} from './app-storage';
import {
  decodeNimiRuntimeAppLifecycleError,
  decodeNimiRuntimeReasonCode,
  normalizeNimiRuntimeAppLifecycleText,
  requireNimiRuntimeAppLifecycleProjectionText,
} from './app-lifecycle-decoder-utils';

export function decodeNimiRuntimeAppStorageProjection(
  projection: AppStorageProjection | undefined,
): NimiRuntimeAppStorageProjection {
  if (!projection) {
    return decodeNimiRuntimeAppLifecycleError('runtime app storage response is missing the storage projection');
  }
  const appId = requireNimiRuntimeAppLifecycleProjectionText(projection.appId, 'runtime app storage projection appId');
  const state = decodeNimiRuntimeAppStorageState(projection.state);
  const reasonCode = decodeNimiRuntimeReasonCode(projection.reasonCode);
  if ((state === 'repair_required' || state === 'storage_unavailable') && !reasonCode) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app storage projection ${appId} is ${state} without a typed reason code`,
    );
  }
  const activeReleaseRoot = normalizeNimiRuntimeAppLifecycleText(projection.activeReleaseRoot);
  const activeVersion = normalizeNimiRuntimeAppLifecycleText(projection.activeVersion);
  const detail = normalizeNimiRuntimeAppLifecycleText(projection.detail);
  return {
    appId,
    state,
    appRoot: requireNimiRuntimeAppLifecycleProjectionText(projection.appRoot, 'runtime app storage projection appRoot'),
    ...(activeReleaseRoot ? { activeReleaseRoot } : {}),
    durableDataRoot: requireNimiRuntimeAppLifecycleProjectionText(
      projection.durableDataRoot,
      'runtime app storage projection durableDataRoot',
    ),
    cacheRoot: requireNimiRuntimeAppLifecycleProjectionText(
      projection.cacheRoot,
      'runtime app storage projection cacheRoot',
    ),
    tempRoot: requireNimiRuntimeAppLifecycleProjectionText(
      projection.tempRoot,
      'runtime app storage projection tempRoot',
    ),
    ...(activeVersion ? { activeVersion } : {}),
    storagePolicyRef: requireNimiRuntimeAppLifecycleProjectionText(
      projection.storagePolicyRef,
      'runtime app storage projection storagePolicyRef',
    ),
    ...(reasonCode ? { reasonCode } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function decodeNimiRuntimeAppPackageReadinessProjection(
  projection: AppPackageReadinessProjection | undefined,
): NimiRuntimeAppPackageReadinessProjection {
  if (!projection) {
    return decodeNimiRuntimeAppLifecycleError('runtime app package readiness response is missing the projection');
  }
  if (projection.state !== AppPackageReadinessState.BLOCKED) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app package readiness exposed non-0K state: ${String(projection.state)}`,
    );
  }
  const reasonCode = decodeNimiRuntimeReasonCode(projection.reasonCode);
  if (!reasonCode) {
    return decodeNimiRuntimeAppLifecycleError(
      'runtime app package readiness unavailable projection is missing a typed reason code',
    );
  }
  const forbiddenValues = [
    projection.appId,
    projection.releaseDescriptorRef,
    projection.storagePolicyRef,
    projection.expectedVersion,
    projection.activeVersion,
    projection.installedVersion,
    projection.sha256,
    projection.verificationState,
  ];
  if (forbiddenValues.some((value) => normalizeNimiRuntimeAppLifecycleText(value))) {
    return decodeNimiRuntimeAppLifecycleError(
      'runtime app package readiness unavailable projection leaked package selectors or positive materialization truth',
    );
  }
  const detail = normalizeNimiRuntimeAppLifecycleText(projection.detail);
  return {
    state: 'unavailable',
    reasonCode,
    ...(detail ? { detail } : {}),
  };
}

function decodeNimiRuntimeAppStorageState(value: AppStorageState): NimiRuntimeAppStorageState {
  switch (value) {
    case AppStorageState.READY:
      return 'ready';
    case AppStorageState.INSTALL_REQUIRED:
      return 'install_required';
    case AppStorageState.REPAIR_REQUIRED:
      return 'repair_required';
    case AppStorageState.STORAGE_UNAVAILABLE:
      return 'storage_unavailable';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime app storage projection has unspecified state: ${String(value)}`,
      );
  }
}
