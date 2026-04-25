import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficialCubismFrameworkRuntime } from './cubism-framework-runtime.js';
import type { CubismCoreGlobal } from './cubism-runtime-types.js';
import type { ModelManifest } from './model-loader.js';

const loadModel3SettingsMock = vi.fn();

vi.mock('./model-loader.js', () => ({
  loadModel3Settings: (...args: unknown[]) => loadModel3SettingsMock(...args),
  readBinaryFile: vi.fn(),
}));

const manifest: ModelManifest = {
  runtimeDir: '/models/ren/runtime',
  modelId: 'ren',
  model3JsonPath: '/models/ren/runtime/ren.model3.json',
  nimiDir: null,
};

function createCore() {
  const modelUpdate = vi.fn();
  const modelRelease = vi.fn();
  const mocRelease = vi.fn();
  const core: CubismCoreGlobal = {
    Version: {
      csmGetVersion: () => 1,
      csmGetLatestMocVersion: () => 1,
    },
    Moc: {
      fromArrayBuffer: vi.fn(() => ({ _release: mocRelease })),
    },
    Model: {
      fromMoc: vi.fn(() => ({ update: modelUpdate, release: modelRelease })),
    },
    Logging: {
      csmSetLogFunction: vi.fn(),
    },
  };
  return { core, modelUpdate, modelRelease, mocRelease };
}

function createFramework(): OfficialCubismFrameworkRuntime {
  return {
    CubismFramework: {
      startUp: vi.fn(() => true),
      initialize: vi.fn(),
      isStarted: vi.fn(() => true),
      isInitialized: vi.fn(() => true),
      getIdManager: vi.fn(() => ({ getId: (value: string) => value })),
    },
    Option: class {},
    CubismModelSettingJson: class {
      getModelFileName() { return 'ren.moc3'; }
      getTextureCount() { return 1; }
      getTextureFileName() { return 'ren.4096/texture_00.png'; }
      getPhysicsFileName() { return ''; }
      getPoseFileName() { return 'ren.pose3.json'; }
      getExpressionCount() { return 1; }
      getExpressionName() { return 'smile'; }
      getExpressionFileName() { return 'expressions/smile.exp3.json'; }
      getMotionCount(groupName: string) { return groupName === 'Activity_Happy' ? 1 : 0; }
      getMotionFileName() { return 'motions/happy.motion3.json'; }
      getMotionFadeInTimeValue() { return -1; }
      getMotionFadeOutTimeValue() { return -1; }
      getEyeBlinkParameterCount() { return 0; }
      getLipSyncParameterCount() { return 0; }
    },
    CubismMotion: {
      create: vi.fn(() => ({
        setFadeInTime: vi.fn(),
        setFadeOutTime: vi.fn(),
        setEffectIds: vi.fn(),
      })),
    },
    CubismExpressionMotion: {
      create: vi.fn(() => ({ expression: true })),
    },
    CubismPhysics: {
      create: vi.fn(() => ({ evaluate: vi.fn() })),
    },
    CubismPose: {
      create: vi.fn(() => ({ updateParameters: vi.fn() })),
    },
  };
}

describe('createLive2DBackendSession', () => {
  beforeEach(() => {
    loadModel3SettingsMock.mockReset();
    loadModel3SettingsMock.mockResolvedValue({
      Version: 3,
      FileReferences: {
        Moc: 'ren.moc3',
        Textures: ['ren.4096/texture_00.png'],
        Motions: {
          Activity_Happy: [{ File: 'motions/happy.motion3.json' }],
        },
        Expressions: [
          { Name: 'smile', File: 'expressions/smile.exp3.json' },
        ],
        Pose: 'ren.pose3.json',
      },
    });
  });

  it('loads model assets into a Cubism-backed session and applies commands', async () => {
    const { createLive2DBackendSession } = await import('./backend-session.js');
    const { core, modelUpdate, modelRelease, mocRelease } = createCore();
    const readBinary = vi.fn(async () => new ArrayBuffer(8));

    const framework = createFramework();

    const session = await createLive2DBackendSession(manifest, { core, framework, readBinary });

    expect(core.Moc.fromArrayBuffer).toHaveBeenCalledOnce();
    expect(core.Model.fromMoc).toHaveBeenCalledOnce();
    expect(framework.CubismMotion.create).toHaveBeenCalledOnce();
    expect(framework.CubismExpressionMotion.create).toHaveBeenCalledOnce();
    expect(framework.CubismPose.create).toHaveBeenCalledOnce();
    expect(readBinary).toHaveBeenCalledWith('/models/ren/runtime/ren.moc3');
    expect(readBinary).toHaveBeenCalledWith('/models/ren/runtime/ren.4096/texture_00.png');
    expect(readBinary).toHaveBeenCalledWith('/models/ren/runtime/motions/happy.motion3.json');
    expect(readBinary).toHaveBeenCalledWith('/models/ren/runtime/expressions/smile.exp3.json');

    session.applyCommand({ kind: 'motion', group: 'Activity_Happy', options: { priority: 'normal' } });
    session.applyCommand({ kind: 'expression', id: 'smile' });
    session.applyCommand({ kind: 'parameter', id: 'ParamAngleX', value: 0.3, weight: 1 });
    session.applyCommand({ kind: 'parameter-add', id: 'ParamAngleX', delta: 0.2 });
    session.applyCommand({ kind: 'pose', group: 'standing', loop: true });

    expect(session.execution.activeMotion).toBe('Activity_Happy');
    expect(session.execution.activeExpression).toBe('smile');
    expect(session.execution.activePose).toBe('standing');
    expect(session.execution.parameters.get('ParamAngleX')).toBe(0.5);
    expect(modelUpdate).toHaveBeenCalledTimes(5);

    session.unload();

    expect(session.execution.loaded).toBe(false);
    expect(modelRelease).toHaveBeenCalledOnce();
    expect(mocRelease).toHaveBeenCalledOnce();
  });

  it('fails closed when model3.json does not declare MOC3', async () => {
    const { createLive2DBackendSession } = await import('./backend-session.js');
    loadModel3SettingsMock.mockResolvedValueOnce({ Version: 3, FileReferences: {} });

    await expect(createLive2DBackendSession(manifest, {
      core: createCore().core,
      framework: createFramework(),
      readBinary: vi.fn(async () => new ArrayBuffer(8)),
    })).rejects.toThrow('missing FileReferences.Moc');
  });

  it('rejects unknown motion and expression commands', async () => {
    const { createLive2DBackendSession } = await import('./backend-session.js');
    const session = await createLive2DBackendSession(manifest, {
      core: createCore().core,
      framework: createFramework(),
      readBinary: vi.fn(async () => new ArrayBuffer(8)),
    });

    expect(() => session.applyCommand({ kind: 'motion', group: 'Missing', options: {} })).toThrow('motion group not registered');
    expect(() => session.applyCommand({ kind: 'expression', id: 'missing' })).toThrow('expression not registered');
  });
});
