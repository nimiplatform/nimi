import type { OfficialCubismFrameworkRuntime } from './cubism-framework-runtime.js';

export type Live2DVisualRuntime = OfficialCubismFrameworkRuntime & {
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
      setMatrix: (value: Float32Array) => void;
      getArray: () => Float32Array;
      setupFromLayout: (layout: Map<string, number>) => void;
      scaleRelative: (x: number, y: number) => void;
      translateRelative: (x: number, y: number) => void;
    } | null;
    release(): void;
  };
  CubismEyeBlink: {
    create: (setting?: unknown) => {
      updateParameters: (model: Live2DVisualModelShape, deltaTimeSeconds: number) => void;
    } | null;
  };
  CubismBreath: {
    create: () => {
      setParameters: (params: unknown[]) => void;
      updateParameters: (model: Live2DVisualModelShape, deltaTimeSeconds: number) => void;
    };
  };
  BreathParameterData: new (
    parameterId: unknown,
    offset: number,
    peak: number,
    cycle: number,
    weight: number,
  ) => unknown;
  CubismMatrix44: new () => {
    getArray: () => Float32Array;
    scale: (x: number, y: number) => void;
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

export type Live2DVisualModelShape = {
  loadParameters: () => void;
  saveParameters: () => void;
  update: () => void;
  setParameterValueById: (parameterId: unknown, value: number, weight?: number) => void;
  getCanvasWidth: () => number;
  getCanvasHeight: () => number;
  getDrawableCount: () => number;
  getDrawableOpacity: (drawableIndex: number) => number;
  getDrawableDynamicFlagIsVisible: (drawableIndex: number) => boolean;
  getDrawableVertexCount: (drawableIndex: number) => number;
};

let live2DVisualRuntimePromise: Promise<Live2DVisualRuntime> | null = null;

function hasLive2DCubismCore(): boolean {
  return Boolean((globalThis as typeof globalThis & { Live2DCubismCore?: unknown }).Live2DCubismCore);
}

async function importLive2DVisualRuntime(): Promise<Live2DVisualRuntime> {
  const [
    frameworkModule,
    modelSettingModule,
    userModelModule,
    motionModule,
    expressionMotionModule,
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
    import('@framework/motion/cubismexpressionmotion'),
    import('@framework/effect/cubismeyeblink'),
    import('@framework/effect/cubismbreath'),
    import('@framework/physics/cubismphysics'),
    import('@framework/effect/cubismpose'),
    import('@framework/math/cubismmatrix44'),
    import('@framework/rendering/cubismoffscreenmanager'),
    import('@framework/cubismdefaultparameterid'),
  ]);

  return {
    CubismFramework: frameworkModule.CubismFramework,
    Option: frameworkModule.Option,
    CubismModelSettingJson: modelSettingModule.CubismModelSettingJson,
    CubismUserModel: userModelModule.CubismUserModel,
    CubismMotion: motionModule.CubismMotion,
    CubismExpressionMotion: expressionMotionModule.CubismExpressionMotion,
    CubismEyeBlink: eyeBlinkModule.CubismEyeBlink,
    CubismBreath: breathModule.CubismBreath,
    BreathParameterData: breathModule.BreathParameterData,
    CubismPhysics: physicsModule.CubismPhysics,
    CubismPose: poseModule.CubismPose,
    CubismMatrix44: matrixModule.CubismMatrix44,
    CubismWebGLOffscreenManager: offscreenManagerModule.CubismWebGLOffscreenManager,
    CubismDefaultParameterId: defaultParameterModule.CubismDefaultParameterId,
  } as Live2DVisualRuntime;
}

export async function loadLive2DVisualRuntime(): Promise<Live2DVisualRuntime> {
  if (live2DVisualRuntimePromise) {
    return live2DVisualRuntimePromise;
  }
  live2DVisualRuntimePromise = (async () => {
    if (!hasLive2DCubismCore()) {
      throw new Error('Live2D Cubism Core is not available in the Avatar shell.');
    }
    const runtime = await importLive2DVisualRuntime();
    if (!runtime.CubismFramework.isStarted()) {
      const option = new runtime.Option();
      option.logFunction = () => undefined;
      option.loggingLevel = 0;
      if (!runtime.CubismFramework.startUp(option)) {
        throw new Error('CubismFramework.startUp returned false');
      }
    }
    if (!runtime.CubismFramework.isInitialized()) {
      runtime.CubismFramework.initialize();
    }
    return runtime;
  })().catch((error: unknown) => {
    live2DVisualRuntimePromise = null;
    throw new Error(`Live2D visual runtime failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
  });
  return live2DVisualRuntimePromise;
}
