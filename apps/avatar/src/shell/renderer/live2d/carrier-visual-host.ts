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

export type Live2DCarrierVisualFrameStats = {
  width: number;
  height: number;
  sampledPixels: number;
  visiblePixels: number;
  sampledPixelChecksum: number;
  drawableCount: number;
  visibleDrawableCount: number;
  nonZeroOpacityDrawableCount: number;
  textureBindingCount: number;
};

export type Live2DCarrierVisualHost = {
  readonly canvas: HTMLCanvasElement;
  renderFrame(input?: {
    deltaTimeSeconds?: number;
    seconds?: number;
  }): Live2DCarrierVisualFrameStats;
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
  renderFrame(input: {
    width: number;
    height: number;
    deltaTimeSeconds: number;
    seconds: number;
  }): Live2DCarrierVisualFrameStats;
  resize(width: number, height: number): void;
  release(): void;
};

function createModelJsonBuffer(session: Live2DBackendSession): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(session.settings)).buffer;
}

function getModelRef(model: unknown): Live2DVisualModelShape | null {
  return (model as { _model?: Live2DVisualModelShape | null })._model ?? null;
}

function sampleVisiblePixels(input: {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  width: number;
  height: number;
}): Pick<Live2DCarrierVisualFrameStats, 'sampledPixels' | 'visiblePixels' | 'sampledPixelChecksum'> {
  const grid = 4;
  const pixel = new Uint8Array(4);
  let sampledPixels = 0;
  let visiblePixels = 0;
  let sampledPixelChecksum = 0;
  for (let yIndex = 0; yIndex < grid; yIndex += 1) {
    for (let xIndex = 0; xIndex < grid; xIndex += 1) {
      const x = Math.max(0, Math.min(input.width - 1, Math.round(((xIndex + 0.5) / grid) * input.width)));
      const y = Math.max(0, Math.min(input.height - 1, Math.round(((yIndex + 0.5) / grid) * input.height)));
      input.gl.readPixels(x, y, 1, 1, input.gl.RGBA, input.gl.UNSIGNED_BYTE, pixel);
      sampledPixels += 1;
      const red = pixel[0] ?? 0;
      const green = pixel[1] ?? 0;
      const blue = pixel[2] ?? 0;
      const alpha = pixel[3] ?? 0;
      if (alpha > 0 || red > 0 || green > 0 || blue > 0) {
        visiblePixels += 1;
      }
      sampledPixelChecksum = (sampledPixelChecksum + ((red * 3) + (green * 5) + (blue * 7) + (alpha * 11)) * sampledPixels) >>> 0;
    }
  }
  return { sampledPixels, visiblePixels, sampledPixelChecksum };
}

export function assertLive2DCarrierVisualFrame(stats: Live2DCarrierVisualFrameStats): void {
  if (stats.width <= 0 || stats.height <= 0) {
    throw new Error('Live2D carrier visual frame has no renderable size');
  }
  if (stats.drawableCount <= 0 || stats.visibleDrawableCount <= 0 || stats.nonZeroOpacityDrawableCount <= 0) {
    throw new Error('Live2D carrier visual frame has no visible Cubism drawables');
  }
  if (stats.textureBindingCount <= 0) {
    throw new Error('Live2D carrier visual frame has no bound model textures');
  }
  if (stats.sampledPixels <= 0 || stats.visiblePixels <= 0) {
    throw new Error('Live2D carrier visual frame produced no visible pixels');
  }
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
    private breath: {
      setParameters: (params: unknown[]) => void;
      updateParameters: (model: Live2DVisualModelShape, deltaTimeSeconds: number) => void;
    } | null = null;

    public async initialize(width: number, height: number): Promise<void> {
      const modelJsonBytes = createModelJsonBuffer(input.session);
      this.modelSetting = new runtime.CubismModelSettingJson(modelJsonBytes, modelJsonBytes.byteLength);
      const mocBytes = await input.readBinary(input.session.resources.mocPath);
      this.loadModel(mocBytes, true);
      if (!getModelRef(this) || !this.getModelMatrix()) {
        throw new Error(`Live2D carrier visual failed to initialize model: ${input.session.resources.mocPath}`);
      }
      this.setupBreath();
      await this.loadExpressions();
      await this.loadPhysics();
      await this.loadPose();
      this.createRenderer(width, height);
      const renderer = this.getRenderer();
      renderer.startUp(input.gl);
      renderer.setIsPremultipliedAlpha(true);
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
      if (layout.size > 0) {
        modelMatrix.setupFromLayout(layout);
      } else {
        modelMatrix.setHeight(2);
      }
      this.baseModelMatrix = new Float32Array(modelMatrix.getArray());
    }

    public renderFrame(inputFrame: {
      width: number;
      height: number;
      deltaTimeSeconds: number;
      seconds: number;
    }): Live2DCarrierVisualFrameStats {
      const model = getModelRef(this);
      const modelMatrix = this.getModelMatrix();
      if (!model || !modelMatrix) {
        throw new Error('Live2D carrier visual model is not initialized');
      }
      if (this.baseModelMatrix) {
        modelMatrix.setMatrix(this.baseModelMatrix);
      }
      model.loadParameters();
      for (const [parameterId, value] of input.session.execution.parameters) {
        model.setParameterValueById(parameterId, value);
      }
      this.breath?.updateParameters(model, inputFrame.deltaTimeSeconds);
      model.saveParameters();
      model.update();

      input.gl.viewport(0, 0, inputFrame.width, inputFrame.height);
      input.gl.clearColor(0, 0, 0, 0);
      input.gl.clear(input.gl.COLOR_BUFFER_BIT | input.gl.DEPTH_BUFFER_BIT | input.gl.STENCIL_BUFFER_BIT);

      const projectionMatrix = new runtime.CubismMatrix44();
      if (inputFrame.width > inputFrame.height) {
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
        renderer.setRenderState(input.gl.getParameter(input.gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, [
          0,
          0,
          inputFrame.width,
          inputFrame.height,
        ]);
        renderer.drawModel(resolveLive2DShaderRootUrl());
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
      const pixelStats = sampleVisiblePixels({
        gl: input.gl,
        width: inputFrame.width,
        height: inputFrame.height,
      });
      return {
        width: inputFrame.width,
        height: inputFrame.height,
        ...pixelStats,
        drawableCount,
        visibleDrawableCount,
        nonZeroOpacityDrawableCount,
        textureBindingCount: this.getRenderer().getBindedTextures().size,
      };
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
        this.loadExpression(bytes, bytes.byteLength, name);
      }
    }

    private async loadPhysics(): Promise<void> {
      if (!input.session.resources.physicsPath) {
        return;
      }
      const bytes = await input.readBinary(input.session.resources.physicsPath);
      runtime.CubismPhysics.create(bytes, bytes.byteLength);
    }

    private async loadPose(): Promise<void> {
      if (!input.session.resources.posePath) {
        return;
      }
      const bytes = await input.readBinary(input.session.resources.posePath);
      runtime.CubismPose.create(bytes, bytes.byteLength);
    }

    private setupBreath(): void {
      this.breath = runtime.CubismBreath.create();
      this.breath.setParameters([
        new runtime.BreathParameterData(CubismFramework.getIdManager().getId(String(runtime.CubismDefaultParameterId.ParamAngleX)), 0, 10, 6.5, 0.3),
        new runtime.BreathParameterData(CubismFramework.getIdManager().getId(String(runtime.CubismDefaultParameterId.ParamAngleY)), 0, 6, 3.5, 0.3),
        new runtime.BreathParameterData(CubismFramework.getIdManager().getId(String(runtime.CubismDefaultParameterId.ParamBodyAngleX)), 0, 4, 15.5, 0.3),
      ]);
    }
  }

  const model = new AvatarCarrierCubismModel();
  await model.initialize(input.width, input.height);
  return model;
}

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
    preserveDrawingBuffer: true,
  }) || input.canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
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
    renderFrame(frameInput = {}) {
      const stats = model.renderFrame({
        width: input.canvas.width,
        height: input.canvas.height,
        deltaTimeSeconds: frameInput.deltaTimeSeconds ?? 1 / 60,
        seconds: frameInput.seconds ?? performance.now() / 1000,
      });
      assertLive2DCarrierVisualFrame(stats);
      return stats;
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
