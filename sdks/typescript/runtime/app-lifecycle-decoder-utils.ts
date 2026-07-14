import {
  ReasonCode as RuntimeGeneratedReasonCode,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';

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
