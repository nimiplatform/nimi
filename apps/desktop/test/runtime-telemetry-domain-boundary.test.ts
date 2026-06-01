import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Runtime log formatter and injected sink migrated to Kit telemetry', () => {
  const kitTelemetryIndex = read('kit/telemetry/src/telemetry/index.ts');
  const kitRuntimeLog = read('kit/telemetry/src/telemetry/runtime-log.ts');
  const desktopLogger = read('apps/desktop/src/runtime/telemetry/logger.ts');

  assert.match(kitTelemetryIndex, /runtime-log/);
  assert.match(kitRuntimeLog, /export function emitRuntimeLog/);
  assert.match(kitRuntimeLog, /export function setRuntimeLogger/);
  assert.match(kitRuntimeLog, /export function toRuntimeLogMessage/);
  assert.doesNotMatch(kitRuntimeLog, /@renderer|@runtime|apps\//);

  assert.match(desktopLogger, /from '@nimiplatform\/kit\/telemetry'/);
  assert.match(desktopLogger, /emitRuntimeLog/);
  assert.match(desktopLogger, /setRuntimeLogger/);
  assert.doesNotMatch(desktopLogger, /let runtimeLogger|function fallbackConsoleLog|function normalizeRuntimeLogMessage/);
});

test('Tester consumes Kit runtime telemetry as second app proof', () => {
  const workbench = read('apps/tester/src/tester/tester-workbench.tsx');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');

  assert.match(workbench, /emitRuntimeLog/);
  assert.match(workbench, /from '@nimiplatform\/kit\/telemetry'/);
  assert.match(workbench, /area:\s*'tester-history'/);
  assert.match(workbench, /message:\s*'history-load-failed'/);
  assert.match(testerContract, /emitRuntimeLog/);
});
