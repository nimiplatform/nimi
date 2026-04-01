import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const catalogCardPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-catalog-card.tsx',
);
const controllerPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-panel-controller-install-actions-models.ts',
);
const localPagePath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-page-local.tsx',
);
const tauriCommandsPath = path.resolve(
  process.cwd(),
  'src-tauri/src/local_runtime/commands/commands_models_audit.rs',
);

const catalogCardSource = readFileSync(catalogCardPath, 'utf-8');
const controllerSource = readFileSync(controllerPath, 'utf-8');
const localPageSource = readFileSync(localPagePath, 'utf-8');
const tauriCommandsSource = readFileSync(tauriCommandsPath, 'utf-8');

test('local model center installed list is status-only and no longer renders a lifecycle toggle', () => {
  assert.doesNotMatch(catalogCardSource, /<Toggle/);
  assert.doesNotMatch(catalogCardSource, /onStartModel:/);
  assert.doesNotMatch(catalogCardSource, /onStopModel:/);
  assert.doesNotMatch(catalogCardSource, /localModelLifecycleById:/);
  assert.match(catalogCardSource, /model\.status === 'installed'/);
  assert.match(catalogCardSource, /runtimeConfig\.localModelCenter\.installed/);
});

test('desktop local page no longer wires start\\/stop\\/restart product actions into local model center', () => {
  assert.doesNotMatch(localPageSource, /onStart=\{model\.startLocalModel\}/);
  assert.doesNotMatch(localPageSource, /onStop=\{model\.stopLocalModel\}/);
  assert.doesNotMatch(localPageSource, /onRestart=\{model\.restartLocalModel\}/);
});

test('runtime local lifecycle controller remains available only as non-product maintenance surface', () => {
  assert.match(controllerSource, /localModelLifecycleById: Record<string, string>/);
  assert.match(controllerSource, /setLifecycleState\(localModelId, 'starting', '', epoch\)/);
  assert.match(controllerSource, /setLifecycleState\(localModelId, 'stopping', '', epoch\)/);
  assert.match(controllerSource, /setLifecycleState\(localModelId, 'restarting', '', epoch\)/);
  assert.match(controllerSource, /setLifecycleState\(localModelId, 'syncing', '', epoch\)/);
  assert.match(controllerSource, /queueLifecycleReconcile\(/);
  assert.match(controllerSource, /runtimeConfig\.local\.startModelPending/);
  assert.match(controllerSource, /runtimeConfig\.local\.stopModelPending/);
  assert.match(controllerSource, /runtimeConfig\.local\.restartModelPending/);
});

test('local model tauri lifecycle commands run on a background blocking task', () => {
  assert.match(tauriCommandsSource, /async fn runtime_local_models_start/);
  assert.match(tauriCommandsSource, /spawn_blocking\(move \|\| start_model\(&app, &payload\.local_model_id\)\)/);
  assert.match(tauriCommandsSource, /async fn runtime_local_models_stop/);
  assert.match(tauriCommandsSource, /spawn_blocking\(move \|\| stop_model\(&app, &payload\.local_model_id\)\)/);
  assert.match(tauriCommandsSource, /async fn runtime_local_models_health/);
  assert.match(tauriCommandsSource, /spawn_blocking\(move \|\| \{\s*health\(&app, local_model_id\.as_deref\(\)\)/);
});
