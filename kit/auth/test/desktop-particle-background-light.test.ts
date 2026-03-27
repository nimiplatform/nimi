import { describe, expect, it } from 'vitest';

import { shouldEnableDesktopParticleBackground } from '../src/components/desktop-particle-background-light';

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
