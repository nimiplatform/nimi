import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { updateConnectorField } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-actions';
import type { RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';

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

test('editing a connector endpoint preserves its Runtime provider identity', () => {
  const initial = {
    connectors: [{
      id: 'connector-1',
      provider: 'deepseek',
      endpoint: 'https://old.example.test',
    }],
    selectedConnectorId: 'connector-1',
  } as RuntimeConfigStateV11;

  const next = updateConnectorField(initial, 'connector-1', {
    endpoint: 'https://custom.example.test',
  });

  assert.equal(next.connectors[0]?.endpoint, 'https://custom.example.test');
  assert.equal(next.connectors[0]?.provider, 'deepseek');
});
