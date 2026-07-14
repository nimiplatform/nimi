import { createNimiError } from '../types';

export type UnknownRecord = Readonly<Record<string, unknown>>;

export function projectionError(message: string): never {
  throw createNimiError({
    message: `Runtime Agent bounded context projection ${message}.`,
    reasonCode: 'SDK_RUNTIME_AGENT_CONTEXT_PROJECTION_INVALID',
    actionHint: 'check_runtime_agent_bounded_context_projection',
    source: 'sdk',
  });
}

export function record(value: unknown, label: string, allowed: ReadonlySet<string>): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    projectionError(`${label} must be an object`);
  }
  const result = value as UnknownRecord;
  const unknown = Object.keys(result).find((key) => !allowed.has(key));
  if (unknown) projectionError(`${label}.${unknown} is not admitted`);
  return result;
}

export function aliased(input: UnknownRecord, camel: string, snake: string): unknown {
  if (camel === snake) return input[camel];
  const hasCamel = Object.prototype.hasOwnProperty.call(input, camel);
  const hasSnake = Object.prototype.hasOwnProperty.call(input, snake);
  if (hasCamel && hasSnake) projectionError(`${camel} is duplicated through aliases`);
  return hasCamel ? input[camel] : input[snake];
}

export function exactText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    projectionError(`${label} must be a non-empty canonical string`);
  }
  return value;
}

export function optionalExactText(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return exactText(value, label);
}

export function digest(value: unknown, label: string): string {
  const result = exactText(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) projectionError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

export function optionalDigest(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return digest(value, label);
}

export function uint32(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    projectionError(`${label} must be a uint32`);
  }
  return value;
}

export function uint32Default(value: unknown, label: string): number {
  return value === undefined || value === null ? 0 : uint32(value, label);
}

export function uint64(value: unknown, label: string): string {
  const result = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === 'string' ? value : '';
  if (!/^(?:0|[1-9][0-9]*)$/u.test(result) || BigInt(result) > 0xffff_ffff_ffff_ffffn) {
    projectionError(`${label} must be a canonical uint64 string`);
  }
  return result;
}

export function uint64Default(value: unknown, label: string): string {
  return value === undefined || value === null ? '0' : uint64(value, label);
}

export function version(
  value: unknown,
  numeric: number,
  jsonName: string,
  label: string,
): 'v1' {
  if (value !== numeric && value !== jsonName) projectionError(`${label} is unknown or unspecified`);
  return 'v1';
}

export function enumValue<T extends string>(
  value: unknown,
  values: ReadonlyMap<unknown, T>,
  label: string,
): T {
  const result = values.get(value);
  if (!result) projectionError(`${label} is unknown or unspecified`);
  return result;
}

export function timestamp(value: unknown, label: string): string {
  if (typeof value === 'string') {
    const time = new Date(value);
    if (!value.endsWith('Z') || !Number.isFinite(time.getTime())) projectionError(`${label} is not RFC3339 UTC`);
    return time.toISOString();
  }
  const input = record(value, label, new Set(['seconds', 'nanos']));
  const seconds = uint64(input.seconds, `${label}.seconds`);
  const nanos = uint32(input.nanos, `${label}.nanos`);
  if (nanos > 999_999_999) projectionError(`${label}.nanos exceeds protobuf Timestamp range`);
  const millis = (BigInt(seconds) * 1000n) + BigInt(Math.floor(nanos / 1_000_000));
  if (millis > BigInt(Number.MAX_SAFE_INTEGER)) projectionError(`${label} exceeds JavaScript timestamp range`);
  const date = new Date(Number(millis));
  if (!Number.isFinite(date.getTime())) projectionError(`${label} is invalid`);
  return date.toISOString();
}
