import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RuntimeBridgeDaemonStatus } from '../src/shell/renderer/bridge/runtime-bridge/types';
import { describeRuntimeDaemonIssue } from '../src/shell/renderer/features/runtime-config/runtime-daemon-guidance';

function createDaemonStatus(input: Partial<RuntimeBridgeDaemonStatus>): RuntimeBridgeDaemonStatus {
  return {
    running: false,
    managed: false,
    launchMode: 'RELEASE',
    grpcAddr: '127.0.0.1:46371',
    ...input,
  };
}

test('describeRuntimeDaemonIssue maps missing bundled runtime to actionable guidance', () => {
  const issue = describeRuntimeDaemonIssue({
    status: createDaemonStatus({
      lastError: 'RUNTIME_BRIDGE_BUNDLED_RUNTIME_UNAVAILABLE: release mode requires a bundled runtime staged under ~/.nimi/runtime',
    }),
  });

  assert.deepEqual(issue, {
    code: 'runtime_binary_missing',
    title: 'Bundled runtime is unavailable',
    message: 'Desktop could not stage the bundled `nimi` runtime. Restart the app or reinstall this desktop release.',
    rawError: 'RUNTIME_BRIDGE_BUNDLED_RUNTIME_UNAVAILABLE: release mode requires a bundled runtime staged under ~/.nimi/runtime',
  });
});

test('describeRuntimeDaemonIssue accepts controller error text even when status is empty', () => {
  const issue = describeRuntimeDaemonIssue({
    runtimeDaemonError: 'runtime daemon start failed: RUNTIME_BRIDGE_BUNDLED_RUNTIME_MISSING',
  });

  assert.equal(issue?.code, 'runtime_binary_missing');
  assert.match(String(issue?.message || ''), /bundled `nimi` runtime/);
});

test('describeRuntimeDaemonIssue returns null for unrelated runtime errors', () => {
  const issue = describeRuntimeDaemonIssue({
    status: createDaemonStatus({
      lastError: 'RUNTIME_BRIDGE_DAEMON_START_TIMEOUT: runtime daemon did not become ready',
    }),
  });

  assert.equal(issue, null);
});

test('runtime config pages render runtime daemon guidance helper', () => {
  const runtimePage = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-runtime.tsx'),
    'utf-8',
  );
  const overviewPage = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-overview.tsx'),
    'utf-8',
  );

  assert.match(runtimePage, /describeRuntimeDaemonIssue/);
  assert.match(overviewPage, /describeRuntimeDaemonIssue/);
});
