
import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../core/errors.js';
import { Struct } from './generated/google/protobuf/struct.js';
import { asRecord, normalizeText } from './runtime-value-utils.js';

export function toProtoStruct(input: Record<string, unknown> | undefined): Struct | undefined {
  if (!input || Object.keys(input).length === 0) {
    return undefined;
  }
  try {
    return Struct.fromJson(input as never);
  } catch (error) {
    throw createNimiError({
      message: `failed to encode proto struct: ${error instanceof Error ? error.message : 'unknown error'}`,
      reasonCode: ReasonCode.SDK_RUNTIME_REQUEST_ENCODE_FAILED,
      actionHint: 'remove_non_json_extension_values',
      source: 'sdk',
    });
  }
}

function decodeProtoStructDynamic(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => decodeProtoStructDynamic(item));
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return value;
  }
  const kind = asRecord(record.kind);
  const oneofKind = normalizeText(kind.oneofKind);
  switch (oneofKind) {
    case 'nullValue':
      return null;
    case 'numberValue':
      return typeof kind.numberValue === 'number' ? kind.numberValue : Number(kind.numberValue || 0);
    case 'stringValue':
      return normalizeText(kind.stringValue);
    case 'boolValue':
      return Boolean(kind.boolValue);
    case 'structValue':
      return decodeProtoStructDynamic(kind.structValue);
    case 'listValue': {
      const values = Array.isArray(asRecord(kind.listValue).values)
        ? (asRecord(kind.listValue).values as unknown[])
        : [];
      return values.map((item) => decodeProtoStructDynamic(item));
    }
    default:
      break;
  }
  const fields = asRecord(record.fields);
  if (Object.keys(fields).length > 0 && Object.keys(record).every((key) => key === 'fields')) {
    return Object.fromEntries(
      Object.entries(fields).map(([key, entry]) => [key, decodeProtoStructDynamic(entry)]),
    );
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, decodeProtoStructDynamic(entry)]),
  );
}

export function fromProtoStruct(input: unknown): Record<string, unknown> {
  const decoded = decodeProtoStructDynamic(input);
  const record = asRecord(decoded);
  return Object.keys(record).length > 0 ? record : {};
}

export function decodeUtf8(input: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input).toString('utf8');
  }
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(input);
  }
  throw createNimiError({
    message: 'utf-8 decoder unavailable',
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'use_node_or_text_decoder_runtime',
    source: 'sdk',
  });
}
