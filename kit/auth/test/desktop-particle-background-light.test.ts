import { describe, expect, it } from 'vitest';

import { shouldEnableDesktopParticleBackground } from '../src/components/desktop-particle-background-light';
import { MAX_PARTICLE_PAIR_ATTEMPTS, particleCellKey, visitParticleNeighbors } from '../src/components/particle-background-neighbors';

type TestEnvironmentOptions = {
  reducedMotion?: boolean;
  saveData?: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  hasWebGL?: boolean;
};

function createTestEnvironment(options: TestEnvironmentOptions = {}) {
  const {
    reducedMotion = false,
    saveData = false,
    hardwareConcurrency = 8,
    deviceMemory = 8,
    hasWebGL = true,
  } = options;

  return {
    document: {
      createElement() {
        return {
          getContext() {
            return hasWebGL ? {} : null;
          },
        };
      },
    },
    matchMedia() {
      return { matches: reducedMotion };
    },
    navigator: {
      hardwareConcurrency,
      deviceMemory,
      connection: {
        saveData,
      },
    },
  };
}

describe('shouldEnableDesktopParticleBackground', () => {
  it('disables the particle background when reduced motion is requested', () => {
    expect(
      shouldEnableDesktopParticleBackground(
        createTestEnvironment({
          reducedMotion: true,
        }),
      ),
    ).toBe(false);
  });

  it('disables the particle background on low-capability or save-data devices', () => {
    expect(
      shouldEnableDesktopParticleBackground(
        createTestEnvironment({
          hardwareConcurrency: 2,
        }),
      ),
    ).toBe(false);
    expect(
      shouldEnableDesktopParticleBackground(
        createTestEnvironment({
          deviceMemory: 2,
        }),
      ),
    ).toBe(false);
    expect(
      shouldEnableDesktopParticleBackground(
        createTestEnvironment({
          saveData: true,
        }),
      ),
    ).toBe(false);
  });

  it('disables the particle background when WebGL is unavailable', () => {
    expect(
      shouldEnableDesktopParticleBackground(
        createTestEnvironment({
          hasWebGL: false,
        }),
      ),
    ).toBe(false);
  });

  it('keeps the particle background enabled on capable devices', () => {
    expect(shouldEnableDesktopParticleBackground(createTestEnvironment())).toBe(true);
  });
});

describe('particle neighbor budget', () => {
  it.each([500, 1000, 5000])('bounds comparisons even when all %i particles occupy one cell', (count) => {
    const pairs: string[] = [];
    const bucket = Array.from({ length: count }, (_, index) => index);
    const attempts = visitParticleNeighbors(new Map([[particleCellKey(0, 0), bucket]]), new Int32Array(count * 2), count,
      (left, right) => { expect(right).toBeGreaterThan(left); pairs.push(`${left}:${right}`); });
    expect(attempts).toBeLessThanOrEqual(MAX_PARTICLE_PAIR_ATTEMPTS);
    expect(pairs.length).toBeLessThanOrEqual(attempts);
    expect(new Set(pairs).size).toBe(pairs.length);
    if (count <= 1000) {
      expect(new Set(pairs.flatMap(pair => pair.split(':'))).size).toBe(count);
    }
  });

  it('finds neighbors across cell boundaries and excludes non-neighboring cells', () => {
    const cells = new Int32Array([0, 0, -1, 0, 5, 0]);
    const buckets = new Map([[particleCellKey(0, 0), [0]], [particleCellKey(-1, 0), [1]], [particleCellKey(5, 0), [2]]]);
    const pairs: number[][] = [];
    visitParticleNeighbors(buckets, cells, 3, (left, right) => pairs.push([left, right]));
    expect(pairs).toEqual([[0, 1]]);
  });

  it('keeps cross-cell connections when both cells are dense at the Web particle count', () => {
    const cells = new Int32Array(2000);
    for (let i = 500; i < 1000; i++) cells[i * 2] = 1;
    const buckets = new Map([
      [particleCellKey(0, 0), Array.from({ length: 500 }, (_, i) => i)],
      [particleCellKey(1, 0), Array.from({ length: 500 }, (_, i) => i + 500)],
    ]);
    let crossCell = 0;
    const attempts = visitParticleNeighbors(buckets, cells, 1000, (left, right) => {
      if (left < 500 && right >= 500) crossCell++;
    });
    expect(crossCell).toBeGreaterThanOrEqual(500);
    expect(attempts).toBeLessThanOrEqual(MAX_PARTICLE_PAIR_ATTEMPTS);
  });
});
