import { describe, expect, it } from 'vitest';
import { createAvatarHitRegionSnapshot, hitTestAvatarRegion } from './avatar-hit-region.js';

describe('avatar hit region', () => {
  it('classifies body-local points and transparent outside points', () => {
    const snapshot = createAvatarHitRegionSnapshot({
      body: { x: 10, y: 20, width: 100, height: 200, region: 'body' },
      capturedAtMs: 1000,
    });

    expect(hitTestAvatarRegion(snapshot, { clientX: 60, clientY: 70 }, 1100)).toMatchObject({
      inside: true,
      stale: false,
      region: 'face',
      localX: 50,
      localY: 50,
    });
    expect(hitTestAvatarRegion(snapshot, { clientX: 5, clientY: 70 }, 1100)).toMatchObject({
      inside: false,
      stale: false,
      region: null,
    });
  });

  it('fails closed when hit bounds are stale or unavailable', () => {
    const snapshot = createAvatarHitRegionSnapshot({
      body: { x: 10, y: 20, width: 100, height: 200, region: 'body' },
      capturedAtMs: 1000,
      staleAfterMs: 50,
    });

    expect(hitTestAvatarRegion(snapshot, { clientX: 60, clientY: 70 }, 1101)).toMatchObject({
      inside: false,
      stale: true,
    });
    expect(hitTestAvatarRegion(null, { clientX: 60, clientY: 70 }, 1101)).toMatchObject({
      inside: false,
      stale: true,
    });
  });
});
