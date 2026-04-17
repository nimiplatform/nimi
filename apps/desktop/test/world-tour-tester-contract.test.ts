import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readRendererFile(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, `../src/shell/renderer/${relativePath}`), 'utf8');
}

test('tester capability catalog admits world.generate as world tour lane', () => {
  const source = readRendererFile('features/tester/tester-types.ts');
  assert.match(source, /'world\.generate'/);
  assert.match(source, /World Tour/);
});

test('tester page mounts the world tour panel', () => {
  const source = readRendererFile('features/tester/tester-page.tsx');
  assert.match(source, /WorldTourPanel/);
  assert.match(source, /case 'world\.generate'/);
});

test('world tour panel keeps world.generate submit flow and launch-only desktop viewer entry', () => {
  const source = readRendererFile('features/tester/panels/panel-world-tour.tsx');
  assert.match(source, /media\.world\.generate/);
  assert.match(source, /Run World Tour/);
  assert.match(source, /Load Cached Fixture/);
  assert.match(source, /Launch World Tour/);
  assert.match(source, /WORLD_TOUR_CACHE_MANIFEST_PATH/);
  assert.match(source, /resolve_world_tour_fixture/);
  assert.match(source, /open_world_tour_window/);
});

test('dedicated world tour viewer route owns Spark renderer lifecycle', () => {
  const source = readRendererFile('features/tester/world-tour-viewer-route.tsx');
  assert.match(source, /SparkRenderer/);
  assert.match(source, /OrbitControls/);
  assert.match(source, /GLTFLoader/);
  assert.match(source, /Fit Scene/);
  assert.match(source, /Reset View/);
  assert.match(source, /Save Current View/);
  assert.match(source, /Pilot Target/);
  assert.match(source, /dblclick/);
  assert.match(source, /save_world_tour_viewer_preset/);
  assert.match(source, /resolve_world_tour_fixture/);
  assert.match(source, /Booting world tour viewer/);
  assert.doesNotMatch(source, /Ground Lock/);
});

test('app routes admit the dedicated world tour viewer route', () => {
  const source = readRendererFile('app-shell/routes/app-routes.tsx');
  assert.match(source, /WorldTourViewerRoute/);
  assert.match(source, /world-tour-viewer/);
});

test('tester settings expose a world route picker', () => {
  const source = readRendererFile('features/tester/tester-settings-dialog.tsx');
  assert.match(source, /routeCapability:\s*'world\.generate'/);
  assert.match(source, /World Tour/);
});
