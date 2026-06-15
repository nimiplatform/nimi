import {
  ReasonCode as RuntimeGeneratedReasonCode,
  type AppInstallStorageProjection,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import type { NimiRuntimeAppInstallStorage } from './app-lifecycle-types';

export function decodeNimiRuntimeReasonCode(value: RuntimeGeneratedReasonCode): string | undefined {
  if (!Number.isInteger(value) || value === RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED) {
    return undefined;
  }
  const name = RuntimeGeneratedReasonCode[value];
  if (!name) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app lifecycle projection carries an unknown reason code: ${String(value)}`,
    );
  }
  return name;
}

export function decodeNimiRuntimeAppInstallStorage(
  storage: AppInstallStorageProjection | undefined,
): NimiRuntimeAppInstallStorage {
  if (!storage) {
    return decodeNimiRuntimeAppLifecycleError('runtime app lifecycle projection is missing storage roots');
  }
  return {
    appRoot: requireNimiRuntimeAppLifecycleProjectionText(storage.appRoot, 'runtime app install storage appRoot'),
    releaseRoot: requireNimiRuntimeAppLifecycleProjectionText(
      storage.releaseRoot,
      'runtime app install storage releaseRoot',
    ),
    durableDataRoot: requireNimiRuntimeAppLifecycleProjectionText(
      storage.durableDataRoot,
      'runtime app install storage durableDataRoot',
    ),
    cacheRoot: requireNimiRuntimeAppLifecycleProjectionText(storage.cacheRoot, 'runtime app install storage cacheRoot'),
    tempRoot: requireNimiRuntimeAppLifecycleProjectionText(storage.tempRoot, 'runtime app install storage tempRoot'),
  };
}

export function decodeNimiRuntimeAppArtifactBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app install job has invalid artifact bytes: ${String(value)}`,
    );
  }
  return parsed;
}

export function decodeNimiRuntimeAppJobEventSequence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime app install job event has an invalid sequence: ${String(value)}`,
    );
  }
  return parsed;
}

export function requireNimiRuntimeAppId(value: unknown): string {
  const appId = normalizeNimiRuntimeAppLifecycleText(value);
  if (!appId) {
    throw createNimiError({
      message: 'runtime.appLifecycle requires a non-empty appId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_APP_ID_REQUIRED,
      actionHint: 'pass_admitted_nimi_app_id',
      source: 'sdk',
    });
  }
  return appId;
}

export function requireNimiRuntimeAppLifecycleRootPath(value: unknown): string {
  const normalized = normalizeNimiRuntimeAppLifecycleText(value);
  if (!normalized) {
    throw createNimiError({
      message: 'runtime.appLifecycle.adoptLocal requires a non-empty rootPath',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_ROOT_PATH_REQUIRED,
      actionHint: 'pass_local_app_root_path_selected_by_user',
      source: 'sdk',
    });
  }
  return normalized;
}

export function requireNimiRuntimeAppLifecycleJobId(value: unknown): string {
  const jobId = normalizeNimiRuntimeAppLifecycleText(value);
  if (!jobId) {
    throw createNimiError({
      message: 'runtime.appLifecycle requires a non-empty jobId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_JOB_ID_REQUIRED,
      actionHint: 'pass_runtime_emitted_job_id',
      source: 'sdk',
    });
  }
  return jobId;
}

export function requireNimiRuntimeAppLifecycleProjectionText(value: unknown, field: string): string {
  const normalized = normalizeNimiRuntimeAppLifecycleText(value);
  if (!normalized) {
    return decodeNimiRuntimeAppLifecycleError(`${field} is missing`);
  }
  return normalized;
}

export function normalizeNimiRuntimeAppLifecycleText(value: unknown): string {
  return String(value || '').trim();
}

export function decodeNimiRuntimeAppLifecycleError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'check_runtime_app_lifecycle_projection',
    source: 'runtime',
  });
}
