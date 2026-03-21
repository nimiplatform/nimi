import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeBridgeDaemonStatus } from '../src/shell/renderer/bridge/runtime-bridge/types';
import { applyRuntimeDaemonStatusToConfigState } from '../src/shell/renderer/features/runtime-config/runtime-daemon-state';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
import type { RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';

const DEFAULT_GRPC_ADDR = '127.0.0.1:46371';
const CHECKED_AT = '2026-02-24T12:00:00.000Z';

function createBaseState(): RuntimeConfigStateV11 {
  return createDefaultStateV11({
    provider: 'local',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
    localProviderModel: 'local-model',
    localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
  });
}

function createDaemonStatus(input: Partial<RuntimeBridgeDaemonStatus>): RuntimeBridgeDaemonStatus {
  return {
    running: false,
    managed: false,
    launchMode: 'INVALID',
    grpcAddr: DEFAULT_GRPC_ADDR,
    ...input,
  };
}

test('stopped daemon marks local runtime unreachable with detailed reason', () => {
  const previous = createBaseState();
  const next = applyRuntimeDaemonStatusToConfigState(
    previous,
    createDaemonStatus({
      running: false,
      managed: true,
      lastError: 'RUNTIME_BRIDGE_DAEMON_START_TIMEOUT',
    }),
    'poll',
    CHECKED_AT,
  );

  assert.equal(next.local.status, 'unreachable');
  assert.equal(next.local.lastCheckedAt, CHECKED_AT);
  assert.equal(
    next.local.lastDetail,
    'runtime daemon stopped (127.0.0.1:46371) · mode=INVALID: RUNTIME_BRIDGE_DAEMON_START_TIMEOUT',
  );
});

test('same stopped snapshot keeps previous object reference', () => {
  const previous = createBaseState();
  previous.local.status = 'unreachable';
  previous.local.lastDetail = 'runtime daemon stopped (127.0.0.1:46371) · mode=INVALID';

  const next = applyRuntimeDaemonStatusToConfigState(
    previous,
    createDaemonStatus({ running: false, managed: false }),
    'poll',
    CHECKED_AT,
  );

  assert.equal(next, previous);
});

test('polling running daemon keeps healthy status unchanged', () => {
  const previous = createBaseState();
  previous.local.status = 'idle';
  previous.local.lastCheckedAt = '2026-02-24T10:00:00.000Z';
  previous.local.lastDetail = 'healthy';

  const next = applyRuntimeDaemonStatusToConfigState(
    previous,
    createDaemonStatus({ running: true, managed: true, pid: 9527 }),
    'poll',
    CHECKED_AT,
  );

  assert.equal(next, previous);
});

test('polling running daemon recovers unreachable state to idle', () => {
  const previous = createBaseState();
  previous.local.status = 'unreachable';
  previous.local.lastDetail = 'runtime daemon stopped (127.0.0.1:46371)';

  const next = applyRuntimeDaemonStatusToConfigState(
    previous,
    createDaemonStatus({ running: true, managed: true, pid: 9528 }),
    'poll',
    CHECKED_AT,
  );

  assert.equal(next.local.status, 'idle');
  assert.equal(next.local.lastCheckedAt, CHECKED_AT);
  assert.equal(next.local.lastDetail, 'runtime daemon running (127.0.0.1:46371) · mode=INVALID');
});

test('action mode enforces running detail refresh even when already idle', () => {
  const previous = createBaseState();
  previous.local.status = 'idle';
  previous.local.lastDetail = '';
  previous.local.lastCheckedAt = null;

  const next = applyRuntimeDaemonStatusToConfigState(
    previous,
    createDaemonStatus({ running: true, managed: true, pid: 9529 }),
    'action',
    CHECKED_AT,
  );

  assert.equal(next.local.status, 'idle');
  assert.equal(next.local.lastCheckedAt, CHECKED_AT);
  assert.equal(next.local.lastDetail, 'runtime daemon running (127.0.0.1:46371) · mode=INVALID');
});

test('running detail includes launch mode when provided', () => {
  const previous = createBaseState();
  previous.local.status = 'unreachable';
  previous.local.lastDetail = 'runtime daemon stopped (127.0.0.1:46371)';

  const next = applyRuntimeDaemonStatusToConfigState(
    previous,
    createDaemonStatus({
      running: true,
      managed: true,
      pid: 9530,
      launchMode: 'RUNTIME',
    }),
    'poll',
    CHECKED_AT,
  );

  assert.equal(next.local.lastDetail, 'runtime daemon running (127.0.0.1:46371) · mode=RUNTIME');
});
