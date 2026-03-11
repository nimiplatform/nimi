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

test('describeRuntimeDaemonIssue maps missing nimi binary to actionable guidance', () => {
  const issue = describeRuntimeDaemonIssue({
    status: createDaemonStatus({
      lastError: 'RUNTIME_BRIDGE_RUNTIME_BINARY_NOT_FOUND: release mode requires `nimi` in PATH (or set NIMI_RUNTIME_BINARY)',
    }),
  });

  assert.deepEqual(issue, {
    code: 'runtime_binary_missing',
    title: 'Nimi runtime binary not found',
    message: 'Desktop could not find the `nimi` binary. Install it or set `NIMI_RUNTIME_BINARY`, then refresh or start the runtime daemon again.',
    rawError: 'RUNTIME_BRIDGE_RUNTIME_BINARY_NOT_FOUND: release mode requires `nimi` in PATH (or set NIMI_RUNTIME_BINARY)',
  });
});

test('describeRuntimeDaemonIssue accepts controller error text even when status is empty', () => {
  const issue = describeRuntimeDaemonIssue({
    runtimeDaemonError: 'runtime daemon start failed: RUNTIME_BRIDGE_RUNTIME_BINARY_NOT_FOUND',
  });

  assert.equal(issue?.code, 'runtime_binary_missing');
  assert.match(String(issue?.message || ''), /NIMI_RUNTIME_BINARY/);
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
