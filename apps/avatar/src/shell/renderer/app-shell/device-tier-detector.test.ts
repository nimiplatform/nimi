// Contract tests for docs/authority/avatar-embodiment-rationale.md.
//
// Tests for device-tier-detector. Use probeOverride for deterministic
// classification across all tier boundaries; verify cache + clear
// semantics independently.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearDeviceTierCache,
  detectDeviceTier,
  getCachedDeviceTier,
} from './device-tier-detector.js';

describe('detectDeviceTier — Tier A (Apple Silicon)', () => {
  beforeEach(() => clearDeviceTierCache());
  afterEach(() => clearDeviceTierCache());

  it('classifies "Apple GPU" as Tier A', () => {
    const det = detectDeviceTier({
      probeOverride: { rendererString: 'Apple GPU', webglAvailable: true },
    });
    expect(det.tier).toBe('A');
    expect(det.reason).toBe('apple_silicon');
    expect(det.rendererString).toBe('Apple GPU');
    expect(det.webglAvailable).toBe(true);
  });

  it('classifies "Apple M3 Pro" as Tier A', () => {
    const det = detectDeviceTier({
      probeOverride: {
        rendererString: 'Apple M3 Pro',
        webglAvailable: true,
      },
    });
    expect(det.tier).toBe('A');
  });

  it('classifies a bare "M1" / "M2" / "M4" string as Tier A', () => {
    for (const s of ['M1', 'M2', 'M4']) {
      clearDeviceTierCache();
      const det = detectDeviceTier({
        probeOverride: { rendererString: s, webglAvailable: true },
      });
      expect(det.tier).toBe('A');
    }
  });

  it('is case-insensitive (lowercase apple m2)', () => {
    const det = detectDeviceTier({
      probeOverride: {
        rendererString: 'apple m2 max',
        webglAvailable: true,
      },
    });
    expect(det.tier).toBe('A');
  });
});

describe('detectDeviceTier — Tier B (real GPU, non-Apple)', () => {
  beforeEach(() => clearDeviceTierCache());
  afterEach(() => clearDeviceTierCache());

  it('classifies Intel integrated GPU as Tier B', () => {
    const det = detectDeviceTier({
      probeOverride: {
        rendererString: 'Intel Iris Plus Graphics',
        webglAvailable: true,
      },
    });
    expect(det.tier).toBe('B');
    expect(det.reason).toBe('real_gpu');
  });

  it('classifies NVIDIA discrete GPU as Tier B', () => {
    const det = detectDeviceTier({
      probeOverride: {
        rendererString: 'NVIDIA GeForce RTX 4090',
        webglAvailable: true,
      },
    });
    expect(det.tier).toBe('B');
  });

  it('classifies AMD discrete GPU as Tier B', () => {
    const det = detectDeviceTier({
      probeOverride: {
        rendererString: 'AMD Radeon RX 7900 XTX',
        webglAvailable: true,
      },
    });
    expect(det.tier).toBe('B');
  });
});

describe('detectDeviceTier — Tier C (software / unavailable)', () => {
  beforeEach(() => clearDeviceTierCache());
  afterEach(() => clearDeviceTierCache());

  it('classifies SwiftShader as Tier C', () => {
    const det = detectDeviceTier({
      probeOverride: {
        rendererString: 'Google SwiftShader',
        webglAvailable: true,
      },
    });
    expect(det.tier).toBe('C');
    expect(det.reason).toBe('software_fallback');
  });

  it('classifies llvmpipe as Tier C', () => {
    const det = detectDeviceTier({
      probeOverride: {
        rendererString: 'llvmpipe (LLVM 15.0.6, 256 bits)',
        webglAvailable: true,
      },
    });
    expect(det.tier).toBe('C');
    expect(det.reason).toBe('software_fallback');
  });

  it('classifies generic "Software Renderer" as Tier C', () => {
    const det = detectDeviceTier({
      probeOverride: {
        rendererString: 'Some Software Renderer',
        webglAvailable: true,
      },
    });
    expect(det.tier).toBe('C');
    expect(det.reason).toBe('software_fallback');
  });

  it('classifies WebGL-unavailable as Tier C', () => {
    const det = detectDeviceTier({
      probeOverride: { rendererString: null, webglAvailable: false },
    });
    expect(det.tier).toBe('C');
    expect(det.reason).toBe('webgl_unavailable');
    expect(det.webglAvailable).toBe(false);
  });

  it('classifies WebGL-available + null renderer as Tier C (capability detection failure)', () => {
    const det = detectDeviceTier({
      probeOverride: { rendererString: null, webglAvailable: true },
    });
    expect(det.tier).toBe('C');
    expect(det.reason).toBe('renderer_string_unavailable');
  });
});

describe('detectDeviceTier — cache lifecycle', () => {
  beforeEach(() => clearDeviceTierCache());
  afterEach(() => clearDeviceTierCache());

  it('starts with no cached value', () => {
    expect(getCachedDeviceTier()).toBeNull();
  });

  it('writes the override result to the cache', () => {
    detectDeviceTier({
      probeOverride: { rendererString: 'Apple GPU', webglAvailable: true },
    });
    const cached = getCachedDeviceTier();
    expect(cached).not.toBeNull();
    expect(cached!.tier).toBe('A');
  });

  it('subsequent call without override returns the cached value', () => {
    detectDeviceTier({
      probeOverride: {
        rendererString: 'NVIDIA GeForce RTX 4090',
        webglAvailable: true,
      },
    });
    const cached = getCachedDeviceTier();
    const second = detectDeviceTier();
    expect(second).toBe(cached);
    expect(second.tier).toBe('B');
  });

  it('clearDeviceTierCache() drops the cache', () => {
    detectDeviceTier({
      probeOverride: { rendererString: 'Apple GPU', webglAvailable: true },
    });
    expect(getCachedDeviceTier()).not.toBeNull();
    clearDeviceTierCache();
    expect(getCachedDeviceTier()).toBeNull();
  });

  it('override always overwrites the cached value', () => {
    detectDeviceTier({
      probeOverride: { rendererString: 'Apple GPU', webglAvailable: true },
    });
    const second = detectDeviceTier({
      probeOverride: {
        rendererString: 'Intel Iris Plus Graphics',
        webglAvailable: true,
      },
    });
    expect(second.tier).toBe('B');
    expect(getCachedDeviceTier()!.tier).toBe('B');
  });
});

describe('detectDeviceTier — detection metadata', () => {
  beforeEach(() => clearDeviceTierCache());
  afterEach(() => clearDeviceTierCache());

  it('records detectedAtMs as a finite number', () => {
    const det = detectDeviceTier({
      probeOverride: { rendererString: 'Apple GPU', webglAvailable: true },
    });
    expect(Number.isFinite(det.detectedAtMs)).toBe(true);
    expect(det.detectedAtMs).toBeGreaterThanOrEqual(0);
  });
});
