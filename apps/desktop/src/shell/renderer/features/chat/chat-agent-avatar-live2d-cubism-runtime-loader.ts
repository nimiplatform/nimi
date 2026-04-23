import {
  describeLive2dRuntimeError,
} from './chat-agent-avatar-live2d-cubism-runtime-assets';
import type {
  OfficialCubismRuntime,
} from './chat-agent-avatar-live2d-cubism-runtime-types';

export async function loadOfficialCubismRuntimeModules(): Promise<OfficialCubismRuntime> {
  try {
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

    return {
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
  } catch (error: unknown) {
    throw new Error(describeLive2dRuntimeError(error), {
      cause: error,
    });
  }
}
