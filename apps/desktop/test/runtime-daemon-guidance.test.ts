import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS } from '@nimiplatform/sdk/runtime';
import type { RuntimeBridgeDaemonStatus } from '../src/shell/renderer/bridge/runtime-bridge/types';
import { describeRuntimeDaemonIssue } from '../src/shell/renderer/features/runtime-config/runtime-daemon-guidance';

function createDaemonStatus(input: Partial<RuntimeBridgeDaemonStatus>): RuntimeBridgeDaemonStatus {
  return {
    running: false,
    managed: false,
    launchMode: 'INVALID',
    grpcAddr: NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS.grpcAddr,
    ...input,
  };
}

for (const [reason, code, title] of [
  ['runtime-service-unavailable', 'runtime_service_unavailable', 'Runtime service unavailable'],
  ['runtime-service-untrusted', 'runtime_service_untrusted', 'Runtime service identity rejected'],
  ['runtime-service-repair-required', 'runtime_service_repair_required', 'Runtime service repair required'],
  ['runtime-restarted', 'runtime_restarted', 'Runtime restarted'],
  ['process-replaced', 'process_replaced', 'Runtime process replaced'],
] as const) {
  test(`describeRuntimeDaemonIssue preserves ${reason}`, () => {
    const issue = describeRuntimeDaemonIssue({
      status: createDaemonStatus({ lastError: `RUNTIME_BRIDGE_DAEMON_UNAVAILABLE: ${reason}` }),
    });
    assert.equal(issue?.code, code);
    assert.equal(issue?.title, title);
    assert.match(issue?.rawError || '', new RegExp(reason));
  });
}

test('describeRuntimeDaemonIssue maps missing protected carrier to repair', () => {
  const issue = describeRuntimeDaemonIssue({
    runtimeDaemonError: 'RUNTIME_BRIDGE_DAEMON_UNAVAILABLE: protected-carrier-required',
  });
  assert.equal(issue?.code, 'runtime_service_repair_required');
  assert.match(issue?.message || '', /protected native carrier/);
});

test('describeRuntimeDaemonIssue returns null for unrelated runtime errors', () => {
  const issue = describeRuntimeDaemonIssue({
    status: createDaemonStatus({ lastError: 'unrelated-error' }),
  });
  assert.equal(issue, null);
});

test('runtime config pages render runtime daemon guidance helper', () => {
  const runtimeOverviewTab = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-runtime-overview-tab.tsx'),
    'utf-8',
  );
  const overviewPage = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-overview.tsx'),
    'utf-8',
  );
  assert.match(runtimeOverviewTab, /describeRuntimeDaemonIssue/);
  assert.match(overviewPage, /describeRuntimeDaemonIssue/);
});
