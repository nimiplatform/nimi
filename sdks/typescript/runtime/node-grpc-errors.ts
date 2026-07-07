import type { ServiceError } from '@grpc/grpc-js';
import { asNimiError } from '../types';
import type {
  CoreResponseMetadata,
  JsonObject,
  NimiError,
} from '../types';

type GrpcModule = typeof import('@grpc/grpc-js');

export type GrpcMetadataLike = { get(key: string): (string | Buffer)[] };
export type GrpcStatusLike = { metadata?: GrpcMetadataLike };

export class RuntimeNodeGrpcTransportError extends Error {
  readonly code: string;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly traceId: string;
  readonly retryable: boolean;
  readonly source = 'runtime';
  readonly details?: JsonObject;

  constructor(
    code: string,
    message: string,
    details?: JsonObject,
    fields: {
      readonly reasonCode?: string;
      readonly actionHint?: string;
      readonly traceId?: string;
      readonly retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'RuntimeNodeGrpcTransportError';
    this.code = code;
    this.reasonCode = fields.reasonCode ?? code;
    this.actionHint = fields.actionHint ?? 'check_runtime_endpoint_and_network';
    this.traceId = fields.traceId ?? '';
    this.retryable = Boolean(fields.retryable);
    this.details = details;
  }
}

const RUNTIME_RESPONSE_METADATA_HEADERS = [
  'x-nimi-runtime-version',
  'x-nimi-voice-catalog-source',
  'x-nimi-voice-catalog-version',
  'x-nimi-voice-count',
  'x-nimi-route-describe-result',
] as const;

export function collectResponseMetadata(metadata: GrpcMetadataLike): CoreResponseMetadata {
  const result: Record<string, string> = {};
  for (const key of RUNTIME_RESPONSE_METADATA_HEADERS) {
    const values = metadata.get(key);
    if (values.length > 0) {
      const value = String(values[0] || '').trim();
      if (value) {
        result[key] = value;
      }
    }
  }
  return result;
}

export function collectStatusResponseMetadata(status: GrpcStatusLike): CoreResponseMetadata {
  return status.metadata ? collectResponseMetadata(status.metadata) : {};
}

export function emitResponseMetadata(
  observer: ((metadata: CoreResponseMetadata) => void) | undefined,
  metadata: CoreResponseMetadata,
): void {
  if (observer && Object.keys(metadata).length > 0) {
    observer(metadata);
  }
}

export function toTransportError(
  code: string,
  message: string,
  details?: JsonObject,
  fields?: ConstructorParameters<typeof RuntimeNodeGrpcTransportError>[3],
): RuntimeNodeGrpcTransportError {
  return new RuntimeNodeGrpcTransportError(code, message, details, fields);
}

export function normalizeServiceError(grpc: GrpcModule, error: ServiceError): NimiError {
  const structured = parseStructuredGrpcDetails(error);
  const retryableTransportCancelled = isRetryableTransportCancelledError(grpc, error, structured);
  const retryableByStatus = isRetryableGrpcError(grpc, error);
  const retryable = typeof structured?.retryable === 'boolean'
    ? structured.retryable
    : retryableByStatus || retryableTransportCancelled;
  const reasonCode = structured?.reasonCode || reasonCodeFromServiceError(grpc, error, structured);
  return asNimiError(structured || error, {
    reasonCode,
    actionHint: structured?.actionHint || (
      retryable ? 'retry_or_check_runtime_daemon' : 'check_request_and_app_auth'
    ),
    traceId: structured?.traceId,
    retryable,
    source: 'runtime',
    details: {
      grpcCode: error.code,
      grpcDetails: String(error.details || '').trim(),
    },
  });
}

function isRetryableGrpcError(grpc: GrpcModule, error: ServiceError): boolean {
  return error.code === grpc.status.UNAVAILABLE
    || error.code === grpc.status.DEADLINE_EXCEEDED
    || error.code === grpc.status.RESOURCE_EXHAUSTED
    || error.code === grpc.status.ABORTED;
}

function isRetryableTransportCancelledError(
  grpc: GrpcModule,
  error: ServiceError,
  structured?: { readonly reasonCode?: string } | null,
): boolean {
  if (error.code !== grpc.status.CANCELLED || structured?.reasonCode) {
    return false;
  }
  const message = `${String(error.details || '').trim()} ${String(error.message || '').trim()}`.toLowerCase();
  return message.includes('h2 protocol error')
    || message.includes('http2 error')
    || message.includes('transport error');
}

function reasonCodeFromServiceError(
  grpc: GrpcModule,
  error: ServiceError,
  structured?: { readonly reasonCode?: string } | null,
): string {
  if (isRetryableTransportCancelledError(grpc, error, structured)) {
    return 'RUNTIME_GRPC_UNAVAILABLE';
  }
  const details = String(error.details || '').trim();
  const prefixedReasonFromDetails = parseReasonCodeFromText(details);
  if (prefixedReasonFromDetails) {
    return prefixedReasonFromDetails;
  }
  const prefixedReasonFromMessage = parseReasonCodeFromText(error.message);
  if (prefixedReasonFromMessage) {
    return prefixedReasonFromMessage;
  }
  if (details && /^[A-Z0-9_]+$/.test(details)) {
    return details;
  }
  const codeName = grpc.status[error.code] || 'UNKNOWN';
  return `RUNTIME_GRPC_${String(codeName).toUpperCase()}`;
}

function parseReasonCodeFromText(input: unknown): string {
  return String(input || '').trim().match(/^([A-Z0-9_]+):/)?.[1] ?? '';
}

function parseStructuredGrpcDetails(error: ServiceError): {
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly traceId?: string;
  readonly retryable?: boolean;
  readonly message?: string;
} | null {
  const record = parseJsonObject(String(error.details || '').trim())
    ?? parseJsonObject(String(error.message || '').trim())
    ?? parseEmbeddedJsonObject(String(error.details || '').trim())
    ?? parseEmbeddedJsonObject(String(error.message || '').trim());
  if (!record) {
    return null;
  }
  const reasonCode = readString(record, ['reasonCode', 'reason_code']);
  const actionHint = readString(record, ['actionHint', 'action_hint']);
  const traceId = readString(record, ['traceId', 'trace_id']);
  const message = readString(record, ['message']);
  const retryable = typeof record.retryable === 'boolean' ? record.retryable : undefined;
  if (!reasonCode && !actionHint && !traceId && typeof retryable !== 'boolean') {
    return null;
  }
  return {
    reasonCode: reasonCode || undefined,
    actionHint: actionHint || undefined,
    traceId: traceId || undefined,
    retryable,
    message: message || undefined,
  };
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = String(record[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function parseJsonObject(input: string): Record<string, unknown> | null {
  const text = String(input || '').trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseEmbeddedJsonObject(input: string): Record<string, unknown> | null {
  const text = String(input || '').trim();
  const firstBraceIndex = text.indexOf('{');
  const lastBraceIndex = text.lastIndexOf('}');
  if (firstBraceIndex < 0 || lastBraceIndex <= firstBraceIndex) {
    return null;
  }
  return parseJsonObject(text.slice(firstBraceIndex, lastBraceIndex + 1));
}
