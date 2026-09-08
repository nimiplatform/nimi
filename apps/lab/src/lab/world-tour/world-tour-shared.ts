import { invokeShell } from '@nimiplatform/kit/shell/renderer/bridge';
import { isJsonObject } from '@nimiplatform/sdk/types';
import { getLabLocalAppClient } from '../../shell/local-app-runtime-platform.js';

const DEFAULT_MANIFEST_PATH = 'world-tour/latest/fixture-manifest.json';

export type ResolveWorldTourFixtureInput = {
  manifestPath?: string;
};

export type ResolvedWorldTourFixture = {
  manifestPath: string;
  worldMarbleUrl?: string;
  colliderMeshUrl?: string;
  viewerPresetPath?: string;
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
  const directory = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
  const reference = async (key: string): Promise<string | undefined> => {
    const path = value[key];
    if (path === undefined) return undefined;
    if (typeof path !== 'string' || !path) throw new Error('world-tour-manifest-reference-invalid');
    const relativePath = `${directory}${path}`;
    await storage.assets.stat(relativePath);
    return relativePath;
  };
  const [worldMarbleUrl, colliderMeshUrl] = await Promise.all([reference('worldMarblePath'), reference('colliderMeshPath')]);
  if (!worldMarbleUrl && !colliderMeshUrl) throw new Error('world-tour-manifest-has-no-assets');
  return { manifestPath, worldMarbleUrl, colliderMeshUrl };
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
  await resolveWorldTourFixture({ manifestPath: payload.manifestPath });
  const presetPath = `${payload.manifestPath.slice(0, payload.manifestPath.lastIndexOf('/') + 1)}viewer-preset.json`;
  await getLabLocalAppClient().storage.writeJson(presetPath, JSON.parse(payload.presetJson));
  return { manifestPath: payload.manifestPath, presetPath };
}
