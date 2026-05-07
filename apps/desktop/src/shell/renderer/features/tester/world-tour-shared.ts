import { convertTauriFileSrc } from '@runtime/tauri-api';
import {
  fixture as worldFixture,
  normalizeWorldInspectViewPreset,
  normalizeWorldInspectVector,
  type WorldFixturePackage,
  type WorldInspectViewPreset,
  type WorldInspectVector,
} from '@nimiplatform/sdk/world';

export type WorldResultRecord = WorldFixturePackage;
export type WorldTourViewerPreset = WorldInspectViewPreset;
export type WorldTourViewerPresetVector = WorldInspectVector;

export type WorldTourRenderAcceptance = {
  manifestPath: string;
  status: 'passed' | 'failed';
  acceptedAt: string;
  renderer: 'spark-2.0';
  worldId?: string;
  spzAssetRef?: string;
  reason?: string;
};

export type ResolvedWorldTourFixture = {
  manifestPath: string;
  fixtureRoot: string;
  worldId?: string;
  displayName?: string;
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
export const WORLD_TOUR_RENDER_ACCEPTANCE_STORAGE_KEY = 'nimi.worldTour.renderAcceptance.v1';

export function asOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function pickPreviewSpzUrl(world: WorldResultRecord | null): string {
  return worldFixture.pickPreviewSpzUrl(world);
}

export function normalizeWorldGenerateOutput(value: unknown): WorldResultRecord | null {
  return worldFixture.normalize(value);
}

export function normalizeViewerPreset(
  value: Record<string, unknown> | null | undefined,
): WorldTourViewerPreset | undefined {
  return normalizeWorldInspectViewPreset(value);
}

export function normalizeViewerPresetVector(value: unknown): WorldTourViewerPresetVector | undefined {
  return normalizeWorldInspectVector(value);
}

export function worldTourFixtureToWorldResult(fixture: ResolvedWorldTourFixture): WorldResultRecord {
  const normalized = worldFixture.fromResolvedPaths({
    manifestPath: fixture.manifestPath,
    worldId: fixture.worldId,
    displayName: fixture.displayName,
    model: fixture.model,
    caption: fixture.caption,
    worldMarbleUrl: fixture.worldMarbleUrl,
    spzRemoteUrl: fixture.spzRemoteUrl,
    thumbnailRemoteUrl: fixture.thumbnailRemoteUrl,
    panoRemoteUrl: fixture.panoRemoteUrl,
    colliderMeshRemoteUrl: fixture.colliderMeshRemoteUrl,
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

export function parseWorldTourRenderAcceptance(value: unknown): WorldTourRenderAcceptance | null {
  let record: unknown = value;
  if (typeof value === 'string') {
    try {
      record = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!record || typeof record !== 'object') return null;
  const input = record as Record<string, unknown>;
  const manifestPath = asOptionalString(input.manifestPath);
  const status = asOptionalString(input.status);
  const acceptedAt = asOptionalString(input.acceptedAt);
  const renderer = asOptionalString(input.renderer);
  if (!manifestPath || !acceptedAt || renderer !== 'spark-2.0') return null;
  if (status !== 'passed' && status !== 'failed') return null;
  return {
    manifestPath,
    status,
    acceptedAt,
    renderer,
    worldId: asOptionalString(input.worldId) || undefined,
    spzAssetRef: asOptionalString(input.spzAssetRef) || undefined,
    reason: asOptionalString(input.reason) || undefined,
  };
}

export function writeWorldTourRenderAcceptance(record: WorldTourRenderAcceptance): void {
  try {
    window.localStorage.setItem(WORLD_TOUR_RENDER_ACCEPTANCE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage is the cross-window acceptance channel; panel state stays fail-closed on failure.
  }
}

export function worldTourTitle(world: WorldResultRecord | null): string {
  return worldFixture.title(world);
}
