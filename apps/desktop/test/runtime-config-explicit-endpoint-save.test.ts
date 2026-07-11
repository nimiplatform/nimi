import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('runtime local endpoint is a Runtime-owned status projection', () => {
  const runtimeOverviewTabSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-runtime-overview-tab.tsx',
  );

  assert.equal(
    existsSync(path.join(repoRoot, 'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller-bridge-sync.ts')),
    false,
  );
  assert.doesNotMatch(runtimeOverviewTabSource, /saveRuntimeLocalEndpoint|endpointDraft|setRuntimeBridgeConfig/);
  assert.match(runtimeOverviewTabSource, /Runtime service controls this endpoint/);
});
