import type {
  ChatAgentAvatarLive2dModelSource,
} from './chat-agent-avatar-live2d-viewport-state';
import {
  resolveAvatarLive2dMotionSelection,
  resolveAvatarLive2dRenderMotionPose,
  type AvatarLive2dMotionSelection,
  type AvatarLive2dRenderMotionPose,
} from '@nimiplatform/nimi-kit/features/avatar/live2d';
import type { ChatAgentAvatarLive2dFramingIntent } from './chat-agent-avatar-live2d-framing';
import { createOfficialLive2dCubismModelImpl } from './chat-agent-avatar-live2d-cubism-model';
import {
  describeLive2dRuntimeError,
} from './chat-agent-avatar-live2d-cubism-runtime-assets';
import type {
  CubismModelHandle,
  OfficialCubismRuntime,
} from './chat-agent-avatar-live2d-cubism-runtime-types';

export type ChatAgentAvatarLive2dMotionSelection = AvatarLive2dMotionSelection;

export type ChatAgentAvatarLive2dRenderMotionPose = AvatarLive2dRenderMotionPose;

let officialCubismRuntimePromise: Promise<OfficialCubismRuntime> | null = null;

export const resolveChatAgentAvatarLive2dMotionSelection = resolveAvatarLive2dMotionSelection;

export const resolveChatAgentAvatarLive2dRenderMotionPose = resolveAvatarLive2dRenderMotionPose;

function setGlobalLive2dDebugSnapshot(snapshot: Record<string, unknown> | null): void {
  (globalThis as typeof globalThis & {
    __NIMI_LIVE2D_DEBUG__?: Record<string, unknown> | null;
  }).__NIMI_LIVE2D_DEBUG__ = snapshot;
}

function hasLive2dCubismCore(): boolean {
  return Boolean((globalThis as typeof globalThis & { Live2DCubismCore?: unknown }).Live2DCubismCore);
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

export async function createOfficialLive2dCubismModel(input: {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  source: ChatAgentAvatarLive2dModelSource;
  width: number;
  height: number;
  verticalOffsetY?: number;
  framingIntent?: ChatAgentAvatarLive2dFramingIntent;
}): Promise<CubismModelHandle> {
  const runtime = await loadOfficialCubismRuntime();
  return createOfficialLive2dCubismModelImpl({
    runtime,
    ...input,
    setGlobalLive2dDebugSnapshot,
  });
}
