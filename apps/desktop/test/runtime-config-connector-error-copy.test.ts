import assert from 'node:assert/strict';
import test from 'node:test';

import type { TFunction } from 'i18next';

import { humanizeConnectorError } from '../src/shell/renderer/features/runtime-config/runtime-config-page-cloud-detail-panel.js';

const t = ((key: string) => key) as unknown as TFunction;

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
  assert.equal(humanizeConnectorError('dial tcp: ECONNREFUSED', t, 'check'), 'runtimeConfig.product.errorEndpointUnreachable');
  assert.equal(humanizeConnectorError('AI_CONNECTOR_INVALID', t, 'check'), 'runtimeConfig.product.errorConnectorUnsupported');
});
