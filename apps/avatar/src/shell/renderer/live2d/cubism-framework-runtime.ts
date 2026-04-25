export type OfficialCubismFrameworkRuntime = {
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
  CubismModelSettingJson: new (buffer: ArrayBuffer, size: number) => {
    getModelFileName: () => string;
    getTextureCount: () => number;
    getTextureFileName: (index: number) => string;
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
    getLipSyncParameterCount: () => number;
  };
  CubismMotion: {
    create: (buffer: ArrayBuffer, size: number) => {
      setFadeInTime: (value: number) => void;
      setFadeOutTime: (value: number) => void;
      setEffectIds: (eyeBlinkIds: unknown[], lipSyncIds: unknown[]) => void;
    } | null;
  };
  CubismExpressionMotion: {
    create: (buffer: ArrayBuffer, size: number) => unknown | null;
  };
  CubismPhysics: {
    create: (buffer: ArrayBuffer, size: number) => {
      evaluate: (model: unknown, deltaTimeSeconds: number) => void;
    } | null;
  };
  CubismPose: {
    create: (buffer: ArrayBuffer, size: number) => {
      updateParameters: (model: unknown, deltaTimeSeconds: number) => void;
    } | null;
  };
};

let officialCubismFrameworkRuntimePromise: Promise<OfficialCubismFrameworkRuntime> | null = null;

async function importOfficialCubismFrameworkRuntime(): Promise<OfficialCubismFrameworkRuntime> {
  const [
    frameworkModule,
    modelSettingModule,
    motionModule,
    expressionMotionModule,
    physicsModule,
    poseModule,
  ] = await Promise.all([
    import('@framework/live2dcubismframework'),
    import('@framework/cubismmodelsettingjson'),
    import('@framework/motion/cubismmotion'),
    import('@framework/motion/cubismexpressionmotion'),
    import('@framework/physics/cubismphysics'),
    import('@framework/effect/cubismpose'),
  ]);

  return {
    CubismFramework: frameworkModule.CubismFramework,
    Option: frameworkModule.Option,
    CubismModelSettingJson: modelSettingModule.CubismModelSettingJson,
    CubismMotion: motionModule.CubismMotion,
    CubismExpressionMotion: expressionMotionModule.CubismExpressionMotion,
    CubismPhysics: physicsModule.CubismPhysics,
    CubismPose: poseModule.CubismPose,
  } as OfficialCubismFrameworkRuntime;
}

export async function loadOfficialCubismFrameworkRuntime(): Promise<OfficialCubismFrameworkRuntime> {
  if (officialCubismFrameworkRuntimePromise) {
    return officialCubismFrameworkRuntimePromise;
  }
  officialCubismFrameworkRuntimePromise = (async () => {
    const runtime = await importOfficialCubismFrameworkRuntime();
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
    officialCubismFrameworkRuntimePromise = null;
    throw new Error(`Live2D Cubism Framework failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
  });
  return officialCubismFrameworkRuntimePromise;
}
