import { asRecord } from '../internal/utils.js';
import type {
  WorldFixturePackage,
  WorldInspectVector,
  WorldInspectViewPreset,
  WorldResolvedFixtureInput,
} from './types.js';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeWorldInspectVector(
  value: unknown,
): WorldInspectVector | undefined {
  const record = asRecord(value);
  const x = normalizeNumber(record.x);
  const y = normalizeNumber(record.y);
  const z = normalizeNumber(record.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return undefined;
  }
  return {
    x: Number(x),
    y: Number(y),
    z: Number(z),
  };
}

export function normalizeWorldInspectViewPreset(
  value: unknown,
): WorldInspectViewPreset | undefined {
  const record = asRecord(value);
  const camera = asRecord(record.camera);
  const position = normalizeWorldInspectVector(camera.position);
  const target = normalizeWorldInspectVector(camera.target);
  const mode = normalizeString(record.mode);
  const source = normalizeString(record.source);
  if (!position || !target || mode !== 'inspect') {
    return undefined;
  }
  if (source !== 'manual' && source !== 'auto-collider' && source !== 'auto-splat') {
    return undefined;
  }
  return {
    version: Number(record.version || 1),
    mode: 'inspect',
    source,
    camera: {
      position,
      target,
    },
  };
}

export function normalizeWorldFixturePackage(
  value: unknown,
): WorldFixturePackage | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return null;
  }
  const spzUrlsRaw = asRecord(record.spzUrls);
  const semanticsRaw = asRecord(record.semanticsMetadata);
  const artifacts = Array.isArray(record.artifacts)
    ? record.artifacts.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
  const normalized: WorldFixturePackage = {
    manifestPath: normalizeString(record.manifestPath),
    worldId: normalizeString(record.worldId),
    displayName: normalizeString(record.displayName),
    worldMarbleUrl: normalizeString(record.worldMarbleUrl),
    caption: normalizeString(record.caption),
    thumbnailUrl: normalizeString(record.thumbnailUrl),
    panoUrl: normalizeString(record.panoUrl),
    colliderMeshUrl: normalizeString(record.colliderMeshUrl),
    spzUrls: Object.fromEntries(
      Object.entries(spzUrlsRaw)
        .map(([key, url]) => [key, normalizeString(url)])
        .filter(([, url]) => Boolean(url)),
    ),
    semanticsMetadata: Object.keys(semanticsRaw).length > 0
      ? {
        ...(normalizeNumber(semanticsRaw.groundPlaneOffset ?? semanticsRaw.ground_plane_offset) != null
          ? { groundPlaneOffset: normalizeNumber(semanticsRaw.groundPlaneOffset ?? semanticsRaw.ground_plane_offset) }
          : {}),
        ...(normalizeNumber(semanticsRaw.metricScaleFactor ?? semanticsRaw.metric_scale_factor) != null
          ? { metricScaleFactor: normalizeNumber(semanticsRaw.metricScaleFactor ?? semanticsRaw.metric_scale_factor) }
          : {}),
      }
      : undefined,
    model: normalizeString(record.model),
    spzLocalPath: normalizeString(record.spzLocalPath),
    thumbnailLocalPath: normalizeString(record.thumbnailLocalPath),
    panoLocalPath: normalizeString(record.panoLocalPath),
    colliderMeshLocalPath: normalizeString(record.colliderMeshLocalPath),
    viewerPreset: normalizeWorldInspectViewPreset(record.viewerPreset),
    artifacts,
  };
  const hasMeaningfulPayload = Boolean(
    normalized.manifestPath
      || normalized.worldId
      || normalized.displayName
      || normalized.worldMarbleUrl
      || normalized.caption
      || normalized.thumbnailUrl
      || normalized.panoUrl
      || normalized.colliderMeshUrl
      || normalized.model
      || normalized.spzLocalPath
      || normalized.thumbnailLocalPath
      || normalized.panoLocalPath
      || normalized.colliderMeshLocalPath
      || normalized.viewerPreset
      || (normalized.spzUrls && Object.keys(normalized.spzUrls).length > 0)
      || (normalized.artifacts && normalized.artifacts.length > 0)
      || (normalized.semanticsMetadata
        && (
          normalized.semanticsMetadata.groundPlaneOffset != null
          || normalized.semanticsMetadata.metricScaleFactor != null
        )),
  );
  return hasMeaningfulPayload ? normalized : null;
}

export function worldFixtureFromResolvedPaths(
  input: WorldResolvedFixtureInput,
): WorldFixturePackage | null {
  return normalizeWorldFixturePackage({
    manifestPath: input.manifestPath,
    worldId: input.worldId,
    displayName: input.displayName,
    model: input.model,
    caption: input.caption,
    worldMarbleUrl: input.worldMarbleUrl,
    spzUrls: input.spzRemoteUrl ? { cached: input.spzRemoteUrl } : {},
    thumbnailUrl: input.thumbnailRemoteUrl,
    panoUrl: input.panoRemoteUrl,
    colliderMeshUrl: input.colliderMeshRemoteUrl,
    spzLocalPath: input.spzLocalPath,
    thumbnailLocalPath: input.thumbnailLocalPath,
    panoLocalPath: input.panoLocalPath,
    colliderMeshLocalPath: input.colliderMeshLocalPath,
    semanticsMetadata: input.semanticsMetadata,
    viewerPreset: input.viewerPreset,
  });
}

export function pickWorldFixturePreviewSpzUrl(
  fixture: WorldFixturePackage | null | undefined,
): string {
  const urls = fixture?.spzUrls || {};
  for (const key of ['full_res', 'cached', 'default', 'preview']) {
    const normalized = normalizeString(urls[key]);
    if (normalized) {
      return normalized;
    }
  }
  for (const value of Object.values(urls)) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

export function resolveWorldFixtureTitle(
  fixture: WorldFixturePackage | null | undefined,
): string {
  return fixture?.displayName || fixture?.worldId || fixture?.manifestPath || 'Cached world fixture';
}

export const fixture = {
  normalize: normalizeWorldFixturePackage,
  fromResolvedPaths: worldFixtureFromResolvedPaths,
  pickPreviewSpzUrl: pickWorldFixturePreviewSpzUrl,
  title: resolveWorldFixtureTitle,
};
