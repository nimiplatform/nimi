import assert from 'node:assert/strict';
import test from 'node:test';
import { integrationErrorCode } from '../src/shell/renderer/features/integrations/integration-error.js';

test('a native operation-unavailable error retains the concrete connection decision', () => {
  const error = Object.assign(new Error('local-app-operation-unavailable'), {
    details: { command: 'nimi.shell.localApp.integrationPutConnection', reasonMetadata: { integration_reason: 'INTEGRATION_TELEGRAM_BOT_ALREADY_CONNECTED' } },
  });
  assert.equal(integrationErrorCode(error), 'INTEGRATION_TELEGRAM_BOT_ALREADY_CONNECTED');
  assert.equal(integrationErrorCode({ details: { reasonMetadata: { integration_reason: 'INTEGRATION_TELEGRAM_WEBHOOK_CONFLICT' } } }), 'INTEGRATION_TELEGRAM_WEBHOOK_CONFLICT');
});

test('absent or malformed owner metadata never becomes user-facing provider content', () => {
  for (const reason of [null, {}, 'https://private-provider.invalid/body', 'INTEGRATION_BAD\nprivate text', 'INTEGRATION_' + 'A'.repeat(81), 'INTEGRATION_FUTURE_REASON']) {
    assert.equal(integrationErrorCode({ details: { reasonMetadata: { integration_reason: reason } } }), undefined);
  }
  assert.equal(integrationErrorCode(new Error('local-app-owner-unavailable')), undefined);
  assert.equal(integrationErrorCode(new Error('INTEGRATION_TELEGRAM_WEBHOOK_CONFLICT')), undefined);
});
