import type { WorldPublicMediaAsset } from './world-detail-types.js';

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export function readStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readPublicUrlValue(value: unknown): string {
  const normalized = readStringValue(value);
  return /^https?:\/\//i.test(normalized) ? normalized : '';
}

export function readString(record: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = readStringValue(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

export function readNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => readStringValue(item)).filter(Boolean)
    : [];
}

export function readRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item) => Object.keys(item).length > 0)
    : [];
}

export function readPublicMediaAsset(value: unknown): WorldPublicMediaAsset | null {
  const record = asRecord(value);
  const id = readString(record, 'id');
  const kind = readString(record, 'kind');
  const url = readPublicUrlValue(record.url);
  if (!id || !kind || !url) {
    return null;
  }
  return {
    id,
    kind,
    url,
    provider: readString(record, 'provider') || null,
    mimeType: readString(record, 'mimeType') || null,
    width: readNumber(record.width) ?? null,
    height: readNumber(record.height) ?? null,
    durationSec: readNumber(record.durationSec) ?? null,
    sha256: readString(record, 'sha256') || null,
    provenance: Object.keys(asRecord(record.provenance)).length > 0
      ? asRecord(record.provenance)
      : null,
  };
}

export function formatMixedLabel(source: string): string {
  return String(source || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
