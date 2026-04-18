import type { ChatAgentAvatarLive2dViewportState } from './chat-agent-avatar-live2d-viewport-state';

export type OfficialCubismRuntime = {
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

export type CubismModelSettingShape = InstanceType<OfficialCubismRuntime['CubismModelSettingJson']>;

export type CubismModelShape = {
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

export type CubismModelHandle = {
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
