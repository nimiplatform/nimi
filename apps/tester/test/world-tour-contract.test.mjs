import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('world-tour viewer is standalone app-owned code', () => {
  const shared = read('src/tester/world-tour/world-tour-shared.ts');
  const route = read('src/tester/world-tour/world-tour-viewer-route.tsx');
  const rust = read('src-tauri/src/world_tour.rs');
  assert.match(shared, /claim_world_tour_viewer_launch/);
  // World-tour render acceptance is persisted through the kit standard storage
  // command surface, not an app-owned world_tour_render_acceptance handler.
  assert.match(shared, /WORLD_TOUR_RENDER_ACCEPTANCE_STORAGE_PATH = 'world-tour-render-acceptance\.json'/);
  assert.match(shared, /writeTesterStandardStorageJson\(/);
  assert.match(shared, /readTesterStandardStorageJson\(WORLD_TOUR_RENDER_ACCEPTANCE_STORAGE_PATH\)/);
  assert.doesNotMatch(shared, /world_tour_render_acceptance_save/);
  assert.doesNotMatch(shared, /storageRoot|withStorageRoots|cacheRoot|tempRoot|dataRoot/);
  assert.doesNotMatch(rust, /world_tour_render_acceptance/);
  assert.match(route, /WorldTourViewerRoute/);
  assert.match(rust, /open_world_tour_window/);
  assert.match(rust, /WORLD_TOUR_WINDOW_LABEL_PREFIX/);
  assert.doesNotMatch(route, /@renderer\//);
  assert.doesNotMatch(route, /@runtime\//);
});
