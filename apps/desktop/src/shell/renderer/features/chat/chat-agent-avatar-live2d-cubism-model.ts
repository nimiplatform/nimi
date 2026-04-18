import type { ChatAgentAvatarLive2dModelSource, ChatAgentAvatarLive2dViewportState } from './chat-agent-avatar-live2d-viewport-state';
import { resolveChatAgentAvatarLive2dFramingPolicy, type ChatAgentAvatarLive2dFramingIntent } from './chat-agent-avatar-live2d-framing';
import {
  resolveAvatarLive2dMotionSelection,
  resolveAvatarLive2dRenderMotionPose,
  type AvatarLive2dMotionSelection,
} from '@nimiplatform/nimi-kit/features/avatar/live2d';
import type {
  CubismModelHandle,
  CubismModelSettingShape,
  CubismModelShape,
  OfficialCubismRuntime,
} from './chat-agent-avatar-live2d-cubism-runtime-types';
import {
  arrayBufferFromBase64,
  fetchArrayBufferFromUrl,
  loadLive2dTexture,
  resolveLive2dAssetUrl,
  resolveLive2dShaderUrl,
  verifyLive2dShaderAssets,
} from './chat-agent-avatar-live2d-cubism-runtime-assets';

const resolveChatAgentAvatarLive2dMotionSelection = resolveAvatarLive2dMotionSelection;
const resolveChatAgentAvatarLive2dRenderMotionPose = resolveAvatarLive2dRenderMotionPose;

function createCubismModelClass(
  runtime: OfficialCubismRuntime,
  setGlobalLive2dDebugSnapshot: (snapshot: Record<string, unknown> | null) => void,
) {
  const { CubismDefaultParameterId, CubismFramework } = runtime;

  return class DesktopCubismModel extends runtime.CubismUserModel {
    public constructor(
      private readonly gl: WebGLRenderingContext | WebGL2RenderingContext,
      private readonly source: ChatAgentAvatarLive2dModelSource,
      private readonly verticalOffsetY: number,
      private readonly framingIntent: ChatAgentAvatarLive2dFramingIntent,
    ) {
      super();
      this.mouthOpenParameterId = CubismFramework.getIdManager().getId(String(CubismDefaultParameterId.ParamMouthOpenY));
      this.breathParameterId = CubismFramework.getIdManager().getId(String(CubismDefaultParameterId.ParamBreath));
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
        if (!textureFile) continue;
        const textureUrl = this.resolveAssetUrl(textureFile);
        const texture = await loadLive2dTexture(this.gl, textureUrl, this.lookupRuntimeAssetPayload(textureUrl));
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
        renderer.setRenderState(this.gl.getParameter(this.gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, [0, 0, input.width, input.height]);
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
      return (this as { _model?: CubismModelShape | null })._model ?? null;
    }

    private get motionManagerRef(): {
      isFinished: () => boolean;
      updateMotion: (model: CubismModelShape, deltaTimeSeconds: number) => boolean;
      stopAllMotions: () => void;
      startMotionPriority: (motion: unknown, autoDelete: boolean, priority: number) => number;
    } | null {
      return (this as {
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
        if (!name || !fileName) continue;
        const expressionBytes = await this.loadAssetArrayBuffer(this.resolveAssetUrl(fileName));
        const expression = this.loadExpression(expressionBytes, expressionBytes.byteLength, name);
        if (expression) {
          this.expressionCache.set(name, expression);
        }
      }
    }

    private async loadPhysics(): Promise<void> {
      const physicsFile = this.modelSetting?.getPhysicsFileName() ?? '';
      if (!physicsFile) return;
      const physicsBytes = await this.loadAssetArrayBuffer(this.resolveAssetUrl(physicsFile));
      this.physicsRef = runtime.CubismPhysics.create(physicsBytes, physicsBytes.byteLength);
    }

    private async loadPose(): Promise<void> {
      const poseFile = this.modelSetting?.getPoseFileName() ?? '';
      if (!poseFile) return;
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
        new runtime.BreathParameterData(CubismFramework.getIdManager().getId(String(runtime.CubismDefaultParameterId.ParamAngleX)), 0, 10, 6.5, 0.3),
        new runtime.BreathParameterData(CubismFramework.getIdManager().getId(String(runtime.CubismDefaultParameterId.ParamAngleY)), 0, 6, 3.5, 0.3),
        new runtime.BreathParameterData(CubismFramework.getIdManager().getId(String(runtime.CubismDefaultParameterId.ParamBodyAngleX)), 0, 4, 15.5, 0.3),
        new runtime.BreathParameterData(this.breathParameterId, 0.5, 0.5, 3.2, 0.8),
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
        intent: this.framingIntent,
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
      if (typeof framing.centerX === 'number' || typeof framing.centerY === 'number' || this.verticalOffsetY !== 0) {
        modelMatrix.translateRelative(framing.centerX ?? 0, (framing.centerY ?? 0) + this.verticalOffsetY);
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
      if (fadeIn >= 0) motion.setFadeInTime(fadeIn);
      const fadeOut = this.modelSetting?.getMotionFadeOutTimeValue(group, index) ?? -1;
      if (fadeOut >= 0) motion.setFadeOutTime(fadeOut);
      motion.setEffectIds([], this.lipSyncIds);
      this.motionCache.set(cacheKey, motion);
      return motion;
    }

    private applyLipSync(amplitude: number): void {
      if (!this.modelRef) return;
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
    private eyeBlinkRef: { updateParameters: (model: CubismModelShape, deltaTimeSeconds: number) => void } | null = null;
    private breathRef: { setParameters: (params: unknown[]) => void; updateParameters: (model: CubismModelShape, deltaTimeSeconds: number) => void } | null = null;
    private physicsRef: { evaluate: (model: CubismModelShape, deltaTimeSeconds: number) => void } | null = null;
    private poseRef: { updateParameters: (model: CubismModelShape, deltaTimeSeconds: number) => void } | null = null;
    private lipSyncIds: unknown[] = [];
    private readonly mouthOpenParameterId: unknown;
    private readonly breathParameterId: unknown;
    private baseModelMatrix: Float32Array | null = null;
    private activeMotionToken: string | null = null;
    private pendingMotionToken: string | null = null;
    private activeMotionGroup: string | null = null;
    private lastMotionSelectionSource: AvatarLive2dMotionSelection['source'] = 'ambient-only';
    private smoothedAmplitude = 0;
    private speakingEnergy = 0;
  };
}

export async function createOfficialLive2dCubismModelImpl(input: {
  runtime: OfficialCubismRuntime;
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  source: ChatAgentAvatarLive2dModelSource;
  width: number;
  height: number;
  verticalOffsetY?: number;
  framingIntent?: ChatAgentAvatarLive2dFramingIntent;
  setGlobalLive2dDebugSnapshot: (snapshot: Record<string, unknown> | null) => void;
}): Promise<CubismModelHandle> {
  const DesktopCubismModel = createCubismModelClass(input.runtime, input.setGlobalLive2dDebugSnapshot);
  const model = new DesktopCubismModel(
    input.gl,
    input.source,
    input.verticalOffsetY ?? 0,
    input.framingIntent ?? 'auto',
  );
  await model.initialize(input.width, input.height);
  return model;
}
