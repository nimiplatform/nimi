import { invokeShell } from '@nimiplatform/kit/shell/renderer/bridge';
import { isJsonObject } from '@nimiplatform/sdk/types';
import { getLabLocalAppClient } from '../../shell/local-app-runtime-platform.js';
import { parseWorldTourCameraPreset } from './world-tour-camera.js';

export const WORLD_BUNDLE_MIME = 'application/vnd.nimi.world+zip';
export const DEFAULT_MANIFEST_PATH = 'world-tour/latest.json';

export type ResolveWorldTourFixtureInput = {
  manifestPath?: string;
};

export type ResolvedWorldTourFixture = {
  manifestPath: string;
  archivePath: string;
  viewerPresetPath: string;
};

export type OpenWorldTourWindowInput = {
  manifestPath: string;
};

export type OpenWorldTourWindowResponse = {
  windowLabel: string;
  manifestPath: string;
};

export type ClaimWorldTourViewerLaunchInput = {
  manifestPath: string;
  launchToken: string;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r035
export async function resolveWorldTourFixture(payload: ResolveWorldTourFixtureInput): Promise<ResolvedWorldTourFixture> {
  const manifestPath = payload.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const storage = getLabLocalAppClient().storage;
  const { value } = await storage.readJson(manifestPath);
  if (!isJsonObject(value)) throw new Error('world-tour-manifest-invalid');
  if (typeof value.archivePath !== 'string' || !value.archivePath.startsWith('world-tour/')) {
    throw new Error('world-tour-archive-path-invalid');
  }
  await storage.assets.stat(value.archivePath);
  return { manifestPath, archivePath: value.archivePath, viewerPresetPath: `${value.archivePath}.camera.json` };
}

export async function openWorldTourWindow(payload: OpenWorldTourWindowInput): Promise<OpenWorldTourWindowResponse> {
  return invokeShell<OpenWorldTourWindowResponse>('open_world_tour_window', {
    payload: { manifestPath: payload.manifestPath },
  });
}

export async function claimWorldTourViewerLaunch(payload: ClaimWorldTourViewerLaunchInput): Promise<ResolvedWorldTourFixture> {
  await invokeShell('claim_world_tour_viewer_launch', {
    payload: { manifestPath: payload.manifestPath, launchToken: payload.launchToken },
  });
  return resolveWorldTourFixture({ manifestPath: payload.manifestPath });
}

export async function saveWorldTourViewerPreset(payload: { manifestPath: string; presetJson: string }): Promise<{ manifestPath: string; presetPath: string }> {
  const world = await resolveWorldTourFixture({ manifestPath: payload.manifestPath });
  const presetPath = world.viewerPresetPath;
  await getLabLocalAppClient().storage.writeJson(presetPath, parseWorldTourCameraPreset(JSON.parse(payload.presetJson)));
  return { manifestPath: payload.manifestPath, presetPath };
}
