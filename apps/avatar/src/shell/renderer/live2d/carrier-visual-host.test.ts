import { describe, expect, it, vi } from 'vitest';
import type { Live2DBackendSession } from './backend-session.js';
import type { Live2DVisualModelShape, Live2DVisualRuntime } from './carrier-visual-runtime.js';
import {
  createLive2DExpressionInventory,
  createEmptyLive2DExpressionInventory,
  type Live2DExpressionParameter,
} from './live2d-expression-stack.js';
import { LIVE2D_PARAMETER_LANE_ORDER } from './live2d-parameter-lane-scheduler.js';

function createSession(input: {
  loaded?: boolean;
  parameters?: Map<string, number>;
  activeMotion?: string | null;
  activeMotionLoop?: boolean;
  idleMotionGroup?: string | null;
  activeExpression?: string | null;
  speechLipsyncParameters?: Map<string, number>;
  expressionParameters?: readonly Live2DExpressionParameter[];
  motionGroups?: Map<string, string[]>;
  expressions?: Map<string, string>;
  physicsPath?: string | null;
  posePath?: string | null;
} = {}): Live2DBackendSession {
  const directParameters = input.parameters ?? new Map();
  const speechLipsyncParameters = input.speechLipsyncParameters ?? new Map();
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
        Motions: Object.fromEntries(Array.from(input.motionGroups ?? new Map<string, string[]>()).map(([group, paths]) => [
          group,
          paths.map((path) => ({ File: path.replace('/models/ren/runtime/', '') })),
        ])),
        Expressions: Array.from(input.expressions ?? new Map<string, string>()).map(([name, path]) => ({
          Name: name,
          File: path.replace('/models/ren/runtime/', ''),
        })),
      },
    },
    resources: {
      mocPath: '/models/ren/runtime/ren.moc3',
      texturePaths: ['/models/ren/runtime/ren.4096/texture_00.png'],
      motionGroups: input.motionGroups ?? new Map(),
      expressions: input.expressions ?? new Map(),
      physicsPath: input.physicsPath ?? null,
      posePath: input.posePath ?? null,
      displayInfoPath: null,
    },
    compatibility: {
      tier: 'render_only',
      adapter: null,
      diagnostics: [],
      activityMotionGroups: new Map(),
      idleMotionGroup: input.idleMotionGroup ?? 'Idle',
      mouthOpenParameterId: 'ParamMouthOpenY',
      paramMouthFormSupported: false,
      missingActivity: 'idle_degraded_with_diagnostic',
    },
    framework: {
      modelSetting: null,
      motions: new Map(),
      expressions: new Map(),
      physics: null,
      pose: null,
    },
    expressionInventory: input.expressions && input.expressions.size > 0
      ? createLive2DExpressionInventory(Array.from(input.expressions.keys()).map((expressionId) => ({
        expressionId,
        sourcePath: input.expressions?.get(expressionId) ?? '',
        parameters: input.expressionParameters ?? [
          { id: 'ParamAngleX', value: 4, blend: 'add' },
        ],
      })))
      : createEmptyLive2DExpressionInventory(),
    execution: {
      loaded: input.loaded ?? true,
      activeMotion: input.activeMotion ?? null,
      activeMotionLoop: input.activeMotionLoop ?? false,
      activeExpression: input.activeExpression ?? null,
      activePose: null,
      parameters: new Map([
        ...speechLipsyncParameters,
        ...directParameters,
      ]),
      parameterLanes: {
        speechLipsync: speechLipsyncParameters,
        live2dExtensionDirect: directParameters,
      },
      commandLog: [],
    },
    applyCommand: vi.fn(),
    unload: vi.fn(),
  };
}

function createFakeGl(options: { drawVisible: boolean }) {
  const state = {
    drawn: false,
    interactionTone: 0,
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
    flush: vi.fn(),
    finish: vi.fn(),
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
      pixels[0] = state.drawn && options.drawVisible ? 12 + state.interactionTone : 0;
      pixels[1] = state.drawn && options.drawVisible ? 34 : 0;
      pixels[2] = state.drawn && options.drawVisible ? 56 + state.interactionTone : 0;
      pixels[3] = state.drawn && options.drawVisible ? 255 : 0;
    }),
    __markDrawn: () => {
      state.drawn = true;
    },
    __setInteractionTone: (value: number) => {
      state.interactionTone = Math.max(0, Math.min(80, Math.round(Math.abs(value) * 4)));
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
    public getEyeBlinkParameterId(_index: number) { return 'ParamEyeLOpen'; }
    public getLipSyncParameterCount() { return 0; }
    public getLipSyncParameterId(_index: number) { return 'ParamMouthOpenY'; }
  }

  class FakeUserModel {
    private readonly parameterIds = [
      'ParamAngleX',
      'ParamBodyAngleX',
      'ParamBodyAngleZ',
      'ParamMouthOpenY',
      'ParamEyeBallX',
      'ParamEyeBallY',
      'ParamEyeLOpen',
      'ParamEyeROpen',
    ];
    private readonly parameterDefaults = [0, 0, 0, 0, 0, 0, 1, 1];
    private readonly parameterValues = [0, 0, 0, 0, 0, 0, 1, 1];
    private readonly model: Live2DVisualModelShape = {
      loadParameters: vi.fn(),
      saveParameters: vi.fn(),
      update: vi.fn(),
      setParameterValueById: vi.fn((parameterId: unknown, value: number) => {
        this.writeParameterValue(parameterId, value);
      }),
      getParameterValueById: vi.fn((parameterId: unknown) => this.readParameterValue(parameterId)),
      getParameterDefaultValueById: vi.fn((parameterId: unknown) => this.readParameterDefaultValue(parameterId)),
      addParameterValueById: vi.fn((parameterId: unknown, value: number) => {
        this.writeParameterValue(parameterId, this.readParameterValue(parameterId) + value);
      }),
      multiplyParameterValueById: vi.fn((parameterId: unknown, value: number) => {
        this.writeParameterValue(parameterId, this.readParameterValue(parameterId) * value);
      }),
      parameters: {
        ids: this.parameterIds,
        values: this.parameterValues,
        defaultValues: this.parameterDefaults,
      },
      getCanvasWidth: () => 2,
      getCanvasHeight: () => 2,
      getDrawableCount: () => 1,
      getDrawableOpacity: () => 1,
      getDrawableDynamicFlagIsVisible: () => true,
      getDrawableVertexCount: () => 4,
    };
    private readonly renderer = {
      startUp: vi.fn(),
      loadShaders: vi.fn(),
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
      setCenterPosition: vi.fn(),
    };
    private readonly boundTextures = new Map<number, WebGLTexture>();
    private motionActive = false;
    private motionEffectIdsApplied = false;
    private expressionActive = false;
    public _motionManager = {
      startMotionPriority: vi.fn((motion: unknown) => {
        this.motionActive = true;
        this.motionEffectIdsApplied = Boolean((motion as { __effectIdsApplied?: boolean }).__effectIdsApplied);
        return 1;
      }),
      updateMotion: vi.fn(() => {
        if (this.motionActive && !this.motionEffectIdsApplied) {
          throw new Error('fake Cubism motion missing effect ids');
        }
        return this.motionActive;
      }),
      stopAllMotions: vi.fn(() => {
        this.motionActive = false;
      }),
    };
    public _expressionManager = {
      startMotion: vi.fn(() => {
        this.expressionActive = true;
        return 1;
      }),
      updateMotion: vi.fn(() => this.expressionActive),
      stopAllMotions: vi.fn(() => {
        this.expressionActive = false;
      }),
    };
    public _model: Live2DVisualModelShape | null = null;
    private parameterIndex(parameterId: unknown): number {
      return this.parameterIds.indexOf(String(parameterId));
    }
    private readParameterValue(parameterId: unknown): number {
      const index = this.parameterIndex(parameterId);
      return index >= 0 ? this.parameterValues[index] ?? 0 : Number.NaN;
    }
    private readParameterDefaultValue(parameterId: unknown): number {
      const index = this.parameterIndex(parameterId);
      return index >= 0 ? this.parameterDefaults[index] ?? 0 : Number.NaN;
    }
    private writeParameterValue(parameterId: unknown, value: number): void {
      const index = this.parameterIndex(parameterId);
      if (index >= 0) {
        this.parameterValues[index] = value;
      }
      if (parameterId === 'ParamAngleX' || parameterId === 'ParamBodyAngleX' || parameterId === 'ParamBodyAngleZ' || parameterId === 'ParamMouthOpenY') {
        gl.__setInteractionTone(value);
      }
    }
    public loadModel(_buffer: ArrayBuffer, _shouldCheckMocConsistency?: boolean) {
      this._model = this.model;
    }
    public loadMotion(
      _buffer: ArrayBuffer,
      _size: number,
      name: string,
      _onFinishedMotionHandler?: unknown,
      _onBeganMotionHandler?: unknown,
      _modelSetting?: unknown,
      _group?: string,
      _index?: number,
    ) {
      return {
        name,
        __effectIdsApplied: false,
        setEffectIds: vi.fn(function setEffectIds(this: { __effectIdsApplied: boolean }, eyeBlinkIds: unknown[], lipSyncIds: unknown[]) {
          this.__effectIdsApplied = Array.isArray(eyeBlinkIds) && Array.isArray(lipSyncIds);
        }),
      };
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
      create: vi.fn(() => ({
        evaluate: vi.fn((model: unknown) => {
          (model as Live2DVisualModelShape).setParameterValueById('ParamAngleX', 9);
        }),
      })),
    },
    CubismPose: {
      create: vi.fn(() => ({
        updateParameters: vi.fn((model: unknown) => {
          (model as Live2DVisualModelShape).setParameterValueById('ParamBodyAngleX', 5);
        }),
      })),
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

async function createHostWithFakeRuntime(options: {
  drawVisible: boolean;
  loaded?: boolean;
  parameters?: Map<string, number>;
  activeMotion?: string | null;
  activeMotionLoop?: boolean;
  idleMotionGroup?: string | null;
  activeExpression?: string | null;
  speechLipsyncParameters?: Map<string, number>;
  expressionParameters?: readonly Live2DExpressionParameter[];
  motionGroups?: Map<string, string[]>;
  expressions?: Map<string, string>;
  physicsPath?: string | null;
  posePath?: string | null;
}) {
  const { createLive2DCarrierVisualHost } = await import('./carrier-visual-host.js');
  const gl = createFakeGl({ drawVisible: options.drawVisible });
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', {
    value: vi.fn(() => gl),
  });
  const host = await createLive2DCarrierVisualHost({
    canvas,
    session: createSession({
      loaded: options.loaded,
      parameters: options.parameters,
      activeMotion: options.activeMotion,
      activeMotionLoop: options.activeMotionLoop,
      idleMotionGroup: options.idleMotionGroup,
      activeExpression: options.activeExpression,
      speechLipsyncParameters: options.speechLipsyncParameters,
      expressionParameters: options.expressionParameters,
      motionGroups: options.motionGroups,
      expressions: options.expressions,
      physicsPath: options.physicsPath,
      posePath: options.posePath,
    }),
    width: 128,
    height: 160,
  }, {
    loadRuntime: async () => createFakeRuntime(gl),
    readBinary: vi.fn(async () => new ArrayBuffer(8)),
    loadTexture: vi.fn(async () => ({}) as WebGLTexture),
    verifyShaders: vi.fn(async () => []),
  });
  return { host, gl };
}

describe('Live2D carrier visual host', () => {
  it('renders a loaded Avatar backend session without synchronous pixel proof', async () => {
    const { host, gl } = await createHostWithFakeRuntime({ drawVisible: true });
    const stats = host.drawFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 });

    expect(stats).toEqual(expect.objectContaining({
      width: 128,
      height: 160,
      drawableCount: 1,
      visibleDrawableCount: 1,
      nonZeroOpacityDrawableCount: 1,
      textureBindingCount: 1,
    }));
    expect(gl.readPixels).not.toHaveBeenCalled();
  });

  it('draws steady frames without synchronous pixel readback', async () => {
    const { host, gl } = await createHostWithFakeRuntime({ drawVisible: true });
    const stats = host.drawFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 });

    expect(stats).toEqual(expect.objectContaining({
      width: 128,
      height: 160,
      drawableCount: 1,
      visibleDrawableCount: 1,
      nonZeroOpacityDrawableCount: 1,
      textureBindingCount: 1,
    }));
    expect(stats).not.toHaveProperty('sampledPixels');
    expect(gl.readPixels).not.toHaveBeenCalled();
  });

  it('rejects unloaded backend sessions before creating a visual success state', async () => {
    await expect(createHostWithFakeRuntime({ drawVisible: true, loaded: false }))
      .rejects.toThrow('requires a loaded backend session');
  });

  it('applies interaction parameter lanes without a pixel checksum harness', async () => {
    const { host: activeHost } = await createHostWithFakeRuntime({
      drawVisible: true,
      parameters: new Map([
        ['ParamAngleX', 12],
        ['ParamBodyAngleZ', 6],
      ]),
    });

    const active = activeHost.drawFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 });
    expect(active.parameterLaneApplied).toContain('live2d_extension_direct');
  });

  it('applies loaded motion and expression state through Cubism managers before drawing', async () => {
    const { host } = await createHostWithFakeRuntime({
      drawVisible: true,
      activeMotion: 'Idle',
      activeExpression: 'exp_01',
      motionGroups: new Map([
        ['Idle', ['/models/ren/runtime/motions/mtn_01.motion3.json']],
      ]),
      expressions: new Map([
        ['exp_01', '/models/ren/runtime/expressions/exp_01.exp3.json'],
      ]),
    });

    const stats = host.drawFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 });

    expect(stats).toEqual(expect.objectContaining({
      activeMotionGroup: 'Idle',
      motionFrameApplied: true,
      activeExpressionId: 'exp_01',
      expressionFrameApplied: true,
      parameterLaneOrder: LIVE2D_PARAMETER_LANE_ORDER,
    }));
  });

  it('stops ambient Live2D lanes under reduced motion while preserving static expression output', async () => {
    const { host } = await createHostWithFakeRuntime({
      drawVisible: true,
      activeMotion: 'Breathing',
      idleMotionGroup: 'Breathing',
      activeExpression: 'exp_01',
      motionGroups: new Map([
        ['Breathing', ['/models/ren/runtime/motions/mtn_01.motion3.json']],
      ]),
      expressions: new Map([
        ['exp_01', '/models/ren/runtime/expressions/exp_01.exp3.json'],
      ]),
      physicsPath: '/models/ren/runtime/ren.physics3.json',
      parameters: new Map([
        ['ParamAngleX', 9],
        ['ParamAngleY', -4],
      ]),
    });

    const stats = host.drawFrame({
      deltaTimeSeconds: 1 / 60,
      seconds: 1,
      reducedMotion: true,
    });

    expect(stats.motionFrameApplied).toBe(false);
    expect(stats.expressionFrameApplied).toBe(true);
    expect(stats.parameterLaneApplied).toContain('expression');
    for (const lane of ['motion', 'physics', 'breath_blink', 'look_at_idle'] as const) {
      expect(stats.parameterLaneApplied).not.toContain(lane);
    }
  });

  it('restarts the same ambient motion after reduced motion is disabled', async () => {
    const { host } = await createHostWithFakeRuntime({
      drawVisible: true,
      activeMotion: 'Breathing',
      idleMotionGroup: 'Breathing',
      motionGroups: new Map([
        ['Breathing', ['/models/ren/runtime/motions/mtn_01.motion3.json']],
      ]),
    });

    expect(host.drawFrame({ reducedMotion: false }).motionFrameApplied).toBe(true);
    expect(host.drawFrame({ reducedMotion: true }).motionFrameApplied).toBe(false);
    expect(host.drawFrame({ reducedMotion: false }).motionFrameApplied).toBe(true);
  });

  it('preserves bounded semantic Live2D motion under reduced motion', async () => {
    const { host } = await createHostWithFakeRuntime({
      drawVisible: true,
      activeMotion: 'SidleStep',
      motionGroups: new Map([
        ['SidleStep', ['/models/ren/runtime/motions/sidle_step.motion3.json']],
      ]),
    });

    expect(host.drawFrame({ reducedMotion: true }).motionFrameApplied).toBe(true);
  });

  it('suppresses a non-idle looping Live2D motion under reduced motion', async () => {
    const { host } = await createHostWithFakeRuntime({
      drawVisible: true,
      activeMotion: 'Listening',
      activeMotionLoop: true,
      motionGroups: new Map([
        ['Listening', ['/models/ren/runtime/motions/listening.motion3.json']],
      ]),
    });

    expect(host.drawFrame({ reducedMotion: true }).motionFrameApplied).toBe(false);
  });

  it('surfaces speech and direct parameter lanes while preserving final direct mouth precedence', async () => {
    const { host } = await createHostWithFakeRuntime({
      drawVisible: true,
      activeExpression: 'talking_smile',
      expressions: new Map([
        ['talking_smile', '/models/ren/runtime/expressions/talking_smile.exp3.json'],
      ]),
      expressionParameters: [
        { id: 'ParamMouthOpenY', value: 0.9, blend: 'overwrite' },
      ],
      speechLipsyncParameters: new Map([
        ['ParamMouthOpenY', 0.3],
      ]),
      parameters: new Map([
        ['ParamMouthOpenY', 0.1],
      ]),
    });

    const stats = host.drawFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 });

    expect(stats.parameterLaneOrder).toEqual(LIVE2D_PARAMETER_LANE_ORDER);
    expect(stats.parameterLaneApplied).toEqual(expect.arrayContaining([
      'expression',
      'breath_blink',
      'speech_lipsync',
      'live2d_extension_direct',
    ]));
    expect(stats.parameterLaneSpeechLipsyncParameterCount).toBe(1);
    expect(stats.parameterLaneDirectParameterCount).toBe(1);
    expect(stats.parameterLaneUnsupportedParameterIds).toEqual([]);
  });

  it('runs the look-at / idle-life lane when compatible eye parameters are present', async () => {
    const { host } = await createHostWithFakeRuntime({
      drawVisible: true,
      parameters: new Map([
        ['ParamAngleX', 9],
        ['ParamAngleY', -4],
      ]),
    });

    const stats = host.drawFrame({ deltaTimeSeconds: 1 / 30, seconds: 4.21 });

    expect(stats.parameterLaneApplied).toEqual(expect.arrayContaining([
      'look_at_idle',
      'live2d_extension_direct',
    ]));
    expect(stats.lookAtIdleSupported).toBe(true);
    expect(stats.lookAtIdleBlinkSupported).toBe(true);
    expect(stats.lookAtIdleReasonCode).toBe('ready');
    expect(stats.lookAtIdleParameterIds).toEqual([
      'ParamEyeBallX',
      'ParamEyeBallY',
      'ParamEyeLOpen',
      'ParamEyeROpen',
    ]);
  });

  it('updates loaded physics and pose during the official SDK visual frame', async () => {
    const { host: baselineHost } = await createHostWithFakeRuntime({ drawVisible: true });
    const { host: physicsPoseHost } = await createHostWithFakeRuntime({
      drawVisible: true,
      physicsPath: '/models/ren/runtime/ren.physics3.json',
      posePath: '/models/ren/runtime/ren.pose3.json',
    });

    baselineHost.drawFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 });
    const withPhysicsPose = physicsPoseHost.drawFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 });

    expect(withPhysicsPose.parameterLaneApplied).toEqual(expect.arrayContaining([
      'physics',
      'pose',
      'breath_blink',
    ]));
  });

  it('warns and skips unsupported direct parameter ids in the carrier lane frame', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { host } = await createHostWithFakeRuntime({
      drawVisible: true,
      parameters: new Map([
        ['ParamMissing', 1],
      ]),
    });

    const stats = host.drawFrame({ deltaTimeSeconds: 1 / 60, seconds: 1 });

    expect(stats.parameterLaneUnsupportedParameterIds).toEqual(['ParamMissing']);
    expect(stats.parameterLaneDirectParameterCount).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ParamMissing'));
    warnSpy.mockRestore();
  });
});
