import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const localAiBridgePath = path.resolve(process.cwd(), 'src/shell/renderer/bridge/runtime-bridge/local-ai.ts');
const localAiBridgeParsersPath = path.resolve(process.cwd(), 'src/shell/renderer/bridge/runtime-bridge/local-ai-parsers.ts');
const localModelCenterDownloadsPath = path.resolve(process.cwd(), 'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-downloads.ts');
const buildChunksPath = path.resolve(process.cwd(), '../../.nimi/spec/desktop/kernel/tables/build-chunks.yaml');

const localModelCenterDownloadsSource = readFileSync(localModelCenterDownloadsPath, 'utf-8');
const buildChunksSource = readFileSync(buildChunksPath, 'utf-8');

test('Desktop runtime local facade is removed instead of re-exporting SDK helpers', () => {
  assert.equal(existsSync(path.resolve(process.cwd(), 'src/runtime/local-runtime/index.ts')), false);
  assert.equal(existsSync(path.resolve(process.cwd(), 'src/runtime/local-runtime/commands.ts')), false);
});

test('desktop shipped progress paths no longer treat tauri local-ai progress as the SSOT', () => {
  assert.equal(existsSync(localAiBridgePath), false);
  assert.equal(existsSync(localAiBridgeParsersPath), false);
  assert.match(localModelCenterDownloadsSource, /runtimeConfigLocalModelCenterClient\.listTransfers\(\)/);
  assert.match(localModelCenterDownloadsSource, /runtimeConfigLocalModelCenterClient\.watchTransferProgress\(/);
  assert.doesNotMatch(buildChunksSource, /bridge\/runtime-bridge\/local-ai|chunk:\s*local-ai/);
});
