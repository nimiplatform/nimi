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
    applyIdlePose: vi.fn((_vrm: unknown) => {
      mocks.callOrder.push('applyIdlePose');
    }),
    suspendCreateImageBitmap: vi.fn(() => {
      mocks.callOrder.push('suspend');
      return () => {
        mocks.callOrder.push('restore');
      };
    }),
    loadAsync: vi.fn<(url: string) => Promise<unknown>>(),
    parse: vi.fn<(data: ArrayBuffer, path: string) => Promise<unknown>>(),
    invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    GLTFLoaderCtor: vi.fn(),
  };
});

vi.mock('@pixiv/three-vrm', async () => {
  // Preserve actual module so VRM type imports stay valid; only override
  // the bits we exercise.
  return {
    VRMUtils: { rotateVRM0: mocks.rotateVRM0 },
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
      parse(
        data: ArrayBuffer,
        path: string,
        onLoad: (gltf: unknown) => void,
        onError?: (error: unknown) => void,
      ): void {
        mocks.parse(data, path).then(onLoad, onError);
      }
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: mocks.invoke,
}));

vi.mock('./vrm-pose.js', () => ({
  applyIdlePose: mocks.applyIdlePose,
}));

vi.mock('./vrm-tauri-quirks.js', () => ({
  suspendCreateImageBitmapForTauriVrmLoad: mocks.suspendCreateImageBitmap,
}));

// SUT import comes AFTER all mocks.
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import { clearVrmCache } from './vrm-instance-cache.js';
import {
  __resetVrmLoaderForTests,
  getVrmLoader,
  loadVrmAnimation,
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
  mocks.applyIdlePose.mockClear();
  mocks.suspendCreateImageBitmap.mockClear();
  mocks.loadAsync.mockReset();
  mocks.parse.mockReset();
  mocks.invoke.mockReset();
  mocks.GLTFLoaderCtor.mockClear();
  __resetVrmLoaderForTests();
  clearVrmCache();
  delete (window as unknown as Record<string, unknown>)['__TAURI_IPC__'];
});

afterEach(() => {
  clearVrmCache();
  __resetVrmLoaderForTests();
  delete (window as unknown as Record<string, unknown>)['__TAURI_IPC__'];
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

  it('honours strict load order: suspend → loadAsync → rotateVRM0 → applyIdlePose → traverse → restore', async () => {
    const fake = makeFakeVrm();
    mocks.loadAsync.mockImplementation(async () => {
      mocks.callOrder.push('loadAsync');
      return { userData: fake };
    });
    await loadVrmFromManifest(vrmManifest('/path/to/model.vrm'));
    expect(mocks.callOrder).toEqual([
      'suspend',
      'loadAsync',
      'rotateVRM0',
      'applyIdlePose',
      'traverse',
      'restore',
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
    mocks.loadAsync.mockResolvedValue({ userData: {} });
    await expect(loadVrmFromManifest(vrmManifest('/x/missing.vrm'))).rejects.toThrow(
      /not a valid VRM/,
    );
  });

  it('still calls restore() even when loadAsync rejects', async () => {
    mocks.loadAsync.mockRejectedValue(new Error('parse boom'));
    await expect(loadVrmFromManifest(vrmManifest('/x/broken.vrm'))).rejects.toThrow(/parse boom/);
    expect(mocks.callOrder).toEqual(['suspend', 'restore']);
  });

  it('still calls restore() when userData.vrm is missing', async () => {
    mocks.loadAsync.mockImplementation(async () => {
      mocks.callOrder.push('loadAsync');
      return { userData: {} };
    });
    await expect(loadVrmFromManifest(vrmManifest('/x/empty.vrm'))).rejects.toThrow();
    expect(mocks.callOrder).toEqual(['suspend', 'loadAsync', 'restore']);
  });

  it('serves a cache hit on the second load with the same URL (no second loadAsync)', async () => {
    const fake = makeFakeVrm();
    mocks.loadAsync.mockImplementation(async () => {
      mocks.callOrder.push('loadAsync');
      return { userData: fake };
    });
    await loadVrmFromManifest(vrmManifest('/path/to/cached.vrm'));
    const firstCount = mocks.loadAsync.mock.calls.length;
    expect(firstCount).toBe(1);
    // Reset trackers but NOT the cache.
    mocks.callOrder.length = 0;
    await loadVrmFromManifest(vrmManifest('/path/to/cached.vrm'));
    expect(mocks.loadAsync.mock.calls.length).toBe(1);
    // Cache hit path skips suspend wrap entirely (nothing is loading).
    expect(mocks.callOrder).toEqual([]);
  });

  it('loads Tauri local VRM files through Avatar-owned binary read instead of fetch', async () => {
    (window as unknown as Record<string, unknown>)['__TAURI_IPC__'] = true;
    const fake = makeFakeVrm();
    mocks.invoke.mockResolvedValue([0x67, 0x6c, 0x54, 0x46]);
    mocks.parse.mockImplementation(async () => {
      mocks.callOrder.push('parse');
      return { userData: fake };
    });

    await loadVrmFromManifest(vrmManifest('\\\\?\\D:\\DataNimi\\avatar\\AliciaSolid.vrm'));

    expect(mocks.invoke).toHaveBeenCalledWith('nimi_avatar_read_binary_file', {
      path: '\\\\?\\D:\\DataNimi\\avatar\\AliciaSolid.vrm',
    });
    expect(mocks.loadAsync).not.toHaveBeenCalled();
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.parse.mock.calls[0]?.[0]).toBeInstanceOf(ArrayBuffer);
    expect(mocks.callOrder).toEqual([
      'suspend',
      'parse',
      'rotateVRM0',
      'applyIdlePose',
      'traverse',
      'restore',
    ]);
  });

  it('treats normal Windows drive VRM paths as local Tauri files', async () => {
    (window as unknown as Record<string, unknown>)['__TAURI_IPC__'] = true;
    const fake = makeFakeVrm();
    mocks.invoke.mockResolvedValue([0x67, 0x6c, 0x54, 0x46]);
    mocks.parse.mockResolvedValue({ userData: fake });

    await loadVrmFromManifest(vrmManifest('D:\\DataNimi\\avatar\\AliciaSolid.vrm'));

    expect(mocks.invoke).toHaveBeenCalledWith('nimi_avatar_read_binary_file', {
      path: 'D:\\DataNimi\\avatar\\AliciaSolid.vrm',
    });
    expect(mocks.loadAsync).not.toHaveBeenCalled();
  });
});

describe('loadVrmAnimation', () => {
  it('returns the first VRM animation when present', async () => {
    const animation = { kind: 'mock-anim' };
    mocks.loadAsync.mockResolvedValue({ userData: { vrmAnimations: [animation, {}] } });
    const result = await loadVrmAnimation('/p/anim.vrma');
    expect(result).toBe(animation);
  });

  it('returns null when the asset has no vrmAnimations', async () => {
    mocks.loadAsync.mockResolvedValue({ userData: {} });
    expect(await loadVrmAnimation('/p/empty.vrma')).toBeNull();
  });

  it('returns null when vrmAnimations is empty', async () => {
    mocks.loadAsync.mockResolvedValue({ userData: { vrmAnimations: [] } });
    expect(await loadVrmAnimation('/p/empty.vrma')).toBeNull();
  });

  it('wraps loadAsync with the createImageBitmap suspend', async () => {
    mocks.loadAsync.mockResolvedValue({ userData: { vrmAnimations: [{}] } });
    await loadVrmAnimation('/p/anim.vrma');
    expect(mocks.suspendCreateImageBitmap).toHaveBeenCalledTimes(1);
  });
});
