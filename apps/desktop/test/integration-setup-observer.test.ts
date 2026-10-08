import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiIntegrationConnectionSetup } from '@nimiplatform/sdk/app';
import { observeIntegrationSetup } from '../src/shell/renderer/features/integrations/integration-setup-observer.js';

const epoch = Date.parse('2026-10-05T10:00:00Z');
const setup = (): NimiIntegrationConnectionSetup => ({ setupId: 'setup', adapter: 'weixin', status: 'awaiting-confirmation', expiresAt: new Date(epoch + 4000).toISOString(), verificationUrl: 'https://official/qr' } as NimiIntegrationConnectionSetup);

test('persistent query failure ends observation at known expiry and permits local recovery', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
  let queries = 0, failures = 0, expired = 0;
  let state = setup(), locked = true;
  const stop = observeIntegrationSetup({ setup: state, query: async () => { queries++; throw new Error('Runtime unreachable'); }, update: () => assert.fail('remote terminal fabricated'), error: () => { failures++; }, expired: () => { expired++; state = { ...state, verificationUrl: '' }; locked = false; } });
  for (let index = 0; index < 3; index++) { t.mock.timers.tick(1000); await Promise.resolve(); await Promise.resolve(); }
  assert.equal(queries, 3); assert.equal(failures, 3);
  t.mock.timers.tick(1000); await Promise.resolve();
  assert.equal(expired, 1); assert.equal(locked, false); assert.equal(state.verificationUrl, '');
  assert.equal(state.status, 'awaiting-confirmation', 'local expiry must not invent remote cancellation');
  t.mock.timers.tick(60000); await Promise.resolve(); assert.equal(queries, 3); stop();
});

test('a stalled query cannot postpone local expiry or publish its late response', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
  let resolve!: (value: NimiIntegrationConnectionSetup) => void;
  let expired = 0, updates = 0;
  const stop = observeIntegrationSetup({ setup: setup(), query: () => new Promise(r => { resolve = r; }), update: () => { updates++; }, error: () => assert.fail(), expired: () => { expired++; } });
  t.mock.timers.tick(1000); t.mock.timers.tick(3000); assert.equal(expired, 1);
  resolve({ ...setup(), status: 'completed' }); await Promise.resolve(); assert.equal(updates, 0); stop();
});

test('scope or component cleanup suppresses pending RPC responses and the deadline', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
  let resolve!: (value: NimiIntegrationConnectionSetup) => void;
  const stop = observeIntegrationSetup({ setup: setup(), query: () => new Promise(r => { resolve = r; }), update: () => assert.fail('stale update'), error: () => assert.fail(), expired: () => assert.fail('unmounted deadline') });
  t.mock.timers.tick(1000); stop(); resolve(setup()); await Promise.resolve(); t.mock.timers.tick(10000);
});
