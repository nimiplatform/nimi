import assert from 'node:assert/strict';
import test from 'node:test';

import { isZhiyuResourcePackPlacementReady } from '../src/production/resource-pack-placement-readiness.ts';

const available = { state: 'available', reason: null, nextStep: null };
const unavailable = { state: 'unavailable', reason: 'runtime-offline', nextStep: 'retry' };

function snapshot(phase, replaceAppearance, appearance = {}) {
  return {
    phase,
    availability: { replaceAppearance },
    state: {
      appearance: {
        status: 'not_configured',
        presentationRevision: '4',
        ...appearance,
      },
    },
    error: phase === 'degraded' ? 'Memory read unavailable' : null,
  };
}

test('placement readiness ignores unrelated AgentCenter degradation', () => {
  assert.equal(isZhiyuResourcePackPlacementReady(snapshot('degraded', available)), true);
  assert.equal(isZhiyuResourcePackPlacementReady(snapshot('ready', available)), true);
});

test('placement readiness still requires presentation and replace availability', () => {
  assert.equal(isZhiyuResourcePackPlacementReady(snapshot('loading', available)), false);
  assert.equal(isZhiyuResourcePackPlacementReady(snapshot('degraded', unavailable)), false);
  assert.equal(isZhiyuResourcePackPlacementReady(snapshot('ready', available, { presentationRevision: null })), false);
  assert.equal(isZhiyuResourcePackPlacementReady(snapshot('ready', available, { status: 'invalid' })), false);
});
