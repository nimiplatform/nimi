import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const runtimeCommandsAssetsPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/commands-assets.ts');
const runtimeIndexPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/index.ts');
const localAiBridgeParsersPath = path.resolve(process.cwd(), 'src/shell/renderer/bridge/runtime-bridge/local-ai-parsers.ts');
const localModelCenterDownloadsPath = path.resolve(process.cwd(), 'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-downloads.ts');

const runtimeCommandsAssetsSource = readFileSync(runtimeCommandsAssetsPath, 'utf-8');
const runtimeIndexSource = readFileSync(runtimeIndexPath, 'utf-8');
const localAiBridgeParsersSource = readFileSync(localAiBridgeParsersPath, 'utf-8');
const localModelCenterDownloadsSource = readFileSync(localModelCenterDownloadsPath, 'utf-8');

test('local runtime transfer plane resolves through runtime typed APIs', () => {
  assert.match(runtimeCommandsAssetsSource, /runtime\.listLocalTransfers\(\{\}\)/);
  assert.match(runtimeCommandsAssetsSource, /runtime\.pauseLocalTransfer\(\{/);
  assert.match(runtimeCommandsAssetsSource, /runtime\.resumeLocalTransfer\(\{/);
  assert.match(runtimeCommandsAssetsSource, /runtime\.cancelLocalTransfer\(\{/);
  assert.match(runtimeCommandsAssetsSource, /runtime\.watchLocalTransfers\(\{\}, \{ signal: controller\.signal \}\)/);
});

test('runtime local facade no longer re-exports go-runtime sync helpers', () => {
  assert.doesNotMatch(runtimeIndexSource, /from '\.\/go-runtime-sync'/);
  assert.doesNotMatch(runtimeIndexSource, /reconcileModelsToGoRuntime/);
  assert.doesNotMatch(runtimeIndexSource, /syncModelStartToGoRuntime/);
});

test('desktop shipped progress paths no longer treat tauri local-ai progress as the SSOT', () => {
  assert.doesNotMatch(localAiBridgeParsersSource, /parseLocalRuntimeDownloadProgressEvent/);
  assert.doesNotMatch(localAiBridgeParsersSource, /local-ai:\/\/download-progress/);
  assert.match(localModelCenterDownloadsSource, /localRuntime\.listDownloads\(\)/);
  assert.match(localModelCenterDownloadsSource, /localRuntime\.subscribeDownloadProgress\(/);
});
