import type { WorldFixturePackage, WorldInspectRenderPlan } from './types.js';
import { pickWorldFixturePreviewSpzUrl } from './fixture.js';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createInspectWorldRenderPlan(
  fixture: WorldFixturePackage | null | undefined,
): WorldInspectRenderPlan | null {
  if (!fixture) {
    return null;
  }
  const spzUrl = pickWorldFixturePreviewSpzUrl(fixture);
  const previewImageLocalPath = normalizeString(fixture.thumbnailLocalPath) || normalizeString(fixture.panoLocalPath);
  const previewImageUrl = normalizeString(fixture.thumbnailUrl) || normalizeString(fixture.panoUrl);
  return {
    mode: 'inspect',
    ...(normalizeString(fixture.worldId) ? { worldId: normalizeString(fixture.worldId) } : {}),
    ...(normalizeString(fixture.manifestPath) ? { manifestPath: normalizeString(fixture.manifestPath) } : {}),
    ...(spzUrl ? { spzUrl } : {}),
    ...(normalizeString(fixture.spzLocalPath) ? { spzLocalPath: normalizeString(fixture.spzLocalPath) } : {}),
    ...(previewImageUrl ? { previewImageUrl } : {}),
    ...(previewImageLocalPath ? { previewImageLocalPath } : {}),
    ...(fixture.viewerPreset ? { viewerPreset: fixture.viewerPreset } : {}),
    capabilityRequirements: {
      requiresSparkDriver: true,
      requiresSpzAsset: Boolean(spzUrl || normalizeString(fixture.spzLocalPath)),
      hasLocalFixture: Boolean(normalizeString(fixture.manifestPath)),
    },
    fallback: {
      previewImageAllowed: Boolean(previewImageUrl || previewImageLocalPath),
      allowLaunchWithoutManifest: false,
    },
    initialCameraPolicy: {
      source: fixture.viewerPreset ? 'fixture_preset' : 'auto',
    },
  };
}

export const render = {
  createInspectPlan: createInspectWorldRenderPlan,
};
