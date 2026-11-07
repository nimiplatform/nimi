import assert from 'node:assert/strict';
import test from 'node:test';

import type { TFunction } from 'i18next';

import { humanizeConnectorError } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-error-copy.js';

const t = ((key: string) => key) as unknown as TFunction;

test('a bounded owner input-format fact explains credential entry without raw details', () => {
  const error = Object.assign(new Error('AI_CONNECTOR_INVALID'), { reasonCode: 'AI_CONNECTOR_INVALID', details: { reasonMetadata: { input_format: 'mubert-customer-pair-v1' } } });
  assert.equal(humanizeConnectorError(error, t, 'save'), 'runtimeConfig.product.errorMubertCredentialFormat');
  assert.equal(error.message, 'AI_CONNECTOR_INVALID');
  assert.equal(humanizeConnectorError({ reasonCode: 'AI_PROVIDER_AUTH_FAILED', details: error.details }, t, 'save'), 'runtimeConfig.product.connectionSaveFailed');
  assert.equal(humanizeConnectorError(Object.assign(new Error('AI_CONNECTOR_INVALID'), { reasonCode: 'AI_CONNECTOR_INVALID', details: { reasonMetadata: { input_format: 'secret-value' } } }), t, 'save'), 'runtimeConfig.product.errorConnectorUnsupported');
});

test('a failed connection check never reads as an unsaved connection', () => {
  const unclassified = 'provider returned an unexpected inventory shape';
  assert.equal(humanizeConnectorError(unclassified, t, 'check'), 'runtimeConfig.product.connectionCheckFailed');
  assert.equal(humanizeConnectorError(unclassified, t, 'save'), 'runtimeConfig.product.connectionSaveFailed');
});

test('a temporarily unavailable provider reads as such for both a save and a check', () => {
  const raw = 'AI_PROVIDER_UNAVAILABLE: upstream returned 503';
  assert.equal(humanizeConnectorError(raw, t, 'check'), 'runtimeConfig.product.errorProviderUnavailable');
  assert.equal(humanizeConnectorError(raw, t, 'save'), 'runtimeConfig.product.errorProviderUnavailable');
});

test('credential, reachability and unsupported-service failures keep their specific reading', () => {
  assert.equal(humanizeConnectorError('AI_PROVIDER_AUTH_FAILED', t, 'check'), 'runtimeConfig.product.errorCredentialRejected');
  assert.equal(humanizeConnectorError('AI_CONNECTOR_CREDENTIAL_MISSING', t, 'check'), 'runtimeConfig.product.errorCredentialRejected');
  assert.equal(humanizeConnectorError('dial tcp: ECONNREFUSED', t, 'check'), 'runtimeConfig.product.errorEndpointUnreachable');
  assert.equal(humanizeConnectorError('AI_CONNECTOR_INVALID', t, 'check'), 'runtimeConfig.product.errorConnectorUnsupported');
});

test('a connection-check timeout is not reported as an unreachable endpoint', () => {
  for (const reason of ['AI_PROVIDER_TIMEOUT', 'DeadlineExceeded', 'DEADLINE_EXCEEDED', 'network request timed out']) {
    assert.equal(humanizeConnectorError(reason, t, 'check'), 'runtimeConfig.product.errorConnectionTimeout');
  }
});
