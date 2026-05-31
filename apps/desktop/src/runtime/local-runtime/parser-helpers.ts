import { fromProtoStruct } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { emitRuntimeLog } from '../telemetry/logger';
import type { LocalRuntimeWriteOptions } from './types';
import { asString } from './parser-primitives';

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

  emitRuntimeLog({
    level: 'warn',
    area: 'local-ai-runtime-audit',
    message: 'fallback:local-lifecycle-write-denied',
    details: {
      command,
      caller: normalizedCaller,
      decision: 'DENY',
      reasonCode: ReasonCode.LOCAL_LIFECYCLE_WRITE_DENIED,
    },
  });
  throw new Error(`LOCAL_LIFECYCLE_WRITE_DENIED: caller=${normalizedCaller}`);
}
