import { invokeTesterCommand } from '../tester-tauri.js';

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

export async function resolveWorldTourFixture(payload: ResolveWorldTourFixtureInput): Promise<ResolvedWorldTourFixture> {
  return invokeTesterCommand<ResolvedWorldTourFixture>('resolve_world_tour_fixture', {
    payload: { manifestPath: payload.manifestPath },
  });
}

export async function openWorldTourWindow(payload: OpenWorldTourWindowInput): Promise<OpenWorldTourWindowResponse> {
  return invokeTesterCommand<OpenWorldTourWindowResponse>('open_world_tour_window', {
    payload: { manifestPath: payload.manifestPath },
  });
}

export async function claimWorldTourViewerLaunch(payload: ClaimWorldTourViewerLaunchInput): Promise<ResolvedWorldTourFixture> {
  return invokeTesterCommand<ResolvedWorldTourFixture>('claim_world_tour_viewer_launch', {
    payload: { manifestPath: payload.manifestPath, launchToken: payload.launchToken },
  });
}

export async function saveWorldTourViewerPreset(payload: { manifestPath: string; presetJson: string }): Promise<{ manifestPath: string; presetPath: string }> {
  return invokeTesterCommand('save_world_tour_viewer_preset', {
    payload: { manifestPath: payload.manifestPath, presetJson: payload.presetJson },
  });
}
