import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const sourcePath = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-health-coordinator.ts',
);

function readSource(): string {
  return readFileSync(sourcePath, 'utf8');
}

test('desktop runtime health coordinator delegates orchestration to SDK', () => {
  const source = readSource();

  assert.match(source, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(source, /new NimiRuntimeHealthCoordinator\(/);
  assert.match(source, /useSyncExternalStore/);
  assert.doesNotMatch(source, /class RuntimeHealthCoordinator/);
  assert.doesNotMatch(source, /HEALTH_STALE_MS/);
  assert.doesNotMatch(source, /HEALTH_WATCHDOG_INTERVAL_MS/);
  assert.doesNotMatch(source, /for await \(const event of stream\)/);
  assert.doesNotMatch(source, /function mergeProviderSnapshot/);
});
