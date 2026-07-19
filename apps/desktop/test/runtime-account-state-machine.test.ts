import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AccountReasonCode, RuntimeReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import type {
  DesktopAccountSessionEvent,
  DesktopAccountSessionState,
  DesktopAccountSessionStatus,
} from '../src/shell/renderer/bridge/runtime-bridge.js';
import {
  advanceRuntimeAccountStreamCursor,
  createRuntimeAccountStreamCursor,
  projectRuntimeAccountAuthState,
  runtimeAccountClearsAccountMemory,
  runtimeAccountConnectivityDisposition,
} from '../src/shell/renderer/infra/bootstrap/runtime-account-state-machine.js';

const accountProjection = {
  accountId: 'account-1',
  displayName: 'Nimi User',
  realmEnvironmentId: 'realm-1',
};

function status(
  state: DesktopAccountSessionState,
  sequence = '7',
): DesktopAccountSessionStatus {
  return {
    sequence,
    state,
    reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
    accountReasonCode: AccountReasonCode.ACTION_EXECUTED,
    ...(state === 'authenticated' || state === 'refresh-pending'
      || state === 'switching' || state === 'logging-out'
      ? { accountProjection }
      : {}),
  };
}

function event(
  sequence: string,
  deliveryKind: DesktopAccountSessionEvent['deliveryKind'],
  options: { replayTruncated?: boolean } = {},
): DesktopAccountSessionEvent {
  return {
    ...status('authenticated', sequence),
    deliveryKind,
    replayTruncated: options.replayTruncated ?? false,
  };
}

describe('Desktop Runtime account state machine', () => {
  test('accepts replay in order, one current snapshot, then strictly increasing live events', () => {
    let cursor = createRuntimeAccountStreamCursor('7');
    for (const next of [event('8', 'replay'), event('9', 'replay'), event('9', 'snapshot'), event('10', 'live')]) {
      const result = advanceRuntimeAccountStreamCursor(cursor, next);
      assert.equal(result.kind, 'apply');
      if (result.kind === 'apply') cursor = result.cursor;
    }
    assert.deepEqual(cursor, { sequence: 10n, snapshotObserved: true });
  });

  test('requires status resync for replay truncation, gaps, duplicate snapshot, and pre-snapshot live', () => {
    const start = createRuntimeAccountStreamCursor('7');
    assert.deepEqual(
      advanceRuntimeAccountStreamCursor(start, event('8', 'replay', { replayTruncated: true })),
      { kind: 'resync', reason: 'replay-truncated' },
    );
    assert.deepEqual(
      advanceRuntimeAccountStreamCursor(start, event('9', 'replay')),
      { kind: 'resync', reason: 'invalid-replay-order' },
    );
    assert.deepEqual(
      advanceRuntimeAccountStreamCursor(start, event('8', 'live')),
      { kind: 'resync', reason: 'live-sequence-gap' },
    );
    const snapshot = advanceRuntimeAccountStreamCursor(start, event('7', 'snapshot'));
    assert.equal(snapshot.kind, 'apply');
    if (snapshot.kind !== 'apply') return;
    assert.deepEqual(
      advanceRuntimeAccountStreamCursor(snapshot.cursor, event('7', 'snapshot')),
      { kind: 'resync', reason: 'invalid-snapshot-order' },
    );
    assert.deepEqual(
      advanceRuntimeAccountStreamCursor(snapshot.cursor, event('9', 'live')),
      { kind: 'resync', reason: 'live-sequence-gap' },
    );
  });

  test('projects the complete Runtime state set without inventing anonymous state', () => {
    const currentUser = { id: 'retained-account' };
    const states: DesktopAccountSessionState[] = [
      'anonymous',
      'login-pending',
      'authenticated',
      'refresh-pending',
      'expired',
      'reauth-required',
      'switching',
      'logging-out',
      'unavailable',
    ];
    for (const state of states) {
      const projection = projectRuntimeAccountAuthState(status(state), currentUser);
      assert.equal(projection.status, state);
      if (state === 'authenticated') {
        assert.equal(projection.user?.id, 'account-1');
      } else if (state === 'refresh-pending' || state === 'switching' || state === 'logging-out') {
        assert.ok(projection.user, `${state} must retain account shell identity`);
      } else {
        assert.equal(projection.user, null, `${state} must not retain account memory`);
      }
    }
    assert.equal(runtimeAccountConnectivityDisposition('authenticated', 'bootstrapping'), 'unchanged');
    assert.equal(runtimeAccountConnectivityDisposition('authenticated', 'authenticated'), 'unchanged');
    assert.equal(runtimeAccountConnectivityDisposition('authenticated', 'refresh-pending'), 'reachable');
    assert.equal(runtimeAccountConnectivityDisposition('authenticated', 'login-pending'), 'reachable');
    for (const state of ['anonymous', 'expired', 'reauth-required', 'unavailable'] as const) {
      assert.equal(runtimeAccountConnectivityDisposition(state), 'unknown');
    }
    assert.equal(runtimeAccountConnectivityDisposition('refresh-pending'), 'unchanged');
    assert.equal(runtimeAccountClearsAccountMemory('anonymous'), true);
    assert.equal(runtimeAccountClearsAccountMemory('expired'), true);
    assert.equal(runtimeAccountClearsAccountMemory('reauth-required'), true);
    assert.equal(runtimeAccountClearsAccountMemory('switching'), true);
    assert.equal(runtimeAccountClearsAccountMemory('logging-out'), true);
    assert.equal(runtimeAccountClearsAccountMemory('unavailable'), true);
    assert.equal(runtimeAccountClearsAccountMemory('refresh-pending'), false);
  });
});
