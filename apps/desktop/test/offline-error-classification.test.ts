import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ReasonCode } from '@nimiplatform/sdk/types';

import { isRealmOfflineError } from '../src/runtime/offline/errors.js';

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
});
