import type { JsonValue as ProtoJsonValue } from '@protobuf-ts/runtime';
import type { Struct } from '../core-generated/runtime-protobuf/google/protobuf/struct';
import { Struct as RuntimeStruct } from '../core-generated/runtime-protobuf/google/protobuf/struct';
import type { JsonObject } from '../types';
import type { Timestamp } from '../core-generated/runtime-protobuf/google/protobuf/timestamp';

export function normalizeNimiRuntimeAgentText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function toNimiRuntimeTimestamp(value: Date | string | number): Timestamp {
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  if (!Number.isFinite(millis)) {
    return { seconds: '0', nanos: 0 };
  }
  return {
    seconds: String(Math.floor(millis / 1000)),
    nanos: (millis % 1000) * 1_000_000,
  };
}

export function toNimiRuntimeIsoFromTimestamp(value?: Timestamp | null): string | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value.seconds);
  const nanos = Number(value.nanos);
  if (!Number.isFinite(seconds)) {
    return null;
  }
  const millis = (seconds * 1000) + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toNimiRuntimeProtoStruct(value: JsonObject): Struct {
  return RuntimeStruct.fromJson(value as ProtoJsonValue);
}

export function fromNimiRuntimeProtoStruct(value?: Struct | null): JsonObject {
  if (!value) {
    return {};
  }
  const json = RuntimeStruct.toJson(value);
  return json && typeof json === 'object' && !Array.isArray(json)
    ? json as JsonObject
    : {};
}
