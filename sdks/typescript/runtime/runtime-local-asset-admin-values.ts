import { createNimiError, type JsonObject } from '../types';
import type { NimiRuntimeLocalDownloadState } from './runtime-local-asset-admin-types';

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 200;

export function assertNimiRuntimeLocalWriteAllowed(command: string, caller: unknown): void {
  const normalizedCaller = normalizeText(caller).toLowerCase();
  if (normalizedCaller === 'core') {
    return;
  }
  throw createNimiError({
    message: `Runtime local write denied for ${command}: caller=${normalizedCaller || '<missing>'}`,
    reasonCode: 'SDK_RUNTIME_LOCAL_WRITE_DENIED',
    actionHint: 'route_local_runtime_write_through_core',
    source: 'sdk',
    details: { command, caller: normalizedCaller || '<missing>' },
  });
}

export function normalizeNimiRuntimeLocalDownloadState(value: unknown): NimiRuntimeLocalDownloadState {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === 'running'
    || normalized === 'paused'
    || normalized === 'failed'
    || normalized === 'completed'
    || normalized === 'cancelled'
  ) {
    return normalized;
  }
  return 'queued';
}

export function requireLocalText(value: unknown, message: string, actionHint: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message,
      reasonCode: 'SDK_RUNTIME_LOCAL_INPUT_INVALID',
      actionHint,
      source: 'sdk',
    });
  }
  return normalized;
}

export function requireProjectedText(value: unknown, message: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw invalidLocalProjection(message);
  }
  return normalized;
}

export function projectRequiredLocal<TInput, TOutput>(
  value: TInput | undefined | null,
  project: (value: TInput) => TOutput,
  message: string,
  actionHint: string,
): TOutput {
  if (value == null) {
    throw createNimiError({
      message,
      reasonCode: 'SDK_RUNTIME_LOCAL_RESPONSE_INVALID',
      actionHint,
      source: 'runtime',
    });
  }
  return project(value);
}

export function invalidLocalProjection(message: string): Error {
  return createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_LOCAL_RESPONSE_INVALID',
    actionHint: 'check_runtime_local_response',
    source: 'runtime',
  });
}

export function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

export function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

export function textListOrUndefined(value: unknown): string[] | undefined {
  const items = textList(value);
  return items.length > 0 ? items : undefined;
}

export function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, item]) => [key, normalizeText(item)]),
  );
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function nonEmptyRecord(value: JsonObject): JsonObject | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

export function numberFromInt64(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function clampNimiRuntimeLocalPercent(value: unknown): number {
  const parsed = Math.round(Number(value ?? 0));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  if (parsed >= 100) {
    return 100;
  }
  return parsed;
}

export function normalizeNimiRuntimeLocalState(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

export function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function normalizePageSize(value: unknown): number {
  const parsed = Math.trunc(Number(value ?? DEFAULT_PAGE_SIZE));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE;
}

export function normalizeMaxPages(value: unknown): number {
  const parsed = Math.trunc(Number(value ?? DEFAULT_MAX_PAGES));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAGES;
}

export function dedupeBy<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyFor(item);
    if (key && !byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}
