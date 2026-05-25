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
  assert.match(shared, /world_tour_render_acceptance_save/);
  assert.match(route, /WorldTourViewerRoute/);
  assert.match(rust, /open_world_tour_window/);
  assert.match(rust, /WORLD_TOUR_WINDOW_LABEL_PREFIX/);
  assert.doesNotMatch(route, /@renderer\//);
  assert.doesNotMatch(route, /@runtime\//);
});
