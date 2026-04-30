import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetOutlineCompatibilityCacheForTests,
  classifyOutlineCompatibility,
  createMToonMaterialLoaderPlugin,
} from './vrm-mtoon-outline-policy.js';

describe('classifyOutlineCompatibility', () => {
  it('returns true for Tauri WKWebView (WebKit WebGL)', () => {
    expect(classifyOutlineCompatibility('WebKit WebGL')).toBe(true);
  });

  it('returns true for typical desktop GPUs', () => {
    expect(classifyOutlineCompatibility('NVIDIA GeForce RTX 4090')).toBe(true);
    expect(classifyOutlineCompatibility('Apple M2 Pro')).toBe(true);
    expect(classifyOutlineCompatibility('Intel Iris Xe Graphics')).toBe(true);
  });

  it('returns false for SwiftShader (case-insensitive)', () => {
    expect(classifyOutlineCompatibility('Google SwiftShader')).toBe(false);
    expect(classifyOutlineCompatibility('google swiftshader')).toBe(false);
  });

  it('returns false for llvmpipe', () => {
    expect(classifyOutlineCompatibility('llvmpipe (LLVM 15.0.0, 256 bits)')).toBe(false);
  });

  it('returns false for software renderer strings', () => {
    expect(classifyOutlineCompatibility('Software Renderer')).toBe(false);
  });

  it('treats null / empty as compatible (probe failure → assume OK)', () => {
    expect(classifyOutlineCompatibility(null)).toBe(true);
    expect(classifyOutlineCompatibility('')).toBe(true);
  });
});

describe('createMToonMaterialLoaderPlugin', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetOutlineCompatibilityCacheForTests();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    __resetOutlineCompatibilityCacheForTests();
  });

  it('returns a plugin instance for compatible GPUs without log', async () => {
    const plugin = createMToonMaterialLoaderPlugin(makeFakeParser(), undefined, {
      renderer: 'WebKit WebGL',
      outlineCompatible: true,
    });
    expect(plugin).toBeTruthy();
    expect(typeof plugin.afterRoot).toBe('function');
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('logs mtoon_outline_disabled when GPU is incompatible (SwiftShader)', () => {
    createMToonMaterialLoaderPlugin(makeFakeParser(), undefined, {
      renderer: 'Google SwiftShader',
      outlineCompatible: false,
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [, payload] = infoSpy.mock.calls[0]!;
    expect(payload).toMatchObject({
      event: 'mtoon_outline_disabled',
      renderer: 'Google SwiftShader',
    });
  });

  it('zeroes outlineWidthFactor on every vrmMToonMaterial when incompatible', async () => {
    const plugin = createMToonMaterialLoaderPlugin(makeFakeParser(), undefined, {
      renderer: 'llvmpipe',
      outlineCompatible: false,
    });
    const fakeMat1: Record<string, unknown> = {
      outlineWidthFactor: 0.04,
      outlineLightingMixFactor: 1.0,
      outlineWidthMultiplyTexture: { foo: 'bar' },
    };
    const fakeMat2: Record<string, unknown> = {
      outlineWidthFactor: 0.08,
      outlineLightingMixFactor: 0.5,
    };
    // The real `afterRoot` overwrites `gltf.userData.vrmMToonMaterials` from
    // an internal materialSet that is empty in this fake. To exercise our
    // wrapper logic, we use a userData proxy whose setter discards the
    // empty replacement and keeps our injected materials in place.
    const userData: Record<string, unknown> = {};
    Object.defineProperty(userData, 'vrmMToonMaterials', {
      configurable: true,
      get() {
        return [fakeMat1, fakeMat2];
      },
      set(_value: unknown) {
        // swallow; the real afterRoot tries to install Array.from(empty set)
      },
    });
    const gltf = { userData };
    await plugin.afterRoot(gltf as unknown as Parameters<typeof plugin.afterRoot>[0]);
    expect(fakeMat1['outlineWidthFactor']).toBe(0);
    expect(fakeMat1['outlineLightingMixFactor']).toBe(0);
    expect(fakeMat1['outlineWidthMultiplyTexture']).toBeNull();
    expect(fakeMat2['outlineWidthFactor']).toBe(0);
    expect(fakeMat2['outlineLightingMixFactor']).toBe(0);
  });

  it('does not patch afterRoot output when GPU is compatible', async () => {
    const plugin = createMToonMaterialLoaderPlugin(makeFakeParser(), undefined, {
      renderer: 'Apple M2',
      outlineCompatible: true,
    });
    const fakeMat: Record<string, unknown> = {
      outlineWidthFactor: 0.04,
      outlineLightingMixFactor: 1.0,
    };
    const gltf = {
      userData: { vrmMToonMaterials: [fakeMat] },
    };
    await plugin.afterRoot(gltf as unknown as Parameters<typeof plugin.afterRoot>[0]);
    // Compatible path leaves materials untouched (the original afterRoot
    // may set additional keys but must not zero out the outline values).
    expect(fakeMat['outlineWidthFactor']).toBe(0.04);
    expect(fakeMat['outlineLightingMixFactor']).toBe(1.0);
  });
});

// Minimal stand-in for GLTFParser used by the MToon plugin constructor. The
// real parser exposes a large surface but the constructor only stores the
// reference; afterRoot is what we exercise above.
function makeFakeParser(): unknown {
  return {
    json: { materials: [] },
    getDependency: vi.fn(),
    associations: new Map(),
  };
}
