import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asCatalogHash,
  asExternalPrincipalId,
  asScopeCatalogVersion,
  asScopeName,
  isNimiErrorLike,
} from '../src/types/index.js';

test('isNimiErrorLike recognizes structured NimiError-shaped objects', () => {
  assert.equal(isNimiErrorLike(new Error('plain error')), false);
  assert.equal(isNimiErrorLike({
    reasonCode: 'TEST_REASON',
    actionHint: 'retry',
    traceId: 'trace-1',
    retryable: false,
    source: 'sdk',
  }), true);
});

test('branded string helpers preserve runtime string values', () => {
  assert.equal(asScopeName('app.test.chat.read'), 'app.test.chat.read');
  assert.equal(asScopeCatalogVersion('1.0.0'), '1.0.0');
  assert.equal(asCatalogHash('hash-1'), 'hash-1');
  assert.equal(asExternalPrincipalId('principal-1'), 'principal-1');
});
