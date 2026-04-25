import { describe, expect, it, vi } from 'vitest';
import type { Live2DBackendSession } from './backend-session.js';
import type { Live2DVisualModelShape, Live2DVisualRuntime } from './carrier-visual-runtime.js';

function createSession(input: { loaded?: boolean } = {}): Live2DBackendSession {
  return {
    manifest: {
      runtimeDir: '/models/ren/runtime',
      modelId: 'ren',
      model3JsonPath: '/models/ren/runtime/ren.model3.json',
      nimiDir: null,
    },
    settings: {
      Version: 3,
      FileReferences: {
        Moc: 'ren.moc3',
        Textures: ['ren.4096/texture_00.png'],
        Motions: {},
        Expressions: [],
      },
    },
    resources: {
      mocPath: '/models/ren/runtime/ren.moc3',
      texturePaths: ['/models/ren/runtime/ren.4096/texture_00.png'],
      motionGroups: new Map(),
      expressions: new Map(),
      physicsPath: null,
      posePath: null,
      displayInfoPath: null,
    },
    framework: {
      modelSetting: null,
      motions: new Map(),
      expressions: new Map(),
      physics: null,
      pose: null,
    },
    execution: {
      loaded: input.loaded ?? true,
      activeMotion: null,
      activeExpression: null,
      activePose: null,
      parameters: new Map(),
      commandLog: [],
    },
    applyCommand: vi.fn(),
    unload: vi.fn(),
  };
}

function createFakeGl(options: { drawVisible: boolean }) {
  const state = {
    drawn: false,
  };
  return {
    TEXTURE_2D: 0x0DE1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812F,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    STENCIL_BUFFER_BIT: 0x0400,
    FRAMEBUFFER_BINDING: 0x8CA6,
    createTexture: vi.fn(() => ({}) as WebGLTexture),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    getParameter: vi.fn(() => null),
    readPixels: vi.fn((
      _x: number,
      _y: number,
      _width: number,
      _height: number,
      _format: number,
      _type: number,
      pixels: Uint8Array,
    ) => {
      pixels[0] = state.drawn && options.drawVisible ? 12 : 0;
      pixels[1] = state.drawn && options.drawVisible ? 34 : 0;
      pixels[2] = state.drawn && options.drawVisible ? 56 : 0;
      pixels[3] = state.drawn && options.drawVisible ? 255 : 0;
    }),
    __markDrawn: () => {
      state.drawn = true;
    },
  };
}

function createFakeRuntime(gl: ReturnType<typeof createFakeGl>): Live2DVisualRuntime {
  class FakeModelSetting {
    public constructor(_buffer: ArrayBuffer, _size: number) {}
    public getModelFileName() { return 'ren.moc3'; }
    public getTextureCount() { return 1; }
    public getTextureFileName(_index: number) { return 'ren.4096/texture_00.png'; }
    public getLayoutMap(_layout: Map<string, number>) { return false; }
    public getPhysicsFileName() { return ''; }
    public getPoseFileName() { return ''; }
    public getExpressionCount() { return 0; }
    public getExpressionName(_index: number) { return ''; }
    public getExpressionFileName(_index: number) { return ''; }
    public getMotionCount(_groupName: string) { return 0; }
    public getMotionFileName(_groupName: string, _index: number) { return ''; }
    public getMotionFadeInTimeValue(_groupName: string, _index: number) { return -1; }
    public getMotionFadeOutTimeValue(_groupName: string, _index: number) { return -1; }
    public getEyeBlinkParameterCount() { return 0; }
    public getLipSyncParameterCount() { return 0; }
  }

  class FakeUserModel {
    private readonly model: Live2DVisualModelShape = {
      loadParameters: vi.fn(),
      saveParameters: vi.fn(),
      update: vi.fn(),
      setParameterValueById: vi.fn(),
      getCanvasWidth: () => 2,
      getCanvasHeight: () => 2,
      getDrawableCount: () => 1,
      getDrawableOpacity: () => 1,
      getDrawableDynamicFlagIsVisible: () => true,
      getDrawableVertexCount: () => 4,
    };
    private readonly renderer = {
      startUp: vi.fn(),
      bindTexture: vi.fn((index: number, texture: WebGLTexture) => {
        this.boundTextures.set(index, texture);
      }),
      getBindedTextures: () => this.boundTextures,
      setIsPremultipliedAlpha: vi.fn(),
      setRenderTargetSize: vi.fn(),
      setRenderState: vi.fn(),
      setMvpMatrix: vi.fn(),
      drawModel: vi.fn(() => {
        gl.__markDrawn();
      }),
    };
    private readonly matrix = {
      loadIdentity: vi.fn(),
      setWidth: vi.fn(),
      setHeight: vi.fn(),
      setMatrix: vi.fn(),
      getArray: () => new Float32Array(16),
      setupFromLayout: vi.fn(),
      scaleRelative: vi.fn(),
      translateRelative: vi.fn(),
    };
    private readonly boundTextures = new Map<number, WebGLTexture>();
    public _model: Live2DVisualModelShape | null = null;
    public loadModel(_buffer: ArrayBuffer, _shouldCheckMocConsistency?: boolean) {
      this._model = this.model;
    }
    public loadExpression(_buffer: ArrayBuffer, _size: number, _name: string) {
      return {};
    }
    public createRenderer(_width: number, _height: number, _maskBufferCount?: number) {}
    public getRenderer() {
      return this.renderer;
    }
    public getModelMatrix() {
      return this.matrix;
    }
    public release() {}
  }

  return {
    CubismFramework: {
      startUp: vi.fn(() => true),
      initialize: vi.fn(),
      isStarted: vi.fn(() => true),
      isInitialized: vi.fn(() => true),
      getIdManager: vi.fn(() => ({ getId: (value: string) => value })),
    },
    Option: class {},
    CubismModelSettingJson: FakeModelSetting,
    CubismUserModel: FakeUserModel,
    CubismMotion: {
      create: vi.fn(() => ({
        setFadeInTime: vi.fn(),
        setFadeOutTime: vi.fn(),
        setEffectIds: vi.fn(),
      })),
    },
    CubismExpressionMotion: {
      create: vi.fn(() => ({})),
    },
    CubismEyeBlink: {
      create: vi.fn(() => null),
    },
    CubismBreath: {
      create: vi.fn(() => ({
        setParameters: vi.fn(),
        updateParameters: vi.fn(),
      })),
    },
    BreathParameterData: class {},
    CubismPhysics: {
      create: vi.fn(() => null),
    },
    CubismPose: {
      create: vi.fn(() => null),
    },
    CubismMatrix44: class {
      public getArray() { return new Float32Array(16); }
      public scale(_x: number, _y: number) {}
      public multiplyByMatrix(_matrix: unknown) {}
    },
    CubismWebGLOffscreenManager: {
      getInstance: () => ({
        beginFrameProcess: vi.fn(),
        endFrameProcess: vi.fn(),
        releaseStaleRenderTextures: vi.fn(),
        removeContext: vi.fn(),
      }),
    },
    CubismDefaultParameterId: {
      ParamAngleX: 'ParamAngleX',
      ParamAngleY: 'ParamAngleY',
      ParamBodyAngleX: 'ParamBodyAngleX',
    },
  };
}

async function createHostWithFakeRuntime(options: { drawVisible: boolean; loaded?: boolean }) {
  const { createLive2DCarrierVisualHost } = await import('./carrier-visual-host.js');
  const gl = createFakeGl({ drawVisible: options.drawVisible });
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', {
    value: vi.fn(() => gl),
  });
  return createLive2DCarrierVisualHost({
    canvas,
    session: createSession({ loaded: options.loaded }),
    width: 128,
    height: 160,
  }, {
    loadRuntime: async () => createFakeRuntime(gl),
    readBinary: vi.fn(async () => new ArrayBuffer(8)),
    loadTexture: vi.fn(async () => ({}) as WebGLTexture),
    verifyShaders: vi.fn(async () => []),
  });
}

describe('Live2D carrier visual host', () => {
  it('renders a loaded Avatar backend session through the carrier WebGL path and proves visible pixels', async () => {
    const host = await createHostWithFakeRuntime({ drawVisible: true });
    const stats = host.renderFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 });

    expect(stats).toEqual(expect.objectContaining({
      width: 128,
      height: 160,
      sampledPixels: 16,
      visiblePixels: 16,
      drawableCount: 1,
      visibleDrawableCount: 1,
      nonZeroOpacityDrawableCount: 1,
      textureBindingCount: 1,
    }));
  });

  it('fails closed when the draw path produces no visible pixels', async () => {
    const host = await createHostWithFakeRuntime({ drawVisible: false });

    expect(() => host.renderFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 }))
      .toThrow('produced no visible pixels');
  });

  it('rejects unloaded backend sessions before creating a visual success state', async () => {
    await expect(createHostWithFakeRuntime({ drawVisible: true, loaded: false }))
      .rejects.toThrow('requires a loaded backend session');
  });
});
