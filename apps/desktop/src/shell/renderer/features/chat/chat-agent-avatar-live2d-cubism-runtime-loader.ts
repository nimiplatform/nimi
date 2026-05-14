import {
  describeLive2dRuntimeError,
} from './chat-agent-avatar-live2d-cubism-runtime-assets';
import type {
  OfficialCubismRuntime,
} from './chat-agent-avatar-live2d-cubism-runtime-types';

const LIVE2D_CUBISM_CORE_SCRIPT_PATH = 'assets/js/live2d-cubism-core/Core/live2dcubismcore.min.js';
const LIVE2D_CUBISM_CORE_SCRIPT_ID = 'nimi-live2d-cubism-core-runtime';

let live2dCubismCoreScriptPromise: Promise<void> | null = null;

export function hasLive2dCubismCore(): boolean {
  return Boolean((globalThis as typeof globalThis & { Live2DCubismCore?: unknown }).Live2DCubismCore);
}

export function resolveLive2dCubismCoreScriptUrl(): string {
  return new URL(LIVE2D_CUBISM_CORE_SCRIPT_PATH, globalThis.location.href).toString();
}

export async function ensureLive2dCubismCoreLoaded(): Promise<void> {
  if (hasLive2dCubismCore()) {
    return;
  }
  if (live2dCubismCoreScriptPromise) {
    return live2dCubismCoreScriptPromise;
  }

  live2dCubismCoreScriptPromise = new Promise<void>((resolve, reject) => {
    const documentRef = globalThis.document;
    if (!documentRef?.head) {
      reject(new Error('Live2D Cubism Core cannot load without a browser document head.'));
      return;
    }

    const scriptUrl = resolveLive2dCubismCoreScriptUrl();
    const fail = (message: string) => {
      reject(new Error(`${message}: ${scriptUrl}`));
    };
    const resolveAfterCoreCheck = () => {
      if (hasLive2dCubismCore()) {
        resolve();
        return;
      }
      fail('Live2D Cubism Core script loaded without publishing Live2DCubismCore');
    };

    const existingScript = documentRef.getElementById(LIVE2D_CUBISM_CORE_SCRIPT_ID);
    if (existingScript) {
      if (hasLive2dCubismCore()) {
        resolve();
        return;
      }
      if (existingScript.dataset.nimiLoadState === 'error') {
        fail('Live2D Cubism Core script previously failed to load');
        return;
      }
      if (existingScript.dataset.nimiLoadState === 'loaded') {
        fail('Live2D Cubism Core script is loaded but unavailable');
        return;
      }
      existingScript.addEventListener('load', resolveAfterCoreCheck, { once: true });
      existingScript.addEventListener('error', () => {
        existingScript.remove();
        fail('Live2D Cubism Core script failed to load');
      }, { once: true });
      return;
    }

    const script = documentRef.createElement('script');
    script.id = LIVE2D_CUBISM_CORE_SCRIPT_ID;
    script.src = scriptUrl;
    script.async = true;
    script.dataset.nimiLoadState = 'loading';
    script.addEventListener('load', () => {
      script.dataset.nimiLoadState = 'loaded';
      resolveAfterCoreCheck();
    }, { once: true });
    script.addEventListener('error', () => {
      script.dataset.nimiLoadState = 'error';
      script.remove();
      fail('Live2D Cubism Core script failed to load');
    }, { once: true });
    documentRef.head.append(script);
  }).catch((error: unknown) => {
    live2dCubismCoreScriptPromise = null;
    throw error;
  });

  return live2dCubismCoreScriptPromise;
}

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
