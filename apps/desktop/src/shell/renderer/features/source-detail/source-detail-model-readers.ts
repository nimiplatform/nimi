import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailVoiceDesign, SourceDetailVoiceSample } from './source-detail-model.js';

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

export function readVoiceDesign(record: JsonObject | null | undefined): SourceDetailVoiceDesign | null {
  const voiceId = readOptionalString(record, 'voiceId');
  const sampleUri = readOptionalString(record, 'sampleUri');
  const provider = readOptionalString(record, 'provider');
  const workflow = readOptionalString(record, 'workflow');
  const model = readOptionalString(record, 'model');
  const prompt = readOptionalString(record, 'prompt');
  const transcript = readOptionalString(record, 'transcript');
  const previewText = readOptionalString(record, 'previewText');
  const publicSampleUri = readPublicUrlValue(sampleUri);
  if (!voiceId || !publicSampleUri || !provider || !workflow || !model || !prompt || !transcript || !previewText) {
    return null;
  }
  return {
    voiceId,
    sampleUri: publicSampleUri,
    provider,
    workflow,
    model,
    prompt,
    transcript,
    previewText,
  };
}

export function readWorldStudioVoiceDesign(core: JsonObject | null | undefined): SourceDetailVoiceDesign | null {
  const authoring = parseOptionalJsonObject(core?.authoring);
  const extensions = parseOptionalJsonObject(authoring?.extensions);
  const worldStudioSettings = parseOptionalJsonObject(extensions?.worldStudioSettings);
  return readVoiceDesign(parseOptionalJsonObject(worldStudioSettings?.voice));
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

  const startYear = readYearLabel(record.startYear ?? record.fromYear ?? record.beginYear);
  const endYear = readYearLabel(record.endYear ?? record.toYear);
  if (startYear && endYear && startYear !== endYear) {
    return `${startYear}-${endYear}`;
  }
  return startYear ?? endYear;
}

export function readTimeLabelFromText(value: string | null | undefined): string | null {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const parenthesizedYear = text.match(/[（(](\d{3,4}(?:\s*[-–—]\s*\d{1,4})?)[）)]/u);
  if (parenthesizedYear?.[1]) {
    return parenthesizedYear[1].replace(/\s+/gu, '');
  }
  const yearText = text.match(/(\d{3,4})\s*年/u);
  return yearText?.[1] ?? null;
}

export function readMilestoneTimeLabel(
  records: readonly (JsonObject | null | undefined)[],
  fallbackTexts: readonly (string | null | undefined)[],
): string | null {
  for (const record of records) {
    const label = readExplicitTimeLabel(record);
    if (label) {
      return label;
    }
  }
  for (const text of fallbackTexts) {
    const label = readTimeLabelFromText(text);
    if (label) {
      return label;
    }
  }
  return null;
}

export function readPublicMediaAsset(value: unknown): JsonObject | null {
  const record = parseOptionalJsonObject(value);
  const id = readScalarString(record?.id);
  const kind = readScalarString(record?.kind);
  const url = readPublicUrlValue(record?.url);
  if (!id || !kind || !url) {
    return null;
  }
  return {
    ...record,
    id,
    kind,
    url,
  };
}

export function readSourceMediaAsset(raw: JsonObject, kind: string): JsonObject | null {
  const media = parseOptionalJsonObject(raw.media);
  const assets = parseOptionalJsonObject(media?.assets) ?? parseOptionalJsonObject(raw.mediaAssets);
  return readPublicMediaAsset(assets?.[kind]);
}

export function readSourceMediaUrl(raw: JsonObject, kind: string, scalarKey: string): string | null {
  const asset = readSourceMediaAsset(raw, kind);
  const assetUrl = readPublicUrlValue(asset?.url);
  if (assetUrl) {
    return assetUrl;
  }
  const media = parseOptionalJsonObject(raw.media);
  return readPublicUrlValue(media?.[scalarKey]) ?? readPublicUrlValue(raw[scalarKey]);
}

export function readVoiceSample(raw: JsonObject): SourceDetailVoiceSample | null {
  const asset = readSourceMediaAsset(raw, 'voiceSample');
  const media = parseOptionalJsonObject(raw.media);
  const url = readPublicUrlValue(asset?.url)
    ?? readPublicUrlValue(media?.voiceSampleUrl)
    ?? readPublicUrlValue(raw.voiceSampleUrl);
  const id = readScalarString(asset?.id) ?? readScalarString(raw.voiceSampleId);
  if (!id || !url) {
    return null;
  }
  const provenance = parseOptionalJsonObject(asset?.provenance);
  return {
    id,
    url,
    provider: readScalarString(asset?.provider),
    mimeType: readScalarString(asset?.mimeType),
    durationSec: readFiniteNumber(asset?.durationSec),
    sha256: readScalarString(asset?.sha256),
    transcript: readScalarString(asset?.transcript) ?? readScalarString(provenance?.transcript),
    previewText: readScalarString(asset?.previewText) ?? readScalarString(provenance?.previewText),
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
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}
