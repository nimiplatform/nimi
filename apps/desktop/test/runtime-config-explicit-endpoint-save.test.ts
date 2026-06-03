import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('runtime local endpoint config is saved only through explicit user intent', () => {
  const syncSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller-bridge-sync.ts',
  );
  const runtimePageSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-runtime.tsx',
  );
  const localPageSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-local.tsx',
  );
  const storagePersistSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-storage-persist.ts',
  );
  const storageNormalizeSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-storage-normalize.ts',
  );

  assert.match(syncSource, /saveRuntimeLocalEndpoint/);
  assert.match(syncSource, /buildRuntimeBridgeConfigFromLocalEndpoint\(endpoint, baseConfig\)/);
  assert.doesNotMatch(syncSource, /serializeRuntimeBridgeProjection|runtimeBridgeFailedProjectionRef|runtimeBridgeProjectionRef/);
  assert.doesNotMatch(syncSource, /setTimeout\(\(\) =>[\s\S]*setRuntimeBridgeConfig/);
  assert.match(runtimePageSource, /const \[endpointDraft, setEndpointDraft\]/);
  assert.match(runtimePageSource, /model\.saveRuntimeLocalEndpoint\(endpointDraft\)/);
  assert.doesNotMatch(runtimePageSource, /local:\s*\{\s*\.{3}prev\.local,\s*endpoint:/);
  assert.doesNotMatch(localPageSource, /onChangeLocalEndpoint/);
  assert.match(storagePersistSource, /endpoint:\s*''/);
  assert.doesNotMatch(storageNormalizeSource, /rawLocalRecord\.endpoint/);
});
