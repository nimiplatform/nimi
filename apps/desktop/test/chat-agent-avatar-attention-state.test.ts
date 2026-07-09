import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIdleAppAttentionState,
  resolveAppAttentionStateFromViewport,
  shouldUpdateAppAttentionState,
} from '../src/shell/renderer/app-shell/providers/app-attention-state.js';

test('app attention normalizes viewport coordinates into a bounded symmetric range', () => {
  const state = resolveAppAttentionStateFromViewport({
    clientX: 720,
    clientY: 450,
    viewport: {
      width: 1440,
      height: 900,
    },
    presence: 1,
  });

  assert.equal(state.active, true);
  assert.equal(state.presence, 1);
  assert.equal(state.normalizedX, 0);
  assert.equal(state.normalizedY, 0);
});

test('app attention clamps out-of-bounds positions and applies a center deadzone', () => {
  const clamped = resolveAppAttentionStateFromViewport({
    clientX: 2000,
    clientY: -200,
    viewport: {
      width: 1000,
      height: 1000,
    },
    presence: 1,
  });
  const deadzone = resolveAppAttentionStateFromViewport({
    clientX: 501,
    clientY: 500,
    viewport: {
      width: 1000,
      height: 1000,
    },
    presence: 1,
  });

  assert.equal(clamped.normalizedX, 1);
  assert.equal(clamped.normalizedY, -1);
  assert.equal(deadzone.normalizedX, 0);
  assert.equal(deadzone.normalizedY, 0);
});

test('app attention fails closed when viewport bounds are invalid', () => {
  assert.deepEqual(
    resolveAppAttentionStateFromViewport({
      clientX: 100,
      clientY: 100,
      viewport: {
        width: 0,
        height: 900,
      },
    }),
    createIdleAppAttentionState(),
  );
});

test('attention updates ignore sub-epsilon jitter', () => {
  assert.equal(
    shouldUpdateAppAttentionState(
      {
        active: true,
        presence: 0.4,
        normalizedX: 0.2,
        normalizedY: -0.1,
      },
      {
        active: true,
        presence: 0.409,
        normalizedX: 0.209,
        normalizedY: -0.11,
      },
    ),
    false,
  );
});
