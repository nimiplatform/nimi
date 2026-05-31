import { invokeTesterCommand } from '../tester-tauri.js';
import { withTesterAppStorageRoots, type TesterAppStorageRoots } from '../tester-app-storage.js';

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

async function withStorageRoots<T extends Record<string, unknown>>(payload: T): Promise<T & TesterAppStorageRoots> {
  return withTesterAppStorageRoots(payload);
}

export async function resolveWorldTourFixture(payload: ResolveWorldTourFixtureInput): Promise<ResolvedWorldTourFixture> {
  return invokeTesterCommand<ResolvedWorldTourFixture>('resolve_world_tour_fixture', {
    payload: await withStorageRoots({ manifestPath: payload.manifestPath }),
  });
}

export async function openWorldTourWindow(payload: OpenWorldTourWindowInput): Promise<OpenWorldTourWindowResponse> {
  return invokeTesterCommand<OpenWorldTourWindowResponse>('open_world_tour_window', {
    payload: await withStorageRoots(payload),
  });
}

export async function claimWorldTourViewerLaunch(payload: ClaimWorldTourViewerLaunchInput): Promise<ResolvedWorldTourFixture> {
  return invokeTesterCommand<ResolvedWorldTourFixture>('claim_world_tour_viewer_launch', {
    payload: await withStorageRoots(payload),
  });
}

export async function saveWorldTourViewerPreset(payload: { manifestPath: string; presetJson: string }): Promise<{ manifestPath: string; presetPath: string }> {
  return invokeTesterCommand('save_world_tour_viewer_preset', {
    payload: await withStorageRoots(payload),
  });
}

export async function saveWorldTourRenderAcceptance(record: WorldTourRenderAcceptance): Promise<void> {
  return invokeTesterCommand('world_tour_render_acceptance_save', {
    payload: await withStorageRoots(record),
  });
}

export async function loadWorldTourRenderAcceptance(): Promise<WorldTourRenderAcceptance | null> {
  return invokeTesterCommand('world_tour_render_acceptance_load', {
    payload: await withStorageRoots({}),
  });
}
