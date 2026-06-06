import type {
  RuntimeCallerKind,
  RuntimeMetadata,
  RuntimeStreamCallOptions,
} from './types.js';
import { createNimiClientId } from '../core/ids.js';

export type RuntimeTraceIdFactory = (prefix?: string) => string;

export type RuntimeRequestMetadataInput = {
  connectorId?: string;
  traceId?: string;
  traceIdPrefix?: string;
  createTraceId?: RuntimeTraceIdFactory;
};

export type RuntimeTargetCallOptionsInput = RuntimeRequestMetadataInput & {
  targetId: string;
  timeoutMs: number;
  callerKind: RuntimeCallerKind;
  surfaceId: string;
  callerIdPrefix?: string;
  idempotencyKey?: string;
  idempotencyKeyPrefix?: string;
  signal?: AbortSignal;
};

export type RuntimeTargetCallOptions = RuntimeStreamCallOptions & {
  idempotencyKey: string;
  timeoutMs: number;
  metadata: RuntimeMetadata & {
    traceId: string;
    callerKind: RuntimeCallerKind;
    callerId: string;
    surfaceId: string;
    keySource?: 'managed';
  };
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createRuntimeTraceId(prefix = 'runtime-call'): string {
  const normalizedPrefix = normalizeText(prefix) || 'runtime-call';
  return createNimiClientId(normalizedPrefix);
}

function resolveTraceId(input: RuntimeRequestMetadataInput): string {
  const explicit = normalizeText(input.traceId);
  if (explicit) {
    return explicit;
  }
  return (input.createTraceId || createRuntimeTraceId)(input.traceIdPrefix || 'runtime-call');
}

export function buildRuntimeRequestMetadata(input: RuntimeRequestMetadataInput = {}): Record<string, string> {
  const traceId = resolveTraceId(input);
  return {
    traceId,
    'x-nimi-trace-id': traceId,
    ...(normalizeText(input.connectorId) ? { keySource: 'managed' } : {}),
  };
}

export function buildRuntimeTargetCallOptions(input: RuntimeTargetCallOptionsInput): RuntimeTargetCallOptions {
  const normalizedTargetId = normalizeText(input.targetId);
  const callerIdPrefix = normalizeText(input.callerIdPrefix) || 'target';
  const traceId = resolveTraceId(input);
  const idempotencyKey = normalizeText(input.idempotencyKey)
    || (input.createTraceId || createRuntimeTraceId)(input.idempotencyKeyPrefix || 'runtime-idem');
  return {
    idempotencyKey,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    metadata: {
      traceId,
      callerKind: input.callerKind,
      callerId: `${callerIdPrefix}:${normalizedTargetId || 'unknown'}`,
      surfaceId: input.surfaceId,
      ...(normalizeText(input.connectorId) ? { keySource: 'managed' as const } : {}),
    },
  };
}
