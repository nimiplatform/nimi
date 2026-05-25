import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopDir = resolve(import.meta.dirname, '..');

function readRendererFile(relativePath: string): string {
  return readFileSync(resolve(desktopDir, `src/shell/renderer/${relativePath}`), 'utf8');
}

function readTauriFile(relativePath: string): string {
  return readFileSync(resolve(desktopDir, `src-tauri/src/${relativePath}`), 'utf8');
}

test('desktop does not host the extracted world tour viewer route', () => {
  const routeSource = readRendererFile('app-shell/routes/app-routes.tsx');
  const appSource = readRendererFile('App.tsx');
  assert.doesNotMatch(routeSource, /world-tour-viewer|WorldTourViewerRoute|launchToken|features\/tester/);
  assert.doesNotMatch(appSource, /world-tour-viewer|launchToken|standaloneWorldTour/);
  assert.equal(
    existsSync(resolve(desktopDir, 'src/shell/renderer/features/tester')),
    false,
  );
});

test('desktop Tauri command boundary no longer registers tester world-tour commands', () => {
  const modules = readTauriFile('main_parts/defaults_and_commands/mod.rs');
  const bootstrap = readTauriFile('main_parts/app_bootstrap.rs');
  assert.doesNotMatch(modules, /tester_storage|world_tour/);
  assert.doesNotMatch(
    bootstrap,
    /tester_(image|run|fixture)|world_tour|resolve_world_tour_fixture|claim_world_tour_viewer_launch|save_world_tour_viewer_preset|world_tour_render_acceptance|open_world_tour_window/,
  );
  assert.equal(
    existsSync(resolve(desktopDir, 'src-tauri/src/main_parts/defaults_and_commands/world_tour.rs')),
    false,
  );
  assert.equal(
    existsSync(resolve(desktopDir, 'src-tauri/src/main_parts/defaults_and_commands/tester_storage.rs')),
    false,
  );
});
