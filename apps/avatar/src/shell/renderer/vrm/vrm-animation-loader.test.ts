// Wave 3 chunk 3-B — vrm-animation-loader tests.
//
// Coverage:
//   - loadVrmAnimation returns the first VRMAnimation, null when absent
//   - loadVrmAnimation wraps loadAsync with the createImageBitmap suspend
//   - clipFromVRMAnimation delegates to upstream createVRMAnimationClip
//
// loadVrmAnimation tests are partially redundant with vrm-loader.test.ts
// (which exercises the back-compat re-export); kept here so the canonical
// home of the function is also self-tested.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadAsync: vi.fn<(url: string) => Promise<unknown>>(),
  GLTFLoaderCtor: vi.fn(),
  suspendCreateImageBitmap: vi.fn(() => () => {
    /* restore noop */
  }),
  createVRMAnimationClip: vi.fn(),
}));

vi.mock('@pixiv/three-vrm', () => ({
  VRMUtils: { rotateVRM0: vi.fn() },
  VRMLoaderPlugin: class FakeVRMLoaderPlugin {
    constructor(_p: unknown, _o: unknown) {}
  },
  MToonMaterialLoaderPlugin: class FakeMToon {
    constructor(_p: unknown, _o: unknown) {}
    async afterRoot(_g: unknown): Promise<void> {}
  },
}));

vi.mock('@pixiv/three-vrm-animation', () => ({
  VRMAnimationLoaderPlugin: class FakePlugin {
    constructor(_p: unknown) {}
  },
  createVRMAnimationClip: mocks.createVRMAnimationClip,
}));

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class FakeGLTFLoader {
    crossOrigin = '';
    constructor() {
      mocks.GLTFLoaderCtor();
    }
    register(cb: (parser: unknown) => unknown): this {
      cb({});
      return this;
    }
    loadAsync(url: string): Promise<unknown> {
      return mocks.loadAsync(url);
    }
  },
}));

vi.mock('./vrm-tauri-quirks.js', () => ({
  suspendCreateImageBitmapForTauriVrmLoad: mocks.suspendCreateImageBitmap,
}));

import { __resetVrmLoaderForTests } from './vrm-loader.js';
import { clipFromVRMAnimation, loadVrmAnimation } from './vrm-animation-loader.js';

beforeEach(() => {
  mocks.loadAsync.mockReset();
  mocks.GLTFLoaderCtor.mockClear();
  mocks.suspendCreateImageBitmap.mockClear();
  mocks.createVRMAnimationClip.mockReset();
  __resetVrmLoaderForTests();
});

afterEach(() => {
  __resetVrmLoaderForTests();
});

describe('loadVrmAnimation', () => {
  it('returns the first vrmAnimation when present', async () => {
    const animation = { _kind: 'mock-anim' };
    mocks.loadAsync.mockResolvedValue({ userData: { vrmAnimations: [animation, {}] } });
    const result = await loadVrmAnimation('/p/anim.vrma');
    expect(result).toBe(animation);
  });

  it('returns null when vrmAnimations is absent', async () => {
    mocks.loadAsync.mockResolvedValue({ userData: {} });
    expect(await loadVrmAnimation('/p/empty.vrma')).toBeNull();
  });

  it('returns null when vrmAnimations is empty array', async () => {
    mocks.loadAsync.mockResolvedValue({ userData: { vrmAnimations: [] } });
    expect(await loadVrmAnimation('/p/empty.vrma')).toBeNull();
  });

  it('wraps loadAsync with the createImageBitmap suspend', async () => {
    mocks.loadAsync.mockResolvedValue({ userData: { vrmAnimations: [{}] } });
    await loadVrmAnimation('/p/anim.vrma');
    expect(mocks.suspendCreateImageBitmap).toHaveBeenCalledTimes(1);
  });

  it('still invokes the suspend restore() when loadAsync rejects', async () => {
    const restore = vi.fn();
    mocks.suspendCreateImageBitmap.mockImplementationOnce(() => restore);
    mocks.loadAsync.mockRejectedValue(new Error('boom'));
    await expect(loadVrmAnimation('/p/broken.vrma')).rejects.toThrow(/boom/);
    expect(restore).toHaveBeenCalledTimes(1);
  });
});

describe('clipFromVRMAnimation', () => {
  it('delegates to the upstream createVRMAnimationClip API (canonical export name)', () => {
    // Confirms the wrapper rationale documented in vrm-animation-loader.ts:
    // upstream `@pixiv/three-vrm-animation` exports `createVRMAnimationClip`
    // (not `clipFromVRMAnimation`); our wrapper renames it to match the
    // contract surface.
    const fakeClip = { name: 'fake-clip' };
    mocks.createVRMAnimationClip.mockReturnValue(fakeClip);
    const fakeAnim = { _vrmAnim: true } as unknown as Parameters<typeof clipFromVRMAnimation>[0];
    const fakeVrm = { scene: { name: 'vrm-scene' } } as unknown as Parameters<
      typeof clipFromVRMAnimation
    >[1];
    const out = clipFromVRMAnimation(fakeAnim, fakeVrm);
    expect(mocks.createVRMAnimationClip).toHaveBeenCalledWith(fakeAnim, fakeVrm);
    expect(out).toBe(fakeClip);
  });
});
