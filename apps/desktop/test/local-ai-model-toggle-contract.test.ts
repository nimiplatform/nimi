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
const tauriCommandsPath = path.resolve(
  process.cwd(),
  'src-tauri/src/local_runtime/commands/commands_models_audit.rs',
);

const catalogCardSource = readFileSync(catalogCardPath, 'utf-8');
const controllerSource = readFileSync(controllerPath, 'utf-8');
const tauriCommandsSource = readFileSync(tauriCommandsPath, 'utf-8');

test('local model center toggle consumes controller lifecycle state and does not own local busy state', () => {
  assert.doesNotMatch(catalogCardSource, /const \[busyByModelId, setBusyByModelId\] = useState/);
  assert.match(catalogCardSource, /localModelLifecycleById: Record<string, LocalRuntimeModelLifecycleOperation>/);
  assert.match(catalogCardSource, /const lifecycle = props\.localModelLifecycleById\[model\.localModelId\]/);
  assert.match(catalogCardSource, /await props\.onStartModel\(model\.localModelId\)/);
  assert.match(catalogCardSource, /await props\.onStopModel\(model\.localModelId\)/);
  assert.match(catalogCardSource, /disabled=\{toggleBusy\}/);
});

test('local model lifecycle controller tracks lifecycle state before local tauri completion and backgrounds sync', () => {
  assert.match(controllerSource, /localModelLifecycleById: Record<string, LocalRuntimeModelLifecycleOperation>/);
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
  assert.match(tauriCommandsSource, /pub async fn runtime_local_models_start/);
  assert.match(tauriCommandsSource, /spawn_blocking\(move \|\| start_model\(&app, &payload\.local_model_id\)\)/);
  assert.match(tauriCommandsSource, /pub async fn runtime_local_models_stop/);
  assert.match(tauriCommandsSource, /spawn_blocking\(move \|\| stop_model\(&app, &payload\.local_model_id\)\)/);
  assert.match(tauriCommandsSource, /pub async fn runtime_local_models_health/);
  assert.match(tauriCommandsSource, /spawn_blocking\(move \|\| \{\s*health\(&app, local_model_id\.as_deref\(\)\)/);
});
