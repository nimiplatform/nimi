import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIMARY_GRADIENT_PALETTE, sampleGradient } from '../src/landing/components/gradient-text.js';

test('gradient sampling returns the palette endpoints', () => {
  assert.equal(sampleGradient(PRIMARY_GRADIENT_PALETTE, 0), PRIMARY_GRADIENT_PALETTE[0]);
  assert.equal(
    sampleGradient(PRIMARY_GRADIENT_PALETTE, 1),
    PRIMARY_GRADIENT_PALETTE[PRIMARY_GRADIENT_PALETTE.length - 1],
  );
});

test('gradient sampling clamps out-of-range positions', () => {
  assert.equal(sampleGradient(PRIMARY_GRADIENT_PALETTE, -3), PRIMARY_GRADIENT_PALETTE[0]);
  assert.equal(
    sampleGradient(PRIMARY_GRADIENT_PALETTE, 42),
    PRIMARY_GRADIENT_PALETTE[PRIMARY_GRADIENT_PALETTE.length - 1],
  );
  assert.equal(sampleGradient(PRIMARY_GRADIENT_PALETTE, Number.NaN), PRIMARY_GRADIENT_PALETTE[0]);
});

test('gradient sampling always yields a six-digit hex color', () => {
  for (let step = 0; step <= 10; step += 1) {
    const color = sampleGradient(PRIMARY_GRADIENT_PALETTE, step / 10);
    assert.match(color, /^#[0-9a-f]{6}$/);
  }
  assert.equal(sampleGradient([], 0.5), '#0f172a');
  assert.equal(sampleGradient(['#123456'], 0.5), '#123456');
});
