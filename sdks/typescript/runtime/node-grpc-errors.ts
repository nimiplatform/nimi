import type { ServiceError } from '@grpc/grpc-js';
import { BinaryReader, WireType } from '@protobuf-ts/runtime';
import {
  ExecutionInterruption as RuntimeExecutionInterruption,
  ExecutionInterruptionCause,
  ExecutionResubmitDisposition,
} from '../core-generated/runtime-protobuf/runtime/v1/ai.js';
import { asNimiError } from '../types';
import type {
  CoreResponseMetadata,
  JsonObject,
  NimiError,
  NimiExecutionInterruption,
} from '../types';

type GrpcModule = typeof import('@grpc/grpc-js');

export type GrpcMetadataLike = { get(key: string): (string | Buffer)[] };
export type GrpcStatusLike = { metadata?: GrpcMetadataLike };

type StructuredGrpcDetails = {
  readonly reasonCode: string;
  readonly actionHint?: string;
  readonly traceId?: string;
  readonly retryable?: boolean;
  readonly message?: string;
  readonly interruption?: NimiExecutionInterruption;
};

type ParsedGrpcStatusDetail =
  | { readonly kind: 'error-info'; readonly value: Omit<StructuredGrpcDetails, 'message' | 'interruption'> }
  | { readonly kind: 'execution-interruption'; readonly value: NimiExecutionInterruption };

const GRPC_STATUS_DETAILS_BIN = 'grpc-status-details-bin';
const GOOGLE_RPC_ERROR_INFO_TYPE_URL = 'type.googleapis.com/google.rpc.ErrorInfo';
const NIMI_EXECUTION_INTERRUPTION_TYPE_URL = 'type.googleapis.com/nimi.runtime.v1.ExecutionInterruption';
const NIMI_RUNTIME_ERROR_INFO_DOMAIN = 'nimi.runtime.v1';
const MAX_STATUS_DETAILS_BYTES = 64 * 1024;
const MAX_STATUS_MESSAGE_BYTES = 2 * 1024;
const MAX_ANY_DETAILS = 16;
const MAX_ANY_BYTES = 32 * 1024;
const MAX_ERROR_INFO_METADATA_ENTRIES = 32;
const MAX_ERROR_INFO_REASON_BYTES = 128;
const MAX_ERROR_INFO_DOMAIN_BYTES = 128;
const MAX_ERROR_INFO_METADATA_KEY_BYTES = 64;
const MAX_ERROR_INFO_METADATA_VALUE_BYTES = 2 * 1024;
const MAX_ACTION_HINT_LENGTH = 256;
const MAX_TRACE_ID_LENGTH = 128;
const PROTOBUF_TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

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
    : structured?.interruption?.resubmitDisposition === 'caller-may-resubmit'
      || retryableByStatus || retryableTransportCancelled;
  const reasonCode = structured?.reasonCode || reasonCodeFromServiceError(grpc, error, structured);
  const actionHint = structured?.actionHint || (
    retryable ? 'retry_or_check_runtime_daemon' : 'check_request_and_app_auth'
  );
  return asNimiError({
    message: structured
      ? (structured.message || reasonCode)
      : (
          String(error.details || '').trim()
          || String(error.message || '').trim()
          || reasonCode
        ),
    reasonCode,
    actionHint,
    traceId: structured?.traceId,
    retryable,
  }, {
    reasonCode,
    actionHint,
    traceId: structured?.traceId,
    retryable,
    interruption: structured?.interruption,
    source: 'runtime',
    details: {
      grpcCode: error.code,
      grpcDetails: String(error.details || '').trim(),
      ...(structured?.interruption ? {
        interruption: {
          cause: structured.interruption.cause,
          resubmitDisposition: structured.interruption.resubmitDisposition,
        },
      } : {}),
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
  const codeName = grpc.status[error.code] || 'UNKNOWN';
  return `RUNTIME_GRPC_${String(codeName).toUpperCase()}`;
}

function parseStructuredGrpcDetails(error: ServiceError): StructuredGrpcDetails | null {
  let values: (string | Buffer)[];
  try {
    values = error.metadata?.get(GRPC_STATUS_DETAILS_BIN) ?? [];
  } catch {
    return null;
  }
  if (values.length !== 1 || !Buffer.isBuffer(values[0])) {
    return null;
  }
  const bytes = values[0];
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_STATUS_DETAILS_BYTES) {
    return null;
  }
  try {
    return parseGoogleRpcStatus(bytes, error.code);
  } catch {
    return null;
  }
}

function parseGoogleRpcStatus(bytes: Uint8Array, expectedCode: number): StructuredGrpcDetails | null {
  const reader = new BinaryReader(bytes);
  let statusCode: number | undefined;
  let message = '';
  let messageSeen = false;
  let detailCount = 0;
  let errorInfo: Omit<StructuredGrpcDetails, 'message'> | null = null;
  let interruption: NimiExecutionInterruption | undefined;

  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        requireWireType(wireType, WireType.Varint);
        if (statusCode !== undefined) {
          throw new Error('duplicate google.rpc.Status code');
        }
        statusCode = reader.int32();
        break;
      case 2:
        requireWireType(wireType, WireType.LengthDelimited);
        if (messageSeen) {
          throw new Error('duplicate google.rpc.Status message');
        }
        message = readBoundedString(reader, MAX_STATUS_MESSAGE_BYTES).trim();
        messageSeen = true;
        break;
      case 3: {
        requireWireType(wireType, WireType.LengthDelimited);
        detailCount += 1;
        if (detailCount > MAX_ANY_DETAILS) {
          throw new Error('too many google.rpc.Status details');
        }
        const anyBytes = readBoundedBytes(reader, MAX_ANY_BYTES);
        const candidate = parseGoogleProtobufAny(anyBytes);
        if (candidate?.kind === 'error-info') {
          if (errorInfo) {
            throw new Error('duplicate nimi.runtime.v1 ErrorInfo');
          }
          errorInfo = candidate.value;
        } else if (candidate?.kind === 'execution-interruption') {
          if (interruption) {
            throw new Error('duplicate nimi.runtime.v1 ExecutionInterruption');
          }
          interruption = candidate.value;
        }
        break;
      }
      default:
        reader.skip(wireType);
    }
  }

  if (statusCode !== expectedCode || !errorInfo) {
    return null;
  }
  if ((errorInfo.reasonCode === 'AI_EXECUTION_INTERRUPTED') !== Boolean(interruption)) {
    throw new Error('Runtime interruption reason/detail pair is incomplete or conflicting');
  }
  return {
    ...errorInfo,
    message: publicStatusMessage(message) || undefined,
    ...(interruption ? { interruption } : {}),
  };
}

function publicStatusMessage(input: string): string {
  const text = input.trim();
  if (!text.startsWith('{')) {
    return text;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return '';
    }
    const message = (parsed as Record<string, unknown>).message;
    if (typeof message !== 'string') {
      return '';
    }
    const normalized = message.trim();
    if (
      !normalized
      || Buffer.byteLength(normalized, 'utf8') > MAX_STATUS_MESSAGE_BYTES
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
    ) {
      return '';
    }
    return normalized;
  } catch {
    return '';
  }
}

function parseGoogleProtobufAny(bytes: Uint8Array): ParsedGrpcStatusDetail | null {
  const reader = new BinaryReader(bytes);
  let typeUrl = '';
  let typeUrlSeen = false;
  let value: Uint8Array | undefined;

  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        requireWireType(wireType, WireType.LengthDelimited);
        if (typeUrlSeen) {
          throw new Error('duplicate google.protobuf.Any type_url');
        }
        typeUrl = readBoundedString(reader, 256);
        typeUrlSeen = true;
        break;
      case 2:
        requireWireType(wireType, WireType.LengthDelimited);
        if (value) {
          throw new Error('duplicate google.protobuf.Any value');
        }
        value = readBoundedBytes(reader, MAX_ANY_BYTES);
        break;
      default:
        reader.skip(wireType);
    }
  }

  if (!value) {
    throw new Error('google.protobuf.Any value is missing');
  }
  if (typeUrl === GOOGLE_RPC_ERROR_INFO_TYPE_URL) {
    const errorInfo = parseGoogleRpcErrorInfo(value);
    return errorInfo ? { kind: 'error-info', value: errorInfo } : null;
  }
  if (typeUrl === NIMI_EXECUTION_INTERRUPTION_TYPE_URL) {
    return { kind: 'execution-interruption', value: parseRuntimeExecutionInterruption(value) };
  }
  return null;
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r122
function parseRuntimeExecutionInterruption(bytes: Uint8Array): NimiExecutionInterruption {
  const interruption = RuntimeExecutionInterruption.fromBinary(bytes);
  if (interruption.cause !== ExecutionInterruptionCause.RUNTIME_RESTART
    || interruption.resubmitDisposition !== ExecutionResubmitDisposition.CALLER_MAY_RESUBMIT) {
    throw new Error('invalid nimi.runtime.v1 ExecutionInterruption');
  }
  return { cause: 'runtime-restart', resubmitDisposition: 'caller-may-resubmit' };
}

function parseGoogleRpcErrorInfo(bytes: Uint8Array): Omit<StructuredGrpcDetails, 'message'> | null {
  const reader = new BinaryReader(bytes);
  let reason = '';
  let reasonSeen = false;
  let domain = '';
  let domainSeen = false;
  let metadataCount = 0;
  const metadata = new Map<string, string>();

  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        requireWireType(wireType, WireType.LengthDelimited);
        if (reasonSeen) {
          throw new Error('duplicate google.rpc.ErrorInfo reason');
        }
        reason = readBoundedString(reader, MAX_ERROR_INFO_REASON_BYTES);
        reasonSeen = true;
        break;
      case 2:
        requireWireType(wireType, WireType.LengthDelimited);
        if (domainSeen) {
          throw new Error('duplicate google.rpc.ErrorInfo domain');
        }
        domain = readBoundedString(reader, MAX_ERROR_INFO_DOMAIN_BYTES);
        domainSeen = true;
        break;
      case 3: {
        requireWireType(wireType, WireType.LengthDelimited);
        metadataCount += 1;
        if (metadataCount > MAX_ERROR_INFO_METADATA_ENTRIES) {
          throw new Error('too many google.rpc.ErrorInfo metadata entries');
        }
        const [key, value] = parseGoogleRpcErrorInfoMetadataEntry(
          readBoundedBytes(reader, MAX_ERROR_INFO_METADATA_VALUE_BYTES + MAX_ERROR_INFO_METADATA_KEY_BYTES + 16),
        );
        if (metadata.has(key)) {
          throw new Error('duplicate google.rpc.ErrorInfo metadata key');
        }
        metadata.set(key, value);
        break;
      }
      default:
        reader.skip(wireType);
    }
  }

  if (domain !== NIMI_RUNTIME_ERROR_INFO_DOMAIN) {
    return null;
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(reason)) {
    throw new Error('invalid nimi.runtime.v1 ErrorInfo reason');
  }

  const actionHint = readBoundedMetadataText(metadata, 'action_hint', MAX_ACTION_HINT_LENGTH);
  const traceId = readBoundedMetadataText(metadata, 'trace_id', MAX_TRACE_ID_LENGTH);
  const retryableText = metadata.get('retryable');
  let retryable: boolean | undefined;
  if (retryableText !== undefined) {
    if (retryableText !== 'true' && retryableText !== 'false') {
      throw new Error('invalid nimi.runtime.v1 ErrorInfo retryable value');
    }
    retryable = retryableText === 'true';
  }

  return {
    reasonCode: reason,
    actionHint: actionHint || undefined,
    traceId: traceId || undefined,
    retryable,
  };
}

function parseGoogleRpcErrorInfoMetadataEntry(bytes: Uint8Array): readonly [string, string] {
  const reader = new BinaryReader(bytes);
  let key = '';
  let keySeen = false;
  let value = '';
  let valueSeen = false;

  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        requireWireType(wireType, WireType.LengthDelimited);
        if (keySeen) {
          throw new Error('duplicate google.rpc.ErrorInfo metadata key field');
        }
        key = readBoundedString(reader, MAX_ERROR_INFO_METADATA_KEY_BYTES);
        keySeen = true;
        break;
      case 2:
        requireWireType(wireType, WireType.LengthDelimited);
        if (valueSeen) {
          throw new Error('duplicate google.rpc.ErrorInfo metadata value field');
        }
        value = readBoundedString(reader, MAX_ERROR_INFO_METADATA_VALUE_BYTES);
        valueSeen = true;
        break;
      default:
        reader.skip(wireType);
    }
  }

  if (!keySeen || !valueSeen || !key || !value) {
    throw new Error('invalid google.rpc.ErrorInfo metadata entry');
  }
  return [key, value];
}

function readBoundedMetadataText(
  metadata: ReadonlyMap<string, string>,
  key: string,
  maxLength: number,
): string {
  const value = metadata.get(key);
  if (value === undefined) {
    return '';
  }
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`invalid nimi.runtime.v1 ErrorInfo ${key}`);
  }
  return normalized;
}

function readBoundedBytes(reader: BinaryReader, maxBytes: number): Uint8Array {
  const value = reader.bytes();
  if (value.byteLength > maxBytes) {
    throw new Error('protobuf field exceeds size bound');
  }
  return value;
}

function readBoundedString(reader: BinaryReader, maxBytes: number): string {
  return PROTOBUF_TEXT_DECODER.decode(readBoundedBytes(reader, maxBytes));
}

function requireWireType(actual: WireType, expected: WireType): void {
  if (actual !== expected) {
    throw new Error('unexpected protobuf wire type');
  }
}
