import type {
  ChatAgentAvatarLive2dModelSource,
  ChatAgentAvatarLive2dViewportState,
} from './chat-agent-avatar-live2d-viewport-state';
import { resolveChatAgentAvatarLive2dFramingPolicy } from './chat-agent-avatar-live2d-framing';

type OfficialCubismRuntime = {
  CubismFramework: {
    startUp: (option?: unknown) => boolean;
    initialize: () => void;
    isStarted: () => boolean;
    isInitialized: () => boolean;
    getIdManager: () => {
      getId: (value: string) => unknown;
    };
  };
  Option: new () => {
    logFunction?: (message: string) => void;
    loggingLevel?: number;
  };
  CubismUserModel: new () => {
    loadModel: (buffer: ArrayBuffer, shouldCheckMocConsistency?: boolean) => void;
    loadExpression: (buffer: ArrayBuffer, size: number, name: string) => unknown;
    createRenderer: (width: number, height: number, maskBufferCount?: number) => void;
    getRenderer: () => {
      startUp: (gl: WebGLRenderingContext | WebGL2RenderingContext) => void;
      bindTexture: (modelTextureNo: number, glTexture: WebGLTexture) => void;
      getBindedTextures: () => Map<number, WebGLTexture>;
      setIsPremultipliedAlpha: (value: boolean) => void;
      setRenderTargetSize: (width: number, height: number) => void;
      setRenderState: (fbo: WebGLFramebuffer | null, viewport: number[]) => void;
      setMvpMatrix: (matrix: { getArray: () => Float32Array }) => void;
      drawModel: (shaderPath?: string | null) => void;
    };
    getModelMatrix: () => {
      loadIdentity: () => void;
      setWidth: (value: number) => void;
      setHeight: (value: number) => void;
      centerX: (value: number) => void;
      centerY: (value: number) => void;
      bottom: (value: number) => void;
      setMatrix: (value: Float32Array) => void;
      getArray: () => Float32Array;
      setupFromLayout: (layout: Map<string, number>) => void;
      scaleRelative: (x: number, y: number) => void;
      translateRelative: (x: number, y: number) => void;
    } | null;
    release(): void;
  };
  CubismModelSettingJson: new (buffer: ArrayBuffer, size: number) => {
    getModelFileName: () => string;
    getTextureCount: () => number;
    getTextureFileName: (index: number) => string;
    getLayoutMap: (layout: Map<string, number>) => boolean;
    getPhysicsFileName: () => string;
    getPoseFileName: () => string;
    getExpressionCount: () => number;
    getExpressionName: (index: number) => string;
    getExpressionFileName: (index: number) => string;
    getMotionCount: (groupName: string) => number;
    getMotionFileName: (groupName: string, index: number) => string;
    getMotionFadeInTimeValue: (groupName: string, index: number) => number;
    getMotionFadeOutTimeValue: (groupName: string, index: number) => number;
    getEyeBlinkParameterCount: () => number;
    getEyeBlinkParameterId: (index: number) => unknown;
    getLipSyncParameterCount: () => number;
    getLipSyncParameterId: (index: number) => unknown;
  };
  CubismMotion: {
    create: (buffer: ArrayBuffer, size: number) => {
      setFadeInTime: (value: number) => void;
      setFadeOutTime: (value: number) => void;
      setEffectIds: (eyeBlinkIds: unknown[], lipSyncIds: unknown[]) => void;
    } | null;
  };
  CubismEyeBlink: {
    create: (setting?: unknown) => {
      updateParameters: (model: CubismModelShape, deltaTimeSeconds: number) => void;
    } | null;
  };
  CubismBreath: {
    create: () => {
      setParameters: (params: unknown[]) => void;
      updateParameters: (model: CubismModelShape, deltaTimeSeconds: number) => void;
    };
  };
  BreathParameterData: new (
    parameterId: unknown,
    offset: number,
    peak: number,
    cycle: number,
    weight: number,
  ) => unknown;
  CubismPhysics: {
    create: (buffer: ArrayBuffer, size: number) => {
      evaluate: (model: CubismModelShape, deltaTimeSeconds: number) => void;
    } | null;
  };
  CubismPose: {
    create: (buffer: ArrayBuffer, size: number) => {
      updateParameters: (model: CubismModelShape, deltaTimeSeconds: number) => void;
    } | null;
  };
  CubismMatrix44: new () => {
    getArray: () => Float32Array;
    scale: (x: number, y: number) => void;
    scaleRelative: (x: number, y: number) => void;
    translateRelative: (x: number, y: number) => void;
    multiplyByMatrix: (matrix: unknown) => void;
  };
  CubismWebGLOffscreenManager: {
    getInstance: () => {
      beginFrameProcess: (gl: WebGLRenderingContext | WebGL2RenderingContext) => void;
      endFrameProcess: (gl: WebGLRenderingContext | WebGL2RenderingContext) => void;
      releaseStaleRenderTextures: (gl: WebGLRenderingContext | WebGL2RenderingContext) => void;
      removeContext: (gl: WebGLRenderingContext | WebGL2RenderingContext) => void;
    };
  };
  CubismDefaultParameterId: Record<string, string>;
};

type CubismModelSettingShape = InstanceType<OfficialCubismRuntime['CubismModelSettingJson']>;

type CubismModelShape = {
  loadParameters: () => void;
  saveParameters: () => void;
  update: () => void;
  addParameterValueById: (parameterId: unknown, value: number, weight?: number) => void;
  setParameterValueById: (parameterId: unknown, value: number, weight?: number) => void;
  getCanvasWidth: () => number;
  getCanvasHeight: () => number;
  getPixelsPerUnit: () => number;
  getDrawableCount: () => number;
  getDrawableOpacity: (drawableIndex: number) => number;
  getDrawableDynamicFlagIsVisible: (drawableIndex: number) => boolean;
  getDrawableVertexCount: (drawableIndex: number) => number;
};

type CubismModelHandle = {
  resize: (width: number, height: number) => void;
  renderFrame: (input: {
    width: number;
    height: number;
    deltaTimeSeconds: number;
    seconds: number;
    state: ChatAgentAvatarLive2dViewportState;
  }) => void;
  release: () => void;
};

export type ChatAgentAvatarLive2dMotionSelection = {
  group: string | null;
  source: 'speech' | 'idle' | 'fallback-nonidle' | 'fallback-any' | 'ambient-only';
  priority: number;
};

export type ChatAgentAvatarLive2dRenderMotionPose = {
  smoothedAmplitude: number;
  speakingEnergy: number;
  scale: number;
  swayX: number;
  swayY: number;
};

const PRESERVE_LIVE2D_URL_PATTERN = /^(blob:|asset:|file:|https?:|data:|live2d-memory:)/i;
const LIVE2D_SHADER_PATH = 'assets/js/live2d-cubism-framework-shaders/WebGL/';
const LIVE2D_SHADER_FILES = [
  'vertshadersrc.vert',
  'vertshadersrcmasked.vert',
  'vertshadersrcsetupmask.vert',
  'fragshadersrcsetupmask.frag',
  'fragshadersrcpremultipliedalpha.frag',
  'fragshadersrcmaskpremultipliedalpha.frag',
  'fragshadersrcmaskinvertedpremultipliedalpha.frag',
  'vertshadersrccopy.vert',
  'fragshadersrccopy.frag',
  'fragshadersrccolorblend.frag',
  'fragshadersrcalphablend.frag',
  'vertshadersrcblend.vert',
  'fragshadersrcpremultipliedalphablend.frag',
] as const;

let officialCubismRuntimePromise: Promise<OfficialCubismRuntime> | null = null;

function clampDeltaTimeSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1 / 60;
  }
  return Math.min(value, 0.1);
}

function easeToward(current: number, target: number, response: number, deltaTimeSeconds: number): number {
  const dt = clampDeltaTimeSeconds(deltaTimeSeconds);
  const alpha = 1 - Math.exp(-Math.max(response, 0.001) * dt);
  return current + (target - current) * alpha;
}

export function resolveChatAgentAvatarLive2dMotionSelection(input: {
  phase: ChatAgentAvatarLive2dViewportState['phase'];
  idleMotionGroup: string | null;
  speechMotionGroup: string | null;
  motionGroups: readonly string[];
}): ChatAgentAvatarLive2dMotionSelection {
  const groups = input.motionGroups.filter((value) => typeof value === 'string' && value.trim().length > 0);
  const idleGroup = input.idleMotionGroup && input.idleMotionGroup.trim() ? input.idleMotionGroup : null;
  const speechGroup = input.speechMotionGroup && input.speechMotionGroup.trim() ? input.speechMotionGroup : null;
  const firstGroup = groups[0] ?? null;
  const firstNonIdleGroup = groups.find((group) => group !== idleGroup) ?? null;

  if (input.phase === 'speaking') {
    if (speechGroup) {
      return {
        group: speechGroup,
        source: 'speech',
        priority: 3,
      };
    }
    if (firstNonIdleGroup) {
      return {
        group: firstNonIdleGroup,
        source: 'fallback-nonidle',
        priority: 2,
      };
    }
    if (idleGroup) {
      return {
        group: idleGroup,
        source: 'idle',
        priority: 1,
      };
    }
    if (firstGroup) {
      return {
        group: firstGroup,
        source: 'fallback-any',
        priority: 1,
      };
    }
    return {
      group: null,
      source: 'ambient-only',
      priority: 0,
    };
  }

  if (idleGroup) {
    return {
      group: idleGroup,
      source: 'idle',
      priority: 1,
    };
  }
  if (firstGroup) {
    return {
      group: firstGroup,
      source: 'fallback-any',
      priority: 1,
    };
  }
  return {
    group: null,
    source: 'ambient-only',
    priority: 0,
  };
}

export function resolveChatAgentAvatarLive2dRenderMotionPose(input: {
  previousSmoothedAmplitude: number;
  previousSpeakingEnergy: number;
  deltaTimeSeconds: number;
  seconds: number;
  state: ChatAgentAvatarLive2dViewportState;
}): ChatAgentAvatarLive2dRenderMotionPose {
  const dt = clampDeltaTimeSeconds(input.deltaTimeSeconds);
  const rawAmplitude = Math.max(0, Math.min(input.state.amplitude, 1));
  const speakingTargetAmplitude = input.state.phase === 'speaking' ? rawAmplitude : 0;
  const smoothedAmplitude = easeToward(
    input.previousSmoothedAmplitude,
    speakingTargetAmplitude,
    input.state.phase === 'speaking' ? 12 : 5,
    dt,
  );
  const speakingTargetEnergy = input.state.phase === 'speaking'
    ? Math.max(rawAmplitude, 0.22)
    : 0;
  const speakingEnergy = easeToward(
    input.previousSpeakingEnergy,
    speakingTargetEnergy,
    input.state.phase === 'speaking' ? 9 : 2.4,
    dt,
  );

  const breathing = 1 + Math.sin(input.seconds * (0.78 + input.state.motionSpeed * 0.22)) * 0.0105;
  const speakingPulse = 1 + Math.sin(
    input.seconds * (3.4 + smoothedAmplitude * 3.8 + speakingEnergy * 1.2),
  ) * (0.008 + speakingEnergy * 0.024);
  const scale = breathing * speakingPulse;

  const swayXAmplitude = input.state.phase === 'thinking'
    ? 0.019
    : input.state.phase === 'listening'
      ? 0.021
      : 0.018 + speakingEnergy * 0.014;
  const swayX = Math.sin(input.seconds * (0.32 + input.state.motionSpeed * 0.07)) * swayXAmplitude;

  const baseYOffset = input.state.phase === 'listening'
    ? -0.002
    : input.state.phase === 'thinking'
      ? -0.012
      : -0.008;
  const swayYAmplitude = 0.014 + speakingEnergy * 0.01;
  const swayY = baseYOffset + Math.sin(input.seconds * (0.58 + input.state.motionSpeed * 0.18)) * swayYAmplitude;

  return {
    smoothedAmplitude,
    speakingEnergy,
    scale,
    swayX,
    swayY,
  };
}

function setGlobalLive2dDebugSnapshot(snapshot: Record<string, unknown> | null): void {
  (globalThis as typeof globalThis & {
    __NIMI_LIVE2D_DEBUG__?: Record<string, unknown> | null;
  }).__NIMI_LIVE2D_DEBUG__ = snapshot;
}

function hasLive2dCubismCore(): boolean {
  return Boolean((globalThis as typeof globalThis & { Live2DCubismCore?: unknown }).Live2DCubismCore);
}

function describeLive2dRuntimeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Live2D Cubism runtime failed to initialize';
}

function decodeBase64Bytes(base64: string): Uint8Array {
  const runtimeGlobal = globalThis as typeof globalThis & {
    atob?: (value: string) => string;
    Buffer?: {
      from: (value: string, encoding: string) => {
        toString: (targetEncoding: string) => string;
      };
    };
  };
  if (typeof runtimeGlobal.atob === 'function') {
    const binary = runtimeGlobal.atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  if (runtimeGlobal.Buffer) {
    const binary = runtimeGlobal.Buffer.from(base64, 'base64').toString('binary');
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  throw new Error('Live2D asset payload cannot be decoded');
}

function arrayBufferFromBase64(base64: string): ArrayBuffer {
  const bytes = decodeBase64Bytes(base64);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function toLive2dAssetLoadError(input: {
  label: string;
  url: string;
  cause?: unknown;
  status?: number | null;
}): Error & { url?: string; status?: number } {
  const error = new Error(
    `${input.label}: ${input.url} (${describeLive2dRuntimeError(input.cause)})`,
  ) as Error & { url?: string; status?: number };
  error.url = input.url;
  if (typeof input.status === 'number') {
    error.status = input.status;
  }
  return error;
}

async function fetchArrayBufferFromUrl(url: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      throw toLive2dAssetLoadError({
        label: 'Failed to load Live2D asset',
        url,
        status: response.status,
        cause: new Error(`HTTP ${response.status}`),
      });
    }
    return response.arrayBuffer();
  } catch (error) {
    if (typeof (error as { url?: string } | null | undefined)?.url === 'string') {
      throw error;
    }
    throw toLive2dAssetLoadError({
      label: 'Failed to load Live2D asset',
      url,
      cause: error,
    });
  }
}

function resolveLive2dAssetUrl(baseUrl: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (PRESERVE_LIVE2D_URL_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return new URL(trimmed, baseUrl).toString();
}

function resolveLive2dShaderUrl(): string {
  return new URL(LIVE2D_SHADER_PATH, globalThis.location.href).toString();
}

async function verifyLive2dShaderAssets(): Promise<readonly string[]> {
  const shaderRoot = resolveLive2dShaderUrl();
  const shaderUrls = LIVE2D_SHADER_FILES.map((fileName) => new URL(fileName, shaderRoot).toString());
  await Promise.all(shaderUrls.map(async (url) => {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        throw toLive2dAssetLoadError({
          label: 'Failed to load Live2D shader',
          url,
          status: response.status,
          cause: new Error(`HTTP ${response.status}`),
        });
      }
      await response.text();
    } catch (error) {
      if (typeof (error as { url?: string } | null | undefined)?.url === 'string') {
        throw error;
      }
      throw toLive2dAssetLoadError({
        label: 'Failed to load Live2D shader',
        url,
        cause: error,
      });
    }
  }));
  return shaderUrls;
}

async function loadLive2dTexture(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  url: string,
  payload?: { mimeType: string; base64: string } | null,
): Promise<WebGLTexture> {
  try {
    const blob = payload
      ? new Blob([arrayBufferFromBase64(payload.base64)], {
        type: payload.mimeType || 'application/octet-stream',
      })
      : await (async () => {
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
          throw toLive2dAssetLoadError({
            label: 'Failed to load Live2D texture',
            url,
            status: response.status,
            cause: new Error(`HTTP ${response.status}`),
          });
        }
        return response.blob();
      })();
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'premultiply',
    });
    const texture = gl.createTexture();
    if (!texture) {
      bitmap.close();
      throw new Error(`Failed to allocate WebGL texture for ${url}`);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.bindTexture(gl.TEXTURE_2D, null);
    bitmap.close();

    return texture;
  } catch (error) {
    if (typeof (error as { url?: string } | null | undefined)?.url === 'string') {
      throw error;
    }
    throw toLive2dAssetLoadError({
      label: 'Failed to load Live2D texture',
      url,
      cause: error,
    });
  }
}

async function loadOfficialCubismRuntime(): Promise<OfficialCubismRuntime> {
  if (officialCubismRuntimePromise) {
    return officialCubismRuntimePromise;
  }

  officialCubismRuntimePromise = (async () => {
    if (!hasLive2dCubismCore()) {
      throw new Error('Live2D Cubism Core is not available in the desktop shell.');
    }

    const [
      frameworkModule,
      modelSettingModule,
      userModelModule,
      motionModule,
      eyeBlinkModule,
      breathModule,
      physicsModule,
      poseModule,
      matrixModule,
      offscreenManagerModule,
      defaultParameterModule,
    ] = await Promise.all([
      import('@framework/live2dcubismframework'),
      import('@framework/cubismmodelsettingjson'),
      import('@framework/model/cubismusermodel'),
      import('@framework/motion/cubismmotion'),
      import('@framework/effect/cubismeyeblink'),
      import('@framework/effect/cubismbreath'),
      import('@framework/physics/cubismphysics'),
      import('@framework/effect/cubismpose'),
      import('@framework/math/cubismmatrix44'),
      import('@framework/rendering/cubismoffscreenmanager'),
      import('@framework/cubismdefaultparameterid'),
    ]);

    const runtime: OfficialCubismRuntime = {
      CubismFramework: frameworkModule.CubismFramework,
      Option: frameworkModule.Option,
      CubismUserModel: userModelModule.CubismUserModel,
      CubismModelSettingJson: modelSettingModule.CubismModelSettingJson,
      CubismMotion: motionModule.CubismMotion,
      CubismEyeBlink: eyeBlinkModule.CubismEyeBlink,
      CubismBreath: breathModule.CubismBreath,
      BreathParameterData: breathModule.BreathParameterData,
      CubismPhysics: physicsModule.CubismPhysics,
      CubismPose: poseModule.CubismPose,
      CubismMatrix44: matrixModule.CubismMatrix44,
      CubismWebGLOffscreenManager: offscreenManagerModule.CubismWebGLOffscreenManager,
      CubismDefaultParameterId: defaultParameterModule.CubismDefaultParameterId,
    };

    if (!runtime.CubismFramework.isStarted()) {
      const option = new runtime.Option();
      option.logFunction = () => undefined;
      option.loggingLevel = 0;
      runtime.CubismFramework.startUp(option);
    }
    if (!runtime.CubismFramework.isInitialized()) {
      runtime.CubismFramework.initialize();
    }

    return runtime;
  })().catch((error: unknown) => {
    officialCubismRuntimePromise = null;
    throw new Error(describeLive2dRuntimeError(error));
  });

  return officialCubismRuntimePromise;
}

function createCubismModelClass(runtime: OfficialCubismRuntime) {
  const { CubismDefaultParameterId, CubismFramework } = runtime;

  return class DesktopCubismModel extends runtime.CubismUserModel {
    public constructor(
      private readonly gl: WebGLRenderingContext | WebGL2RenderingContext,
      private readonly source: ChatAgentAvatarLive2dModelSource,
    ) {
      super();
      this.mouthOpenParameterId = CubismFramework.getIdManager().getId(
        String(CubismDefaultParameterId.ParamMouthOpenY),
      );
      this.breathParameterId = CubismFramework.getIdManager().getId(
        String(CubismDefaultParameterId.ParamBreath),
      );
    }

    public async initialize(width: number, height: number): Promise<void> {
      setGlobalLive2dDebugSnapshot({
        assetLabel: this.source.assetLabel,
        mocVersion: this.source.mocVersion,
        stage: 'initializing',
      });
      this.shaderUrls = await verifyLive2dShaderAssets();
      const modelJsonBytes = await this.loadModelJsonBytes();
      this.modelSetting = new runtime.CubismModelSettingJson(modelJsonBytes, modelJsonBytes.byteLength);

      const mocFileName = this.modelSetting.getModelFileName();
      if (!mocFileName) {
        throw new Error('Live2D model is missing FileReferences.Moc.');
      }

      const mocUrl = this.resolveAssetUrl(mocFileName);
      const mocBytes = await this.loadAssetArrayBuffer(mocUrl);
      this.loadModel(mocBytes, true);
      if (!this.modelRef || !this.getModelMatrix()) {
        throw new Error(`Live2D model failed to initialize from moc: ${mocUrl}`);
      }

      this.modelRef.saveParameters();
      this.setupEyeBlink();
      this.setupBreath();
      await this.loadExpressions();
      await this.loadPhysics();
      await this.loadPose();
      this.readLipSyncIds();

      this.createRenderer(width, height);
      const renderer = this.getRenderer();
      renderer.startUp(this.gl);
      renderer.setIsPremultipliedAlpha(true);

      const textureCount = this.modelSetting.getTextureCount();
      for (let index = 0; index < textureCount; index += 1) {
        const textureFile = this.modelSetting.getTextureFileName(index);
        if (!textureFile) {
          continue;
        }
        const textureUrl = this.resolveAssetUrl(textureFile);
        const texture = await loadLive2dTexture(
          this.gl,
          textureUrl,
          this.lookupRuntimeAssetPayload(textureUrl),
        );
        this.boundTextures.push(texture);
        renderer.bindTexture(index, texture);
      }

      this.resize(width, height);
      this.publishDebugSnapshot({
        stage: 'initialized',
        width,
        height,
      });
    }

    public resize(width: number, height: number): void {
      if (width <= 0 || height <= 0) {
        return;
      }
      this.getRenderer().setRenderTargetSize(width, height);
      this.configureBaseModelMatrix(width, height);
    }

    public renderFrame(input: {
      width: number;
      height: number;
      deltaTimeSeconds: number;
      seconds: number;
      state: ChatAgentAvatarLive2dViewportState;
    }): void {
      if (!this.modelRef) {
        return;
      }

      this.maybeQueuePhaseMotion(input.state.phase);
      this.restoreBaseModelMatrix();

      this.modelRef.loadParameters();
      let motionUpdated = false;
      if (this.motionManagerRef && !this.motionManagerRef.isFinished()) {
        motionUpdated = this.motionManagerRef.updateMotion(this.modelRef, input.deltaTimeSeconds);
      }
      this.modelRef.saveParameters();

      if (!motionUpdated && this.eyeBlinkRef) {
        this.eyeBlinkRef.updateParameters(this.modelRef, input.deltaTimeSeconds);
      }
      if (this.breathRef) {
        this.breathRef.updateParameters(this.modelRef, input.deltaTimeSeconds);
      }
      const motionPose = resolveChatAgentAvatarLive2dRenderMotionPose({
        previousSmoothedAmplitude: this.smoothedAmplitude,
        previousSpeakingEnergy: this.speakingEnergy,
        deltaTimeSeconds: input.deltaTimeSeconds,
        seconds: input.seconds,
        state: input.state,
      });
      this.smoothedAmplitude = motionPose.smoothedAmplitude;
      this.speakingEnergy = motionPose.speakingEnergy;
      if (input.state.phase === 'speaking' || motionPose.speakingEnergy > 0.06) {
        this.applyLipSync(Math.max(motionPose.smoothedAmplitude, motionPose.speakingEnergy * 0.68));
      }
      if (this.physicsRef) {
        this.physicsRef.evaluate(this.modelRef, input.deltaTimeSeconds);
      }
      if (this.poseRef) {
        this.poseRef.updateParameters(this.modelRef, input.deltaTimeSeconds);
      }

      this.modelRef.update();

      this.gl.viewport(0, 0, input.width, input.height);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT | this.gl.STENCIL_BUFFER_BIT);

      const modelMatrix = this.getModelMatrix();
      if (modelMatrix && this.baseModelMatrix) {
        modelMatrix.scaleRelative(motionPose.scale, motionPose.scale);
        modelMatrix.translateRelative(motionPose.swayX, motionPose.swayY);
      }

      const offscreenManager = runtime.CubismWebGLOffscreenManager.getInstance();
      offscreenManager.beginFrameProcess(this.gl);
      try {
        const projectionMatrix = new runtime.CubismMatrix44();
        if (input.width > input.height) {
          projectionMatrix.scale(1, input.width / Math.max(input.height, 1));
        } else {
          projectionMatrix.scale(input.height / Math.max(input.width, 1), 1);
        }
        projectionMatrix.multiplyByMatrix(modelMatrix);

        const renderer = this.getRenderer();
        renderer.setMvpMatrix(projectionMatrix);
        renderer.setRenderState(
          this.gl.getParameter(this.gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
          [0, 0, input.width, input.height],
        );
        renderer.drawModel(resolveLive2dShaderUrl());
        this.publishDebugSnapshot({
          stage: 'rendered',
          width: input.width,
          height: input.height,
          phase: input.state.phase,
          rawAmplitude: input.state.amplitude,
          smoothedAmplitude: motionPose.smoothedAmplitude,
          speakingEnergy: motionPose.speakingEnergy,
          poseScale: motionPose.scale,
          poseSwayX: motionPose.swayX,
          poseSwayY: motionPose.swayY,
          shaderPath: resolveLive2dShaderUrl(),
          projectionMatrix: Array.from(projectionMatrix.getArray()),
          glError: this.gl.getError(),
        });
      } finally {
        offscreenManager.endFrameProcess(this.gl);
        offscreenManager.releaseStaleRenderTextures(this.gl);
      }
    }

    public override release(): void {
      setGlobalLive2dDebugSnapshot(null);
      runtime.CubismWebGLOffscreenManager.getInstance().removeContext(this.gl);
      for (const texture of this.boundTextures) {
        this.gl.deleteTexture(texture);
      }
      this.boundTextures.length = 0;
      this.motionCache.clear();
      this.expressionCache.clear();
      super.release();
    }

    private get modelRef(): CubismModelShape | null {
      return (this as unknown as {
        _model?: CubismModelShape | null;
      })._model ?? null;
    }

    private get motionManagerRef(): {
      isFinished: () => boolean;
      updateMotion: (model: CubismModelShape, deltaTimeSeconds: number) => boolean;
      stopAllMotions: () => void;
      startMotionPriority: (motion: unknown, autoDelete: boolean, priority: number) => number;
    } | null {
      return (this as unknown as {
        _motionManager?: {
          isFinished: () => boolean;
          updateMotion: (model: CubismModelShape, deltaTimeSeconds: number) => boolean;
          stopAllMotions: () => void;
          startMotionPriority: (motion: unknown, autoDelete: boolean, priority: number) => number;
        } | null;
      })._motionManager ?? null;
    }

    private async loadModelJsonBytes(): Promise<ArrayBuffer> {
      if (typeof this.source.runtimeSource === 'string') {
        return this.loadAssetArrayBuffer(this.source.runtimeSource);
      }
      return new TextEncoder().encode(JSON.stringify(this.source.runtimeSource)).buffer;
    }

    private async loadExpressions(): Promise<void> {
      const count = this.modelSetting?.getExpressionCount() ?? 0;
      for (let index = 0; index < count; index += 1) {
        const name = this.modelSetting?.getExpressionName(index);
        const fileName = this.modelSetting?.getExpressionFileName(index);
        if (!name || !fileName) {
          continue;
        }
        const expressionBytes = await this.loadAssetArrayBuffer(this.resolveAssetUrl(fileName));
        const expression = this.loadExpression(expressionBytes, expressionBytes.byteLength, name);
        if (expression) {
          this.expressionCache.set(name, expression);
        }
      }
    }

    private async loadPhysics(): Promise<void> {
      const physicsFile = this.modelSetting?.getPhysicsFileName() ?? '';
      if (!physicsFile) {
        return;
      }
      const physicsBytes = await this.loadAssetArrayBuffer(this.resolveAssetUrl(physicsFile));
      this.physicsRef = runtime.CubismPhysics.create(physicsBytes, physicsBytes.byteLength);
    }

    private async loadPose(): Promise<void> {
      const poseFile = this.modelSetting?.getPoseFileName() ?? '';
      if (!poseFile) {
        return;
      }
      const poseBytes = await this.loadAssetArrayBuffer(this.resolveAssetUrl(poseFile));
      this.poseRef = runtime.CubismPose.create(poseBytes, poseBytes.byteLength);
    }

    private setupEyeBlink(): void {
      if ((this.modelSetting?.getEyeBlinkParameterCount() ?? 0) <= 0) {
        return;
      }
      this.eyeBlinkRef = runtime.CubismEyeBlink.create(this.modelSetting);
    }

    private setupBreath(): void {
      this.breathRef = runtime.CubismBreath.create();
      this.breathRef.setParameters([
        new runtime.BreathParameterData(
          CubismFramework.getIdManager().getId(String(CubismDefaultParameterId.ParamAngleX)),
          0,
          10,
          6.5,
          0.3,
        ),
        new runtime.BreathParameterData(
          CubismFramework.getIdManager().getId(String(CubismDefaultParameterId.ParamAngleY)),
          0,
          6,
          3.5,
          0.3,
        ),
        new runtime.BreathParameterData(
          CubismFramework.getIdManager().getId(String(CubismDefaultParameterId.ParamBodyAngleX)),
          0,
          4,
          15.5,
          0.3,
        ),
        new runtime.BreathParameterData(
          this.breathParameterId,
          0.5,
          0.5,
          3.2,
          0.8,
        ),
      ]);
    }

    private readLipSyncIds(): void {
      const modelSetting = this.modelSetting;
      const lipSyncCount = modelSetting?.getLipSyncParameterCount() ?? 0;
      this.lipSyncIds = [];
      for (let index = 0; index < lipSyncCount; index += 1) {
        if (!modelSetting) {
          break;
        }
        this.lipSyncIds.push(modelSetting.getLipSyncParameterId(index));
      }
    }

    private configureBaseModelMatrix(width: number, height: number): void {
      const modelMatrix = this.getModelMatrix();
      if (!modelMatrix) {
        return;
      }

      modelMatrix.loadIdentity();
      const layout = new Map<string, number>();
      this.modelSetting?.getLayoutMap(layout);
      const framing = resolveChatAgentAvatarLive2dFramingPolicy({
        railWidth: width,
        railHeight: height,
        modelCanvasWidth: this.modelRef?.getCanvasWidth() ?? null,
        modelCanvasHeight: this.modelRef?.getCanvasHeight() ?? null,
        layout,
      });
      if (layout.size > 0) {
        modelMatrix.setupFromLayout(layout);
      }
      if (typeof framing.height === 'number') {
        modelMatrix.setHeight(framing.height);
      } else if (layout.size === 0) {
        modelMatrix.setHeight(2);
      }
      if (typeof framing.width === 'number') {
        modelMatrix.setWidth(framing.width);
      }
      if (typeof framing.centerX === 'number' || typeof framing.centerY === 'number') {
        modelMatrix.translateRelative(
          framing.centerX ?? 0,
          framing.centerY ?? 0,
        );
      }
      this.baseModelMatrix = new Float32Array(modelMatrix.getArray());
      this.framingSnapshot = {
        framingMode: framing.mode,
        framingHeight: framing.height ?? null,
        framingWidth: framing.width ?? null,
        framingCenterX: framing.centerX ?? null,
        framingCenterY: framing.centerY ?? null,
      };
      this.publishDebugSnapshot(this.framingSnapshot);
    }

    private restoreBaseModelMatrix(): void {
      const modelMatrix = this.getModelMatrix();
      if (!modelMatrix || !this.baseModelMatrix) {
        return;
      }
      modelMatrix.setMatrix(this.baseModelMatrix);
    }

    private maybeQueuePhaseMotion(phase: ChatAgentAvatarLive2dViewportState['phase']): void {
      const motionSelection = resolveChatAgentAvatarLive2dMotionSelection({
        phase,
        idleMotionGroup: this.source.idleMotionGroup,
        speechMotionGroup: this.source.speechMotionGroup,
        motionGroups: this.source.motionGroups,
      });
      this.lastMotionSelectionSource = motionSelection.source;
      if (!motionSelection.group) {
        this.activeMotionToken = null;
        this.activeMotionGroup = null;
        return;
      }

      const nextToken = `${phase}:${motionSelection.group}`;
      if (this.activeMotionToken === nextToken || this.pendingMotionToken === nextToken) {
        return;
      }

      this.pendingMotionToken = nextToken;
      void this.playMotionGroup(motionSelection.group, motionSelection.priority)
        .then((played) => {
          if (this.pendingMotionToken !== nextToken) {
            return;
          }
          this.pendingMotionToken = null;
          this.activeMotionToken = played ? nextToken : null;
          this.activeMotionGroup = played ? motionSelection.group : null;
        })
        .catch(() => {
          if (this.pendingMotionToken === nextToken) {
            this.pendingMotionToken = null;
            this.activeMotionToken = null;
            this.activeMotionGroup = null;
          }
        });
    }

    private async playMotionGroup(group: string, priority: number): Promise<boolean> {
      const motionCount = this.modelSetting?.getMotionCount(group) ?? 0;
      if (motionCount <= 0) {
        return false;
      }

      const motion = await this.loadMotionGroupEntry(group, 0);
      if (!motion || !this.motionManagerRef) {
        return false;
      }

      this.motionManagerRef.stopAllMotions();
      return this.motionManagerRef.startMotionPriority(motion, false, priority) >= 0;
    }

    private async loadMotionGroupEntry(group: string, index: number): Promise<unknown | null> {
      const cacheKey = `${group}:${index}`;
      if (this.motionCache.has(cacheKey)) {
        return this.motionCache.get(cacheKey) ?? null;
      }

      const motionFile = this.modelSetting?.getMotionFileName(group, index) ?? '';
      if (!motionFile) {
        return null;
      }

      const motionBytes = await this.loadAssetArrayBuffer(this.resolveAssetUrl(motionFile));
      const motion = runtime.CubismMotion.create(motionBytes, motionBytes.byteLength);
      if (!motion) {
        return null;
      }

      const fadeIn = this.modelSetting?.getMotionFadeInTimeValue(group, index) ?? -1;
      if (fadeIn >= 0) {
        motion.setFadeInTime(fadeIn);
      }
      const fadeOut = this.modelSetting?.getMotionFadeOutTimeValue(group, index) ?? -1;
      if (fadeOut >= 0) {
        motion.setFadeOutTime(fadeOut);
      }
      motion.setEffectIds([], this.lipSyncIds);
      this.motionCache.set(cacheKey, motion);
      return motion;
    }

    private applyLipSync(amplitude: number): void {
      if (!this.modelRef) {
        return;
      }
      const clamped = Math.max(0, Math.min(amplitude, 1));
      if (this.lipSyncIds.length > 0) {
        for (const lipSyncId of this.lipSyncIds) {
          this.modelRef.setParameterValueById(lipSyncId, clamped, 0.85);
        }
        return;
      }
      this.modelRef.setParameterValueById(this.mouthOpenParameterId, clamped, 0.85);
    }

    private resolveAssetUrl(value: string): string {
      return resolveLive2dAssetUrl(this.source.modelUrl, value);
    }

    private publishDebugSnapshot(extra: Record<string, unknown>): void {
      const model = this.modelRef;
      const modelMatrix = this.getModelMatrix();
      const renderer = this.getRenderer();
      const drawableCount = model?.getDrawableCount?.() ?? 0;
      let visibleDrawableCount = 0;
      let nonZeroOpacityDrawableCount = 0;
      let totalVertexCount = 0;

      for (let index = 0; index < drawableCount; index += 1) {
        if (model?.getDrawableDynamicFlagIsVisible(index)) {
          visibleDrawableCount += 1;
        }
        if ((model?.getDrawableOpacity(index) ?? 0) > 0.001) {
          nonZeroOpacityDrawableCount += 1;
        }
        totalVertexCount += model?.getDrawableVertexCount(index) ?? 0;
      }

      setGlobalLive2dDebugSnapshot({
        assetLabel: this.source.assetLabel,
        mocVersion: this.source.mocVersion,
        idleMotionGroup: this.source.idleMotionGroup,
        speechMotionGroup: this.source.speechMotionGroup,
        motionGroups: this.source.motionGroups,
        activeMotionGroup: this.activeMotionGroup,
        motionSelectionSource: this.lastMotionSelectionSource,
        shaderUrls: this.shaderUrls,
        textureBindings: renderer.getBindedTextures().size,
        drawableCount,
        visibleDrawableCount,
        nonZeroOpacityDrawableCount,
        totalVertexCount,
        canvasWidth: model?.getCanvasWidth?.() ?? null,
        canvasHeight: model?.getCanvasHeight?.() ?? null,
        pixelsPerUnit: model?.getPixelsPerUnit?.() ?? null,
        modelMatrix: modelMatrix ? Array.from(modelMatrix.getArray()) : null,
        ...this.framingSnapshot,
        ...extra,
      });
    }

    private lookupRuntimeAssetPayload(url: string): { mimeType: string; base64: string } | null {
      return this.source.runtimeAssetPayloads?.[url] || null;
    }

    private async loadAssetArrayBuffer(url: string): Promise<ArrayBuffer> {
      const payload = this.lookupRuntimeAssetPayload(url);
      if (payload) {
        return arrayBufferFromBase64(payload.base64);
      }
      return fetchArrayBufferFromUrl(url);
    }

    private modelSetting: CubismModelSettingShape | null = null;
    private readonly boundTextures: WebGLTexture[] = [];
    private readonly motionCache = new Map<string, unknown>();
    private readonly expressionCache = new Map<string, unknown>();
    private framingSnapshot: Record<string, unknown> = {};
    private shaderUrls: readonly string[] = [];
    private eyeBlinkRef: {
      updateParameters: (model: CubismModelShape, deltaTimeSeconds: number) => void;
    } | null = null;
    private breathRef: {
      setParameters: (params: unknown[]) => void;
      updateParameters: (model: CubismModelShape, deltaTimeSeconds: number) => void;
    } | null = null;
    private physicsRef: {
      evaluate: (model: CubismModelShape, deltaTimeSeconds: number) => void;
    } | null = null;
    private poseRef: {
      updateParameters: (model: CubismModelShape, deltaTimeSeconds: number) => void;
    } | null = null;
    private lipSyncIds: unknown[] = [];
    private readonly mouthOpenParameterId: unknown;
    private readonly breathParameterId: unknown;
    private baseModelMatrix: Float32Array | null = null;
    private activeMotionToken: string | null = null;
    private pendingMotionToken: string | null = null;
    private activeMotionGroup: string | null = null;
    private lastMotionSelectionSource: ChatAgentAvatarLive2dMotionSelection['source'] = 'ambient-only';
    private smoothedAmplitude = 0;
    private speakingEnergy = 0;
  };
}

export async function createOfficialLive2dCubismModel(input: {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  source: ChatAgentAvatarLive2dModelSource;
  width: number;
  height: number;
}): Promise<CubismModelHandle> {
  const runtime = await loadOfficialCubismRuntime();
  const DesktopCubismModel = createCubismModelClass(runtime);
  const model = new DesktopCubismModel(input.gl, input.source);
  await model.initialize(input.width, input.height);
  return model;
}
