import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to mock heavy modules BEFORE importing the SUT. Hoisted fixtures
// live in `mocks` so vi.mock factories can close over them.
const mocks = vi.hoisted(() => {
  return {
    // Order tracker — every mocked side-effect pushes a tag here so the
    // strict K-NAV-VRM-001 ordering can be asserted.
    callOrder: [] as string[],
    rotateVRM0: vi.fn((_vrm: unknown) => {
      mocks.callOrder.push('rotateVRM0');
    }),
    deepDispose: vi.fn((_scene: unknown) => {
      mocks.callOrder.push('deepDispose');
    }),
    applyIdlePose: vi.fn((_vrm: unknown) => {
      mocks.callOrder.push('applyIdlePose');
    }),
    loadAsync: vi.fn<(url: string) => Promise<unknown>>(),
    invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    GLTFLoaderCtor: vi.fn(),
  };
});

vi.mock('@pixiv/three-vrm', async () => {
  // Preserve actual module so VRM type imports stay valid; only override
  // the bits we exercise.
  return {
    VRMUtils: { rotateVRM0: mocks.rotateVRM0, deepDispose: mocks.deepDispose },
    VRMLoaderPlugin: class FakeVRMLoaderPlugin {
      constructor(_parser: unknown, _opts: unknown) {}
    },
    MToonMaterialLoaderPlugin: class FakeMToonMaterialLoaderPlugin {
      constructor(_parser: unknown, _opts: unknown) {}
      async afterRoot(_gltf: unknown): Promise<void> {}
    },
  };
});

vi.mock('@pixiv/three-vrm-animation', () => {
  return {
    VRMAnimationLoaderPlugin: class FakeVRMAnimationLoaderPlugin {
      constructor(_parser: unknown) {}
    },
  };
});

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => {
  return {
    GLTFLoader: class FakeGLTFLoader {
      crossOrigin = '';
      constructor() {
        mocks.GLTFLoaderCtor();
      }
      register(_cb: (parser: unknown) => unknown): this {
        // Invoke once with a stub parser to exercise plugin construction
        // (so any throw in the factory surfaces in tests).
        _cb({});
        return this;
      }
      loadAsync(url: string): Promise<unknown> {
        return mocks.loadAsync(url);
      }
    },
  };
});

vi.mock('./vrm-pose.js', () => ({
  applyIdlePose: mocks.applyIdlePose,
}));

// SUT import comes AFTER all mocks.
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import {
  __resetVrmLoaderForTests,
  getVrmLoader,
  loadVrmFromManifest,
} from './vrm-loader.js';

type SceneObj = { frustumCulled?: boolean };

function makeFakeVrm(): { vrm: { scene: { traverse: (cb: (o: SceneObj) => void) => void } } } {
  const objects: SceneObj[] = [{}, {}, {}];
  return {
    vrm: {
      scene: {
        traverse(cb: (o: SceneObj) => void): void {
          mocks.callOrder.push('traverse');
          for (const o of objects) cb(o);
        },
      },
    },
  };
}

function vrmManifest(filePath: string): VrmAvatarModelManifest {
  return {
    kind: 'vrm',
    modelId: 'test-model',
    runtimeDir: '/tmp/runtime',
    nimiDir: null,
    posterPath: null,
    vrm: { vrmFile: filePath, motionPresetsDir: null },
  };
}

beforeEach(() => {
  mocks.callOrder.length = 0;
  mocks.rotateVRM0.mockClear();
  mocks.deepDispose.mockClear();
  mocks.applyIdlePose.mockClear();
  mocks.loadAsync.mockReset();
  mocks.invoke.mockReset();
  mocks.GLTFLoaderCtor.mockClear();
  (globalThis as unknown as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = undefined;
  __resetVrmLoaderForTests();
});

afterEach(() => {
  __resetVrmLoaderForTests();
  (globalThis as unknown as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = undefined;
});

describe('getVrmLoader', () => {
  it('returns a singleton across multiple invocations', () => {
    const a = getVrmLoader();
    const b = getVrmLoader();
    expect(a).toBe(b);
    expect(mocks.GLTFLoaderCtor).toHaveBeenCalledTimes(1);
  });
});

describe('loadVrmFromManifest', () => {
  it('rejects manifests with kind !== "vrm"', async () => {
    const bad = { kind: 'live2d' } as unknown as VrmAvatarModelManifest;
    await expect(loadVrmFromManifest(bad)).rejects.toThrow(/manifest\.kind/);
  });

  it('honours strict load order: loadAsync → rotateVRM0 → applyIdlePose → traverse', async () => {
    const fake = makeFakeVrm();
    mocks.loadAsync.mockImplementation(async () => {
      mocks.callOrder.push('loadAsync');
      return { userData: fake };
    });
    await loadVrmFromManifest(vrmManifest('/path/to/model.vrm'));
    expect(mocks.callOrder).toEqual([
      'loadAsync',
      'rotateVRM0',
      'applyIdlePose',
      'traverse',
    ]);
  });

  it('marks every traversed scene object frustumCulled = false', async () => {
    const captured: SceneObj[] = [];
    const objects: SceneObj[] = [{}, {}, {}];
    mocks.loadAsync.mockResolvedValue({
      userData: {
        vrm: {
          scene: {
            traverse(cb: (o: SceneObj) => void): void {
              mocks.callOrder.push('traverse');
              for (const o of objects) {
                cb(o);
                captured.push(o);
              }
            },
          },
        },
      },
    });
    await loadVrmFromManifest(vrmManifest('/path/to/model.vrm'));
    expect(captured).toHaveLength(3);
    for (const o of captured) {
      expect(o.frustumCulled).toBe(false);
    }
  });

  it('throws fail-close when gltf.userData.vrm is missing', async () => {
    const scene = { traverse: vi.fn() };
    mocks.loadAsync.mockResolvedValue({ userData: {}, scene });
    await expect(loadVrmFromManifest(vrmManifest('/x/missing.vrm'))).rejects.toThrow(
      /not a valid VRM/,
    );
    expect(mocks.deepDispose).toHaveBeenCalledWith(scene);
  });

  it('deep-disposes the parsed VRM when pose initialization rejects', async () => {
    const fake = makeFakeVrm();
    mocks.loadAsync.mockResolvedValue({ userData: fake });
    mocks.applyIdlePose.mockImplementationOnce(() => {
      throw new Error('pose rejected');
    });

    await expect(loadVrmFromManifest(vrmManifest('/x/pose-failure.vrm')))
      .rejects.toThrow(/pose rejected/u);
    expect(mocks.deepDispose).toHaveBeenCalledWith(fake.vrm.scene);
    expect(mocks.callOrder.at(-1)).toBe('deepDispose');
  });

  it('propagates a loader rejection before any scene exists', async () => {
    mocks.loadAsync.mockRejectedValue(new Error('parse boom'));
    await expect(loadVrmFromManifest(vrmManifest('/x/broken.vrm'))).rejects.toThrow(/parse boom/);
    expect(mocks.deepDispose).not.toHaveBeenCalled();
  });

  it('fails closed when userData.vrm is missing without a parsed scene', async () => {
    mocks.loadAsync.mockImplementation(async () => {
      mocks.callOrder.push('loadAsync');
      return { userData: {} };
    });
    await expect(loadVrmFromManifest(vrmManifest('/x/empty.vrm'))).rejects.toThrow();
    expect(mocks.callOrder).toEqual(['loadAsync']);
  });

  it('reloads the same URL as a fresh scene for recovery', async () => {
    const fake = makeFakeVrm();
    mocks.loadAsync.mockImplementation(async () => {
      mocks.callOrder.push('loadAsync');
      return { userData: fake };
    });
    await loadVrmFromManifest(vrmManifest('/path/to/cached.vrm'));
    const firstCount = mocks.loadAsync.mock.calls.length;
    expect(firstCount).toBe(1);
    mocks.callOrder.length = 0;
    await loadVrmFromManifest(vrmManifest('/path/to/cached.vrm'));
    expect(mocks.loadAsync.mock.calls.length).toBe(2);
    expect(mocks.callOrder).toEqual([
      'loadAsync',
      'rotateVRM0',
      'applyIdlePose',
      'traverse',
    ]);
  });

  it('loads Electron local VRM files through the admitted shell-file URL', async () => {
    const fake = makeFakeVrm();
    (globalThis as unknown as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: mocks.invoke,
      listen: () => () => undefined,
    };
    mocks.loadAsync.mockImplementation(async () => {
      mocks.callOrder.push('parse');
      return { userData: fake };
    });

    await loadVrmFromManifest(vrmManifest('\\\\?\\D:\\DataNimi\\avatar\\AliciaSolid.vrm'));

    expect(mocks.loadAsync).toHaveBeenCalledTimes(1);
    expect(String(mocks.loadAsync.mock.calls[0]?.[0])).toMatch(/^nimi-shell-file:\/\/local\/\?path=/u);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
