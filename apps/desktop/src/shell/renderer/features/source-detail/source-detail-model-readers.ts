import { readMediaDelivery } from '@nimiplatform/kit/features/media/headless';
import { readPublicAssetDto } from '../world/data/world-public-projection.js';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailVoiceSample } from './source-detail-model.js';

export function readOptionalString(record: JsonObject | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readPublicUrlValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

export function readExternalAssetUri(core: JsonObject | null | undefined, kinds: readonly string[]): string | null {
  const assets = parseOptionalJsonObject(core?.assets);
  const refs = Array.isArray(assets?.externalRefs) ? assets.externalRefs : [];
  for (const ref of refs) {
    const record = parseOptionalJsonObject(ref);
    const kind = readOptionalString(record, 'kind');
    if (kind && kinds.includes(kind)) {
      const uri = readOptionalString(record, 'uri');
      if (readPublicUrlValue(uri)) return uri;
    }
  }
  return null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

export function readScalarString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readYearLabel(value: unknown): string | null {
  const numeric = readFiniteNumber(value);
  if (numeric !== null) {
    return String(Math.trunc(numeric));
  }
  const scalar = readScalarString(value);
  if (!scalar) {
    return null;
  }
  const yearMatch = scalar.match(/\d{3,4}/u);
  return yearMatch?.[0] ?? scalar;
}

export function readExplicitTimeLabel(record: JsonObject | null | undefined): string | null {
  if (!record) {
    return null;
  }
  for (const key of ['timeLabel', 'timeRef', 'time', 'happenedAt', 'timestamp', 'eventTime', 'dateLabel', 'date']) {
    const value = readScalarString(record[key]);
    if (value) {
      return value;
    }
  }

  const year = readYearLabel(record.year);
  if (year) {
    return year;
  }

  const startYear = readYearLabel(
    record.startYear ?? record.fromYear ?? record.beginYear ?? record.firstYear,
  );
  const endYear = readYearLabel(record.endYear ?? record.toYear ?? record.lastYear);
  if (startYear && endYear && startYear !== endYear) {
    return `${startYear}-${endYear}`;
  }
  return startYear ?? endYear;
}

// Time labels come only from explicit time fields; titles and summaries are
// authored prose and are never parsed for dates.
export function readMilestoneTimeLabel(
  records: readonly (JsonObject | null | undefined)[],
): string | null {
  for (const record of records) {
    const label = readExplicitTimeLabel(record);
    if (label) {
      return label;
    }
  }
  return null;
}

export const readPublicMediaAsset = readPublicAssetDto;

export function readSourceMediaAsset(raw: JsonObject, kind: string) {
  const media = parseOptionalJsonObject(raw.media);
  const assets = parseOptionalJsonObject(media?.assets) ?? parseOptionalJsonObject(raw.mediaAssets);
  return readPublicMediaAsset(assets?.[kind]);
}

export function readSourceMediaDelivery(raw: JsonObject, kind: string) {
  return readMediaDelivery(readSourceMediaAsset(raw, kind)?.delivery);
}

export function readSourceMediaUrl(raw: JsonObject, kind: string, scalarKey: string): string | null {
  const asset = readSourceMediaAsset(raw, kind);
  if (asset?.delivery) return null;
  const media = parseOptionalJsonObject(raw.media);
  const external = parseOptionalJsonObject(media?.external);
  return readPublicUrlValue(asset?.externalUrl) ?? readPublicUrlValue(external?.[scalarKey]) ?? readPublicUrlValue(raw[scalarKey]);
}

export function readVoiceSample(raw: JsonObject): SourceDetailVoiceSample | null {
  const asset = readSourceMediaAsset(raw, 'voiceSample');
  const previewUrl = asset?.delivery?.previewUrl ?? readSourceMediaUrl(raw, 'voiceSample', 'voiceSampleUrl');
  if (!asset?.id || !previewUrl) return null;
  const provenance = parseOptionalJsonObject(asset.provenance);
  return {
    id: asset.id, previewUrl,
    originalUrl: asset.delivery?.originalUrl ?? null,
    durationSec: readFiniteNumber(asset.durationSec),
    transcript: readScalarString(provenance?.transcript),
    previewText: readScalarString(provenance?.previewText),
  };
}

export function readPath(record: JsonObject | null | undefined, path: readonly string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    const next = parseOptionalJsonObject(current);
    if (!next) {
      return undefined;
    }
    current = next[key];
  }
  return current;
}

export function readRecordArray(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.map(parseOptionalJsonObject).filter((item): item is JsonObject => Boolean(item));
  }
  const record = parseOptionalJsonObject(value);
  return record ? Object.values(record).map(parseOptionalJsonObject).filter((item): item is JsonObject => Boolean(item)) : [];
}

export function slug(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}
