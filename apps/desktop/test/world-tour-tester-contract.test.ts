import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readRendererFile(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, `../src/shell/renderer/${relativePath}`), 'utf8');
}

function readTauriFile(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, `../src-tauri/src/${relativePath}`), 'utf8');
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
  const summarySource = readRendererFile('features/tester/panels/panel-world-tour-result-summary.tsx');
  assert.match(source, /@nimiplatform\/sdk\/world/);
  assert.match(source, /worldGenerate\.project/);
  assert.match(source, /createInspectWorldRenderPlan/);
  assert.match(source, /createInspectWorldSession/);
  assert.match(source, /media\.world\.generate/);
  assert.match(source, /Run World Tour/);
  assert.match(source, /Load Cached Fixture/);
  assert.match(summarySource, /Launch World Tour/);
  assert.match(source, /WORLD_TOUR_CACHE_MANIFEST_PATH/);
  assert.match(source, /resolve_world_tour_fixture/);
  assert.match(source, /open_world_tour_window/);
  assert.doesNotMatch(source, /window\.open/);
  assert.doesNotMatch(source, /world-tour-viewer\?/);
  assert.doesNotMatch(source, /hasTauriRuntime/);
  assert.match(source, /readWorldTourRenderAcceptance/);
  assert.doesNotMatch(source, /localStorage/);
  assert.match(source, /spark-render-acceptance-pending/);
  assert.match(source, /spark-render-accepted/);
  assert.doesNotMatch(source, /finishReason:\s*'cached-fixture'/);
  assert.doesNotMatch(source, /result:\s*'passed',\s*error:\s*'',\s*output:\s*world/);
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
  assert.match(source, /claim_world_tour_viewer_launch/);
  assert.match(source, /launchToken/);
  assert.match(source, /Tester-owned desktop launch token/);
  assert.doesNotMatch(source, /resolve_world_tour_fixture/);
  assert.match(source, /Booting world tour viewer/);
  assert.match(source, /writeWorldTourRenderAcceptance/);
  assert.match(source, /hasVerifiedSpzIntegrity/);
  assert.match(source, /digest\/provenance/);
  assert.match(source, /status:\s*'passed'/);
  assert.match(source, /status:\s*'failed'/);
  assert.match(source, /const WORLD_TOUR_UPRIGHT_QUATERNION = new THREE\.Quaternion\(1,\s*0,\s*0,\s*0\)/);
  assert.doesNotMatch(source, /splat\.quaternion\.copy\(WORLD_TOUR_UPRIGHT_QUATERNION\)/);
  assert.doesNotMatch(source, /Ground Lock/);
});

test('app routes admit the dedicated world tour viewer route', () => {
  const source = readRendererFile('app-shell/routes/app-routes.tsx');
  const appSource = readRendererFile('App.tsx');
  assert.match(source, /WorldTourViewerRoute/);
  assert.match(source, /world-tour-viewer/);
  assert.match(source, /launchToken/);
  assert.match(appSource, /launchToken/);
});

test('world tour Tauri command boundary issues and claims launch tokens', () => {
  const worldTourSource = readTauriFile('main_parts/defaults_and_commands/world_tour.rs');
  const bootstrapSource = readTauriFile('main_parts/app_bootstrap.rs');
  assert.match(worldTourSource, /ClaimWorldTourViewerLaunchPayload/);
  assert.match(worldTourSource, /claim_world_tour_viewer_launch/);
  assert.match(worldTourSource, /write_launch_token/);
  assert.match(worldTourSource, /claim_launch_token/);
  assert.match(worldTourSource, /append_pair\("launchToken"/);
  assert.match(bootstrapSource, /claim_world_tour_viewer_launch/);
});

test('tester settings expose a world route picker', () => {
  const settingsSource = readRendererFile('features/tester/tester-settings-dialog.tsx');
  const hookSource = readRendererFile('features/tester/tester-model-config-hook.ts');
  assert.match(hookSource, /'world\.generate'/);
  assert.match(settingsSource, /ModelConfigCapabilityDetail/);
});
