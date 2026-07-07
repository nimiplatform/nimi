import { invokeTesterCommand } from '../tester-tauri.js';
import { readTesterStandardStorageJson, writeTesterStandardStorageJson } from '../tester-standard-storage.js';
import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';

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

export type WorldTourRenderAcceptance = {
  manifestPath: string;
  renderer: 'spark-2.0';
  status: 'passed' | 'failed';
  acceptedAt: string;
  note?: string;
};

const WORLD_TOUR_RENDER_ACCEPTANCE_STORAGE_PATH = 'world-tour-render-acceptance.json';

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

export async function saveWorldTourRenderAcceptance(record: WorldTourRenderAcceptance): Promise<void> {
  await writeTesterStandardStorageJson(
    WORLD_TOUR_RENDER_ACCEPTANCE_STORAGE_PATH,
    record as unknown as JsonValue,
  );
}

export async function loadWorldTourRenderAcceptance(): Promise<WorldTourRenderAcceptance | null> {
  const value = await readTesterStandardStorageJson(WORLD_TOUR_RENDER_ACCEPTANCE_STORAGE_PATH);
  if (value === undefined || value === null) {
    return null;
  }
  return value as unknown as WorldTourRenderAcceptance;
}
