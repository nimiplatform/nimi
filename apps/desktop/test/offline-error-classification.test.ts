import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ReasonCode } from '@nimiplatform/sdk/types';

import { isRealmOfflineError, isRuntimeOfflineError } from '../src/runtime/offline/errors.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATASYNC_FACADE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/runtime/data-sync/facade.ts'),
  'utf8',
);

describe('D-OFFLINE-001: realm offline error classification', () => {
  test('REALM_UNAVAILABLE is treated as offline', () => {
    const error = Object.assign(new Error('realm unavailable'), {
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'retry',
      retryable: true,
    });

    assert.equal(isRealmOfflineError(error), true);
  });

  test('retryable REALM_RATE_LIMITED is not treated as offline', () => {
    const error = Object.assign(new Error('rate limited'), {
      reasonCode: ReasonCode.REALM_RATE_LIMITED,
      actionHint: 'retry_later',
      retryable: true,
    });

    assert.equal(isRealmOfflineError(error), false);
  });

  test('retryable provider errors are not treated as Runtime offline', () => {
    const error = Object.assign(new Error('provider timed out'), {
      reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
      actionHint: 'retry_provider_request',
      retryable: true,
    });

    assert.equal(isRuntimeOfflineError(error), false);
  });

  test('transport failures are treated as offline', () => {
    assert.equal(isRealmOfflineError(new Error('fetch failed')), true);
    assert.equal(isRealmOfflineError(new Error('network timeout while loading realm')), true);
  });

  test('fixture and HTTP gateway 503 Realm unavailable errors are treated as offline', () => {
    const error = Object.assign(new Error('REALM_UNAVAILABLE: fixture rest offline'), {
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'retry_realm_request',
      retryable: true,
    });

    assert.equal(isRealmOfflineError(error), true);
  });

  test('Desktop consumes SDK offline reason-code projections instead of local Sets', () => {
    const offlineErrorSource = readFileSync(
      resolve(import.meta.dirname, '../src/runtime/offline/errors.ts'),
      'utf8',
    );

    assert.match(offlineErrorSource, /classifyOfflineError/);
    assert.doesNotMatch(offlineErrorSource, /isRealmOfflineReasonCode/);
    assert.doesNotMatch(offlineErrorSource, /isRuntimeOfflineReasonCode/);
    assert.doesNotMatch(offlineErrorSource, /REALM_OFFLINE_REASON_CODES/);
    assert.doesNotMatch(offlineErrorSource, /RUNTIME_OFFLINE_REASON_CODES/);
    assert.doesNotMatch(offlineErrorSource, /fetch failed\|failed to fetch/);
  });

  test('DataSync facade projects Realm unavailable errors from its unified error outlet', () => {
    assert.match(DATASYNC_FACADE_SOURCE, /emitDataSyncError\(action: string, error: unknown/);
    assert.match(DATASYNC_FACADE_SOURCE, /errorFields\.reasonCode === ReasonCode\.REALM_UNAVAILABLE/);
    assert.match(DATASYNC_FACADE_SOURCE, /getOfflineCoordinator\(\)\.markRealmRestReachable\(false\)/);
  });
});
