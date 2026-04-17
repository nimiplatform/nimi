import { convertTauriFileSrc } from '@runtime/tauri-api';

export type WorldResultRecord = {
  manifestPath?: string;
  worldId?: string;
  displayName?: string;
  worldMarbleUrl?: string;
  caption?: string;
  thumbnailUrl?: string;
  panoUrl?: string;
  colliderMeshUrl?: string;
  spzUrls?: Record<string, string>;
  semanticsMetadata?: {
    groundPlaneOffset?: number;
    metricScaleFactor?: number;
  };
  model?: string;
  artifacts?: Array<Record<string, unknown>>;
  spzLocalPath?: string;
  thumbnailLocalPath?: string;
  panoLocalPath?: string;
  colliderMeshLocalPath?: string;
  viewerPreset?: WorldTourViewerPreset;
};

export type WorldTourViewerPresetVector = {
  x: number;
  y: number;
  z: number;
};

export type WorldTourViewerPreset = {
  version: number;
  mode: 'inspect';
  source: 'manual' | 'auto-collider' | 'auto-splat';
  camera: {
    position: WorldTourViewerPresetVector;
    target: WorldTourViewerPresetVector;
  };
};

export type ResolvedWorldTourFixture = {
  manifestPath: string;
  fixtureRoot: string;
  worldId?: string;
  model?: string;
  caption?: string;
  worldMarbleUrl?: string;
  spzRemoteUrl?: string;
  thumbnailRemoteUrl?: string;
  panoRemoteUrl?: string;
  colliderMeshRemoteUrl?: string;
  spzLocalPath?: string;
  thumbnailLocalPath?: string;
  panoLocalPath?: string;
  colliderMeshLocalPath?: string;
  semanticsMetadata?: {
    groundPlaneOffset?: number;
    metricScaleFactor?: number;
  };
  viewerPreset?: WorldTourViewerPreset;
};

export const WORLD_TOUR_CACHE_MANIFEST_PATH = '.nimi/cache/worldlabs/world-tour/latest/fixture-manifest.json';

export function asOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function pickPreviewSpzUrl(world: WorldResultRecord | null): string {
  const urls = world?.spzUrls || {};
  const orderedKeys = ['full_res', 'cached', 'default', 'preview'];
  for (const key of orderedKeys) {
    const url = asOptionalString(urls[key]);
    if (url) return url;
  }
  for (const url of Object.values(urls)) {
    const normalized = asOptionalString(url);
    if (normalized) return normalized;
  }
  return '';
}

export function normalizeWorldGenerateOutput(value: unknown): WorldResultRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const spzUrlsRaw = record.spzUrls;
  const semanticsRaw = record.semanticsMetadata;
  const viewerPresetRaw = record.viewerPreset;
  return {
    manifestPath: asOptionalString(record.manifestPath),
    worldId: asOptionalString(record.worldId),
    displayName: asOptionalString(record.displayName),
    worldMarbleUrl: asOptionalString(record.worldMarbleUrl),
    caption: asOptionalString(record.caption),
    thumbnailUrl: asOptionalString(record.thumbnailUrl),
    panoUrl: asOptionalString(record.panoUrl),
    colliderMeshUrl: asOptionalString(record.colliderMeshUrl),
    spzUrls: spzUrlsRaw && typeof spzUrlsRaw === 'object'
      ? Object.fromEntries(
        Object.entries(spzUrlsRaw as Record<string, unknown>)
          .map(([key, url]) => [key, asOptionalString(url)])
          .filter(([, url]) => Boolean(url)),
      )
      : {},
    semanticsMetadata: semanticsRaw && typeof semanticsRaw === 'object'
      ? {
        groundPlaneOffset: Number(
          (semanticsRaw as Record<string, unknown>).groundPlaneOffset
          || (semanticsRaw as Record<string, unknown>).ground_plane_offset
          || 0,
        ),
        metricScaleFactor: Number(
          (semanticsRaw as Record<string, unknown>).metricScaleFactor
          || (semanticsRaw as Record<string, unknown>).metric_scale_factor
          || 0,
        ),
      }
      : undefined,
    model: asOptionalString(record.model),
    spzLocalPath: asOptionalString(record.spzLocalPath),
    thumbnailLocalPath: asOptionalString(record.thumbnailLocalPath),
    panoLocalPath: asOptionalString(record.panoLocalPath),
    colliderMeshLocalPath: asOptionalString(record.colliderMeshLocalPath),
    viewerPreset: viewerPresetRaw && typeof viewerPresetRaw === 'object'
      ? normalizeViewerPreset(viewerPresetRaw as Record<string, unknown>)
      : undefined,
    artifacts: Array.isArray(record.artifacts)
      ? record.artifacts.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      : [],
  };
}

export function normalizeViewerPreset(
  value: Record<string, unknown> | null | undefined,
): WorldTourViewerPreset | undefined {
  if (!value) {
    return undefined;
  }
  const camera = value.camera;
  if (!camera || typeof camera !== 'object') {
    return undefined;
  }
  const position = normalizeViewerPresetVector((camera as Record<string, unknown>).position);
  const target = normalizeViewerPresetVector((camera as Record<string, unknown>).target);
  const source = asOptionalString(value.source);
  const mode = asOptionalString(value.mode);
  if (!position || !target || mode !== 'inspect') {
    return undefined;
  }
  if (source !== 'manual' && source !== 'auto-collider' && source !== 'auto-splat') {
    return undefined;
  }
  return {
    version: Number(value.version || 1),
    mode: 'inspect',
    source,
    camera: {
      position,
      target,
    },
  };
}

export function normalizeViewerPresetVector(value: unknown): WorldTourViewerPresetVector | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const z = Number(record.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return undefined;
  }
  return { x, y, z };
}

export function worldTourFixtureToWorldResult(fixture: ResolvedWorldTourFixture): WorldResultRecord {
  const normalized = normalizeWorldGenerateOutput({
    manifestPath: fixture.manifestPath,
    worldId: fixture.worldId,
    model: fixture.model,
    caption: fixture.caption,
    worldMarbleUrl: fixture.worldMarbleUrl,
    spzUrls: fixture.spzRemoteUrl ? { cached: fixture.spzRemoteUrl } : {},
    thumbnailUrl: fixture.thumbnailRemoteUrl,
    panoUrl: fixture.panoRemoteUrl,
    colliderMeshUrl: fixture.colliderMeshRemoteUrl,
    spzLocalPath: fixture.spzLocalPath,
    thumbnailLocalPath: fixture.thumbnailLocalPath,
    panoLocalPath: fixture.panoLocalPath,
    colliderMeshLocalPath: fixture.colliderMeshLocalPath,
    semanticsMetadata: fixture.semanticsMetadata,
    viewerPreset: fixture.viewerPreset,
  });
  return normalized || { manifestPath: fixture.manifestPath };
}

export function resolveWorldTourAssetUrl(localPath?: string, remoteUrl?: string): string {
  const normalizedLocalPath = asOptionalString(localPath);
  if (normalizedLocalPath) {
    return convertTauriFileSrc(normalizedLocalPath);
  }
  return asOptionalString(remoteUrl);
}

export function worldTourTitle(world: WorldResultRecord | null): string {
  return world?.displayName || world?.worldId || 'Cached world fixture';
}
