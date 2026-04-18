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

export function worldTourTitle(world: WorldResultRecord | null): string {
  return worldFixture.title(world);
}
