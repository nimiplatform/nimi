import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('menu bar runtime sync consumes shared coordinator state instead of direct health fetches', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src/shell/renderer/infra/menu-bar/menu-bar-runtime-sync.ts'),
    'utf8',
  );

  assert.match(source, /useRuntimeHealthCoordinatorState/);
  assert.match(source, /export function connectMenuBarRuntimeSync\(/);
  assert.match(source, /getRuntimeHealthCoordinator/);
  assert.match(source, /lifecycle\.subscribeBootstrap\(reconcile\)/);
  assert.match(source, /coordinator\.subscribe\(reconcile\)/);
  assert.match(source, /projectNimiRuntimeHealthStatusName/);
  assert.doesNotMatch(source, /function normalizeRuntimeHealthStatus/);
  assert.doesNotMatch(source, /status === 3/);
  assert.doesNotMatch(source, /fetchRuntimeHealth/);
  assert.doesNotMatch(source, /fetchProviderHealth/);
  assert.doesNotMatch(source, /subscribeRuntimeHealth/);
  assert.doesNotMatch(source, /subscribeProviderHealth/);
});
