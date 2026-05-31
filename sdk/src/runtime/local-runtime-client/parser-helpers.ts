import { fromProtoStruct } from '../helpers.js';
import type { LocalRuntimeWriteOptions } from './types.js';
import { asString } from './parser-primitives.js';

export function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  const record = fromProtoStruct(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

export function normalizeCaller(caller: LocalRuntimeWriteOptions['caller']): string {
  return asString(caller || 'core').toLowerCase() || 'core';
}

export function assertLifecycleWriteAllowed(
  command: string,
  caller: LocalRuntimeWriteOptions['caller'],
): void {
  const normalizedCaller = normalizeCaller(caller);
  if (normalizedCaller === 'core') return;

  throw new Error(`LOCAL_LIFECYCLE_WRITE_DENIED: caller=${normalizedCaller}`);
}
