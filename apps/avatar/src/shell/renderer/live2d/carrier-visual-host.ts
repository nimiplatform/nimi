import {
  loadLive2DTextureFromBytes,
  resolveLive2DShaderRootUrl,
  verifyLive2DShaderAssets,
} from './carrier-visual-assets.js';
import {
  loadLive2DVisualRuntime,
  type Live2DVisualModelShape,
  type Live2DVisualRuntime,
} from './carrier-visual-runtime.js';
import { readBinaryFile } from './model-loader.js';
import type { Live2DBackendSession } from './backend-session.js';
import { createLive2DExpressionOverlay, type Live2DExpressionOverlayFrame } from './live2d-expression-stack.js';
import {
  createLive2DParameterLaneScheduler,
  type Live2DParameterCommandLanes,
  type Live2DParameterLaneId,
} from './live2d-parameter-lane-scheduler.js';
import {
  createLive2DLookAtIdleController,
  type Live2DLookAtIdleController,
  type Live2DLookAtIdleReasonCode,
} from './live2d-look-at-idle.js';

export type Live2DCarrierVisualDrawStats = {
  width: number;
  height: number;
  drawableCount: number;
  visibleDrawableCount: number;
  nonZeroOpacityDrawableCount: number;
  textureBindingCount: number;
  activeMotionGroup: string | null;
  motionFrameApplied: boolean;
  activeExpressionId: string | null;
  expressionFrameApplied: boolean;
  parameterLaneOrder: readonly Live2DParameterLaneId[];
  parameterLaneApplied: readonly Live2DParameterLaneId[];
  parameterLaneElapsedMs: number;
  parameterLaneUnsupportedParameterIds: readonly string[];
  parameterLaneSpeechLipsyncParameterCount: number;
  parameterLaneDirectParameterCount: number;
  lookAtIdleSupported: boolean;
  lookAtIdleBlinkSupported: boolean;
  lookAtIdleReasonCode: Live2DLookAtIdleReasonCode;
  lookAtIdleParameterIds: readonly string[];
};

export type Live2DCarrierVisualHost = {
  readonly canvas: HTMLCanvasElement;
  drawFrame(input?: {
    deltaTimeSeconds?: number;
    seconds?: number;
    reducedMotion?: boolean;
  }): Live2DCarrierVisualDrawStats;
  resize(width: number, height: number): void;
  unload(): void;
};

export type Live2DCarrierVisualHostDeps = {
  loadRuntime?: () => Promise<Live2DVisualRuntime>;
  readBinary?: (path: string) => Promise<ArrayBuffer>;
  loadTexture?: (input: {
    gl: WebGLRenderingContext | WebGL2RenderingContext;
    path: string;
    bytes: ArrayBuffer;
  }) => Promise<WebGLTexture>;
  verifyShaders?: () => Promise<readonly string[]>;
};

type VisualModelHandle = {
  drawFrame(input: {
    width: number;
    height: number;
    deltaTimeSeconds: number;
    seconds: number;
    reducedMotion: boolean;
  }): Live2DCarrierVisualDrawStats;
  resize(width: number, height: number): void;
  release(): void;
};

type MotionManagerLike = {
  startMotionPriority: (motion: unknown, autoDelete: boolean, priority: number) => number;
  updateMotion: (model: Live2DVisualModelShape, deltaTimeSeconds: number) => boolean;
  stopAllMotions: () => void;
};

type CubismMotionLike = {
  setEffectIds?: (eyeBlinkIds: unknown[], lipSyncIds: unknown[]) => void;
};

type PhysicsLike = {
  evaluate: (model: Live2DVisualModelShape, deltaTimeSeconds: number) => void;
};

type PoseLike = {
  updateParameters: (model: Live2DVisualModelShape, deltaTimeSeconds: number) => void;
};

function protectedMotionManager(model: unknown): MotionManagerLike {
  const manager = (model as { _motionManager?: MotionManagerLike })._motionManager;
  if (!manager) {
    throw new Error('Live2D carrier visual motion manager is unavailable');
  }
  return manager;
}

function createModelJsonBuffer(session: Live2DBackendSession): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(session.settings)).buffer;
}

function readEffectIds(input: {
  setting: InstanceType<Live2DVisualRuntime['CubismModelSettingJson']>;
  count: () => number;
  idAt: (index: number) => unknown;
}): unknown[] {
  const ids: unknown[] = [];
  const count = Math.max(0, input.count());
  for (let index = 0; index < count; index += 1) {
    ids.push(input.idAt(index));
  }
  return ids;
}

function getModelRef(model: unknown): Live2DVisualModelShape | null {
  return (model as { _model?: Live2DVisualModelShape | null })._model ?? null;
}

function executionParameterLanes(
  execution: Live2DBackendSession['execution'],
): Live2DParameterCommandLanes {
  const lanes = execution.parameterLanes;
  if (lanes) {
    return {
      speechLipsync: lanes.speechLipsync,
      live2dExtensionDirect: lanes.live2dExtensionDirect,
    };
  }
  return {
    speechLipsync: new Map(),
    live2dExtensionDirect: execution.parameters,
  };
}

async function createVisualModel(input: {
  runtime: Live2DVisualRuntime;
  session: Live2DBackendSession;
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  width: number;
  height: number;
  readBinary: (path: string) => Promise<ArrayBuffer>;
  loadTexture: NonNullable<Live2DCarrierVisualHostDeps['loadTexture']>;
}): Promise<VisualModelHandle> {
  const runtime = input.runtime;
  const { CubismFramework } = runtime;

  class AvatarCarrierCubismModel extends runtime.CubismUserModel {
    private modelSetting: InstanceType<Live2DVisualRuntime['CubismModelSettingJson']> | null = null;
    private readonly textures: WebGLTexture[] = [];
    private baseModelMatrix: Float32Array | null = null;
    private widePortraitMode: boolean = false;
    private defaultFramebuffer: WebGLFramebuffer | null = null;
    private readonly motions = new Map<string, unknown[]>();
    private readonly expressions = new Map<string, unknown>();
    private readonly expressionOverlay = createLive2DExpressionOverlay(input.session.expressionInventory);
    private readonly parameterLaneScheduler = createLive2DParameterLaneScheduler();
    private lookAtIdle: Live2DLookAtIdleController | null = null;
    private startedMotionGroup: string | null = null;
    private startedExpressionId: string | null = null;
    private eyeBlinkIds: unknown[] = [];
    private lipSyncIds: unknown[] = [];
    private breath: {
      setParameters: (params: unknown[]) => void;
      updateParameters: (model: Live2DVisualModelShape, deltaTimeSeconds: number) => void;
    } | null = null;
    private physics: PhysicsLike | null = null;
    private pose: PoseLike | null = null;

    public async initialize(width: number, height: number): Promise<void> {
      const modelJsonBytes = createModelJsonBuffer(input.session);
      this.modelSetting = new runtime.CubismModelSettingJson(modelJsonBytes, modelJsonBytes.byteLength);
      const mocBytes = await input.readBinary(input.session.resources.mocPath);
      this.loadModel(mocBytes, true);
      if (!getModelRef(this) || !this.getModelMatrix()) {
        throw new Error(`Live2D carrier visual failed to initialize model: ${input.session.resources.mocPath}`);
      }
      this.lookAtIdle = createLive2DLookAtIdleController(getModelRef(this)!);
      this.setupEffectIds();
      this.setupBreath();
      await this.loadMotions();
      await this.loadExpressions();
      await this.loadPhysics();
      await this.loadPose();
      this.defaultFramebuffer = input.gl.getParameter(input.gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      this.createRenderer(width, height);
      const renderer = this.getRenderer();
      renderer.startUp(input.gl);
      renderer.setIsPremultipliedAlpha(true);
      renderer.loadShaders(resolveLive2DShaderRootUrl());
      for (const [index, texturePath] of input.session.resources.texturePaths.entries()) {
        const textureBytes = await input.readBinary(texturePath);
        const texture = await input.loadTexture({
          gl: input.gl,
          path: texturePath,
          bytes: textureBytes,
        });
        this.textures.push(texture);
        renderer.bindTexture(index, texture);
      }
      this.resize(width, height);
    }

    public resize(width: number, height: number): void {
      if (width <= 0 || height <= 0) {
        return;
      }
      this.getRenderer().setRenderTargetSize(width, height);
      const modelMatrix = this.getModelMatrix();
      if (!modelMatrix) {
        return;
      }
      modelMatrix.loadIdentity();
      const layout = new Map<string, number>();
      this.modelSetting?.getLayoutMap?.(layout);
      const model = getModelRef(this);
      const canvasWidth = model ? model.getCanvasWidth() : 1;
      this.widePortraitMode = canvasWidth > 1.0 && width < height;
      if (layout.size > 0) {
        modelMatrix.setupFromLayout(layout);
      }
      if (this.widePortraitMode) {
        modelMatrix.setWidth(2);
      } else {
        modelMatrix.setHeight(2);
      }
      this.baseModelMatrix = new Float32Array(modelMatrix.getArray());
    }

    private renderDrawFrame(inputFrame: {
      width: number;
      height: number;
      deltaTimeSeconds: number;
      seconds: number;
      reducedMotion: boolean;
    }): Live2DCarrierVisualDrawStats {
      const model = getModelRef(this);
      const modelMatrix = this.getModelMatrix();
      if (!model || !modelMatrix) {
        throw new Error('Live2D carrier visual model is not initialized');
      }
      if (this.baseModelMatrix) {
        modelMatrix.setMatrix(this.baseModelMatrix);
      }
      model.loadParameters();
      let motionFrameApplied = false;
      let expressionFrame: Live2DExpressionOverlayFrame = {
        activeExpressionId: this.startedExpressionId,
        frameApplied: false,
        parameterIds: [],
        resetParameterIds: [],
      };
      let lookAtIdleFrame = this.lookAtIdle?.snapshot() ?? {
        gazeSupported: false,
        blinkSupported: false,
        parameterIds: [],
        reasonCode: 'eye_parameters_missing' as const,
      };
      const commandLanes = executionParameterLanes(input.session.execution);
      const laneStats = this.parameterLaneScheduler.run({
        model,
        parameters: commandLanes,
        lanes: {
          motion: () => {
            const requestedMotion = input.session.execution.activeMotion;
            const isAmbientMotion = requestedMotion !== null
              && requestedMotion === input.session.compatibility.idleMotionGroup;
            if (inputFrame.reducedMotion
              && (isAmbientMotion || input.session.execution.activeMotionLoop)) {
              if (this.startedMotionGroup !== null) {
                protectedMotionManager(this).stopAllMotions();
                this.startedMotionGroup = null;
              }
              model.saveParameters();
              return false;
            }
            this.syncMotionState();
            motionFrameApplied = protectedMotionManager(this).updateMotion(model, inputFrame.deltaTimeSeconds);
            model.saveParameters();
            return motionFrameApplied;
          },
          expression: () => {
            expressionFrame = this.expressionOverlay.apply(model, input.session.execution.activeExpression);
            this.startedExpressionId = expressionFrame.activeExpressionId;
            return expressionFrame.frameApplied;
          },
          physics: () => {
            if (inputFrame.reducedMotion) return false;
            if (!this.physics) return false;
            this.physics.evaluate(model, inputFrame.deltaTimeSeconds);
            return true;
          },
          pose: () => {
            if (!this.pose) return false;
            this.pose.updateParameters(model, inputFrame.deltaTimeSeconds);
            return true;
          },
          breath_blink: () => {
            if (inputFrame.reducedMotion) return false;
            if (!this.breath) return false;
            this.breath.updateParameters(model, inputFrame.deltaTimeSeconds);
            return true;
          },
          look_at_idle: () => {
            if (inputFrame.reducedMotion) return false;
            if (!this.lookAtIdle) return false;
            const frame = this.lookAtIdle.apply({
              model,
              deltaTimeSeconds: inputFrame.deltaTimeSeconds,
              seconds: inputFrame.seconds,
              directParameters: commandLanes.live2dExtensionDirect,
            });
            lookAtIdleFrame = frame;
            return frame.applied;
          },
        },
      });
      model.saveParameters();
      model.update();

      input.gl.viewport(0, 0, inputFrame.width, inputFrame.height);
      input.gl.clearColor(0, 0, 0, 0);
      input.gl.clear(input.gl.COLOR_BUFFER_BIT | input.gl.DEPTH_BUFFER_BIT | input.gl.STENCIL_BUFFER_BIT);

      const projectionMatrix = new runtime.CubismMatrix44();
      if (this.widePortraitMode) {
        projectionMatrix.scale(1, inputFrame.width / Math.max(inputFrame.height, 1));
      } else {
        projectionMatrix.scale(inputFrame.height / Math.max(inputFrame.width, 1), 1);
      }
      projectionMatrix.multiplyByMatrix(modelMatrix);

      const offscreen = runtime.CubismWebGLOffscreenManager.getInstance();
      offscreen.beginFrameProcess(input.gl);
      try {
        const renderer = this.getRenderer();
        renderer.setMvpMatrix(projectionMatrix);
        renderer.setRenderState(this.defaultFramebuffer, [
          0,
          0,
          inputFrame.width,
          inputFrame.height,
        ]);
        renderer.drawModel(resolveLive2DShaderRootUrl());
        input.gl.flush();
      } finally {
        offscreen.endFrameProcess(input.gl);
        offscreen.releaseStaleRenderTextures(input.gl);
      }

      const drawableCount = model.getDrawableCount();
      let visibleDrawableCount = 0;
      let nonZeroOpacityDrawableCount = 0;
      for (let index = 0; index < drawableCount; index += 1) {
        if (model.getDrawableDynamicFlagIsVisible(index)) {
          visibleDrawableCount += 1;
        }
        if (model.getDrawableOpacity(index) > 0.001) {
          nonZeroOpacityDrawableCount += 1;
        }
      }
      return {
        width: inputFrame.width,
        height: inputFrame.height,
        drawableCount,
        visibleDrawableCount,
        nonZeroOpacityDrawableCount,
        textureBindingCount: this.getRenderer().getBindedTextures().size,
        activeMotionGroup: this.startedMotionGroup,
        motionFrameApplied,
        activeExpressionId: this.startedExpressionId,
        expressionFrameApplied: expressionFrame.frameApplied,
        parameterLaneOrder: laneStats.laneOrder,
        parameterLaneApplied: laneStats.appliedLanes,
        parameterLaneElapsedMs: laneStats.elapsedMs,
        parameterLaneUnsupportedParameterIds: laneStats.unsupportedParameterIds,
        parameterLaneSpeechLipsyncParameterCount: laneStats.speechLipsyncParameterCount,
        parameterLaneDirectParameterCount: laneStats.directParameterCount,
        lookAtIdleSupported: lookAtIdleFrame.gazeSupported,
        lookAtIdleBlinkSupported: lookAtIdleFrame.blinkSupported,
        lookAtIdleReasonCode: lookAtIdleFrame.reasonCode,
        lookAtIdleParameterIds: lookAtIdleFrame.parameterIds,
      };
    }

    public drawFrame(inputFrame: {
      width: number;
      height: number;
      deltaTimeSeconds: number;
      seconds: number;
      reducedMotion: boolean;
    }): Live2DCarrierVisualDrawStats {
      return this.renderDrawFrame(inputFrame);
    }

    public override release(): void {
      runtime.CubismWebGLOffscreenManager.getInstance().removeContext(input.gl);
      for (const texture of this.textures) {
        input.gl.deleteTexture(texture);
      }
      this.textures.length = 0;
      super.release();
    }

    private async loadExpressions(): Promise<void> {
      for (const [name, path] of input.session.resources.expressions) {
        const bytes = await input.readBinary(path);
        const expression = this.loadExpression(bytes, bytes.byteLength, name);
        if (!expression) {
          throw new Error(`Live2D carrier visual failed to load expression: ${name}`);
        }
        this.expressions.set(name, expression);
      }
    }

    private async loadMotions(): Promise<void> {
      for (const [group, paths] of input.session.resources.motionGroups) {
        const motions: unknown[] = [];
        for (const [index, path] of paths.entries()) {
          const bytes = await input.readBinary(path);
          const motion = this.loadMotion(
            bytes,
            bytes.byteLength,
            `${group}_${index}`,
            undefined,
            undefined,
            this.modelSetting ?? undefined,
            group,
            index,
          );
          if (!motion) {
            throw new Error(`Live2D carrier visual failed to load motion: ${group}`);
          }
          (motion as CubismMotionLike).setEffectIds?.(this.eyeBlinkIds, this.lipSyncIds);
          motions.push(motion);
        }
        this.motions.set(group, motions);
      }
    }

    private syncMotionState(): void {
      const requested = input.session.execution.activeMotion;
      const manager = protectedMotionManager(this);
      if (!requested) {
        if (this.startedMotionGroup !== null) {
          manager.stopAllMotions();
          this.startedMotionGroup = null;
        }
        return;
      }
      if (this.startedMotionGroup === requested) {
        return;
      }
      const motion = this.motions.get(requested)?.[0] ?? null;
      if (!motion) {
        throw new Error(`Live2D carrier visual motion is not loaded: ${requested}`);
      }
      const handle = manager.startMotionPriority(motion, false, 2);
      if (handle < 0) {
        throw new Error(`Live2D carrier visual motion was rejected by Cubism: ${requested}`);
      }
      this.startedMotionGroup = requested;
    }

    private async loadPhysics(): Promise<void> {
      if (!input.session.resources.physicsPath) {
        return;
      }
      const bytes = await input.readBinary(input.session.resources.physicsPath);
      this.physics = runtime.CubismPhysics.create(bytes, bytes.byteLength) as PhysicsLike | null;
    }

    private async loadPose(): Promise<void> {
      if (!input.session.resources.posePath) {
        return;
      }
      const bytes = await input.readBinary(input.session.resources.posePath);
      this.pose = runtime.CubismPose.create(bytes, bytes.byteLength) as PoseLike | null;
    }

    private setupBreath(): void {
      this.breath = runtime.CubismBreath.create();
      this.breath.setParameters([
        new runtime.BreathParameterData(CubismFramework.getIdManager().getId(String(runtime.CubismDefaultParameterId.ParamAngleX)), 0, 10, 6.5, 0.3),
        new runtime.BreathParameterData(CubismFramework.getIdManager().getId(String(runtime.CubismDefaultParameterId.ParamAngleY)), 0, 6, 3.5, 0.3),
        new runtime.BreathParameterData(CubismFramework.getIdManager().getId(String(runtime.CubismDefaultParameterId.ParamBodyAngleX)), 0, 4, 15.5, 0.3),
      ]);
    }

    private setupEffectIds(): void {
      if (!this.modelSetting) {
        throw new Error('Live2D carrier visual model setting is unavailable for effect ids');
      }
      this.eyeBlinkIds = readEffectIds({
        setting: this.modelSetting,
        count: () => this.modelSetting?.getEyeBlinkParameterCount() ?? 0,
        idAt: (index) => this.modelSetting?.getEyeBlinkParameterId(index),
      });
      this.lipSyncIds = readEffectIds({
        setting: this.modelSetting,
        count: () => this.modelSetting?.getLipSyncParameterCount() ?? 0,
        idAt: (index) => this.modelSetting?.getLipSyncParameterId(index),
      });
    }
  }

  const model = new AvatarCarrierCubismModel();
  await model.initialize(input.width, input.height);
  return model;
}

// @nimi-authority: rule.nimi.avatar.embodiment.r078
export async function createLive2DCarrierVisualHost(
  input: {
    canvas: HTMLCanvasElement;
    session: Live2DBackendSession;
    width: number;
    height: number;
  },
  deps: Live2DCarrierVisualHostDeps = {},
): Promise<Live2DCarrierVisualHost> {
  if (!input.session.execution.loaded) {
    throw new Error('Live2D carrier visual host requires a loaded backend session');
  }
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));
  input.canvas.width = width;
  input.canvas.height = height;
  const gl = (input.canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  }) || input.canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  })) as WebGLRenderingContext | WebGL2RenderingContext | null;
  if (!gl) {
    throw new Error('Live2D carrier visual host could not acquire a WebGL context');
  }

  const [runtime] = await Promise.all([
    (deps.loadRuntime ?? loadLive2DVisualRuntime)(),
    (deps.verifyShaders ?? verifyLive2DShaderAssets)(),
  ]);
  const model = await createVisualModel({
    runtime,
    session: input.session,
    gl,
    width,
    height,
    readBinary: deps.readBinary ?? readBinaryFile,
    loadTexture: deps.loadTexture ?? loadLive2DTextureFromBytes,
  });

  return {
    canvas: input.canvas,
    drawFrame(frameInput = {}) {
      return model.drawFrame({
        width: input.canvas.width,
        height: input.canvas.height,
        deltaTimeSeconds: frameInput.deltaTimeSeconds ?? 1 / 60,
        seconds: frameInput.seconds ?? performance.now() / 1000,
        reducedMotion: frameInput.reducedMotion ?? false,
      });
    },
    resize(nextWidth, nextHeight) {
      const nextCanvasWidth = Math.max(1, Math.round(nextWidth));
      const nextCanvasHeight = Math.max(1, Math.round(nextHeight));
      if (input.canvas.width !== nextCanvasWidth) {
        input.canvas.width = nextCanvasWidth;
      }
      if (input.canvas.height !== nextCanvasHeight) {
        input.canvas.height = nextCanvasHeight;
      }
      model.resize(nextCanvasWidth, nextCanvasHeight);
    },
    unload() {
      model.release();
    },
  };
}
