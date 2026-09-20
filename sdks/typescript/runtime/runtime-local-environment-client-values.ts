import { createNimiError, type JsonObject } from '../types';
import type {
  NimiRuntimeLocalDownloadState,
  NimiRuntimeLocalTransferAction,
  NimiRuntimeLocalTransferDisposition,
} from './runtime-local-environment-client-types';

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

export function normalizeNimiRuntimeLocalTransferDisposition(value: unknown): NimiRuntimeLocalTransferDisposition | undefined {
  // Generated enums arrive as numbers; JSON transports may carry names.
  if (value === 1 || value === 'created' || value === 'CREATED' || value === 'LOCAL_TRANSFER_DISPOSITION_CREATED') {
    return 'created';
  }
  if (value === 2 || value === 'reused' || value === 'REUSED' || value === 'LOCAL_TRANSFER_DISPOSITION_REUSED') {
    return 'reused';
  }
  return undefined;
}

const TRANSFER_ACTION_BY_ENUM: Record<number, NimiRuntimeLocalTransferAction> = {
  1: 'pause', 2: 'resume', 3: 'cancel', 4: 'reimport', 5: 'check_sync', 6: 'view_related_transfer',
};

export function normalizeNimiRuntimeLocalTransferActions(values: unknown): readonly NimiRuntimeLocalTransferAction[] {
  if (!Array.isArray(values)) {
    return Object.freeze([]);
  }
  const actions: NimiRuntimeLocalTransferAction[] = [];
  for (const value of values) {
    const action = typeof value === 'number'
      ? TRANSFER_ACTION_BY_ENUM[value]
      : TRANSFER_ACTION_BY_ENUM[Number(value)]
        ?? normalizeNamedTransferAction(value);
    if (action && !actions.includes(action)) {
      actions.push(action);
    }
  }
  return Object.freeze(actions);
}

function normalizeNamedTransferAction(value: unknown): NimiRuntimeLocalTransferAction | undefined {
  const normalized = normalizeText(value).toLowerCase().replace(/^local_transfer_action_/, '');
  switch (normalized) {
    case 'pause':
    case 'resume':
    case 'cancel':
    case 'reimport':
    case 'check_sync':
    case 'view_related_transfer':
      return normalized;
    default:
      return undefined;
  }
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
