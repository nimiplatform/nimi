import type { SharedV3ProviderMetadata } from '@ai-sdk/provider';
import type { NimiJsonObject, NimiJsonValue } from '@nimiplatform/sdk/contracts';

export function toVercelTopLevelProviderMetadata(raw: NimiJsonValue | undefined): SharedV3ProviderMetadata | undefined {
  const providerMetadata = rawObjectField(raw, 'providerMetadata');
  if (!providerMetadata || Object.keys(providerMetadata).length === 0) {
    return undefined;
  }
  return providerMetadata as unknown as SharedV3ProviderMetadata;
}

export function toVercelRequestMetadata(raw: NimiJsonValue | undefined): { body?: unknown } | undefined {
  const rawObject = rawRecord(raw);
  if (!rawObject || !Object.prototype.hasOwnProperty.call(rawObject, 'requestBody')) {
    return undefined;
  }
  return { body: rawObject.requestBody };
}

export function toVercelResponseMetadata(raw: NimiJsonValue | undefined): {
  id?: string;
  modelId?: string;
  headers?: Record<string, string>;
  body?: unknown;
} | undefined {
  const rawObject = rawRecord(raw);
  if (!rawObject) {
    return undefined;
  }
  const id = rawStringField(rawObject, 'responseId') ?? rawStringField(rawObject, 'traceId');
  const modelId = rawStringField(rawObject, 'responseModelId') ?? rawStringField(rawObject, 'modelResolved');
  const headers = rawStringRecordField(rawObject, 'responseHeaders');
  const hasBody = Object.prototype.hasOwnProperty.call(rawObject, 'responseBody');
  if (!id && !modelId && !headers && !hasBody) {
    return undefined;
  }
  return {
    ...(id ? { id } : {}),
    ...(modelId ? { modelId } : {}),
    ...(headers ? { headers } : {}),
    ...(hasBody ? { body: rawObject.responseBody } : {}),
  };
}

function rawObjectField(raw: NimiJsonValue | undefined, key: string): NimiJsonObject | undefined {
  const rawObject = rawRecord(raw);
  const value = rawObject?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as NimiJsonObject;
}

function rawStringRecordField(rawObject: Record<string, NimiJsonValue>, key: string): Record<string, string> | undefined {
  const value = rawObject[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function rawStringField(rawObject: Record<string, NimiJsonValue>, key: string): string | undefined {
  const value = rawObject[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function rawRecord(raw: NimiJsonValue | undefined): Record<string, NimiJsonValue> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  return raw as Record<string, NimiJsonValue>;
}
