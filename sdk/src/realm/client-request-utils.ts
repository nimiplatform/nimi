import type { JsonObject } from '../internal/utils.js';
import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import { asRecord, readErrorBody } from './client-helpers.js';

export const REALM_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

type RealmHttpMethod = (typeof REALM_HTTP_METHODS)[number];

export function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function encodePathValue(value: string | number): string {
  return encodeURIComponent(String(value));
}

export function resolvePositiveTimeoutMs(value: unknown, fallback: number): number {
  const raw = value ?? fallback;
  const timeoutMs = Number(raw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw createNimiError({
      message: 'realm timeoutMs must be a positive finite number',
      reasonCode: ReasonCode.SDK_REALM_CONFIG_INVALID,
      actionHint: 'set_positive_realm_timeout_ms',
      source: 'sdk',
    });
  }
  return timeoutMs;
}

export async function readErrorResponseBodyWithDiagnostics(
  response: Response,
): Promise<{ body: JsonObject; details: JsonObject }> {
  try {
    return {
      body: readErrorBody(await response.text()),
      details: {},
    };
  } catch (error) {
    return {
      body: {},
      details: {
        responseBodyReadable: false,
        responseBodyReadError: error instanceof Error ? error.message : String(error || 'unknown error'),
      },
    };
  }
}

export function getOpenApiMethod(
  client: Record<string, unknown>,
  methodName: string,
): ((url: string, options?: Record<string, unknown>) => Promise<unknown>) | null {
  if (!REALM_HTTP_METHODS.includes(methodName as RealmHttpMethod)) {
    return null;
  }
  const candidate = client[methodName];
  if (typeof candidate !== 'function') {
    return null;
  }
  return candidate as (url: string, options?: Record<string, unknown>) => Promise<unknown>;
}
