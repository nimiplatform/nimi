import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Live2DAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';

const mocks = vi.hoisted(() => ({
  waitForCubismCore: vi.fn(),
  loadOfficialCubismFrameworkRuntime: vi.fn(),
  createLive2DBackendSession: vi.fn(),
  createLive2DCarrierSurface: vi.fn(),
  backendApplyCommand: vi.fn(),
  backendUnload: vi.fn(),
}));

vi.mock('./cubism-bootstrap.js', () => ({
  waitForCubismCore: (...args: unknown[]) => mocks.waitForCubismCore(...args),
}));

vi.mock('./cubism-framework-runtime.js', () => ({
  loadOfficialCubismFrameworkRuntime: (...args: unknown[]) => mocks.loadOfficialCubismFrameworkRuntime(...args),
}));

vi.mock('./backend-session.js', () => ({
  createLive2DBackendSession: (...args: unknown[]) => mocks.createLive2DBackendSession(...args),
}));

vi.mock('./live2d-carrier-surface.js', () => ({
  createLive2DCarrierSurface: (...args: unknown[]) => mocks.createLive2DCarrierSurface(...args),
}));

vi.mock('../app-shell/avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: vi.fn(),
}));

function live2dManifest(): Live2DAvatarModelManifest {
  return {
    kind: 'live2d',
    runtimeDir: '/models/ren/runtime',
    modelId: 'ren',
    nimiDir: null,
    posterPath: null,
    live2d: {
      modelJson: '/models/ren/runtime/ren.model3.json',
      adapterManifestPath: null,
    },
  };
}

describe('createLive2DBackendBranch', () => {
  beforeEach(() => {
    mocks.waitForCubismCore.mockReset();
    mocks.loadOfficialCubismFrameworkRuntime.mockReset();
    mocks.createLive2DBackendSession.mockReset();
    mocks.createLive2DCarrierSurface.mockReset();
    mocks.backendApplyCommand.mockReset();
    mocks.backendUnload.mockReset();
    mocks.waitForCubismCore.mockResolvedValue({ Version: { csmGetVersion: () => 1 } });
    mocks.loadOfficialCubismFrameworkRuntime.mockResolvedValue({ CubismFramework: {} });
    mocks.createLive2DCarrierSurface.mockReturnValue({ Component: () => null });
  });

  it('passes compatibility-projected ParamMouthForm support into the surface and metadata', async () => {
    mocks.createLive2DBackendSession.mockResolvedValue({
      applyCommand: (...args: unknown[]) => mocks.backendApplyCommand(...args),
      unload: (...args: unknown[]) => mocks.backendUnload(...args),
      compatibility: {
        tier: 'semantic_basic',
        adapter: null,
        diagnostics: [],
        activityMotionGroups: new Map(),
        idleMotionGroup: 'Idle',
        mouthOpenParameterId: 'ParamMouthOpenY',
        paramMouthFormSupported: true,
        missingActivity: 'diagnostic_no_success',
      },
    });

    const { createLive2DBackendBranch } = await import('./live2d-backend-branch.js');
    const handle = await createLive2DBackendBranch(live2dManifest());

    expect(mocks.createLive2DCarrierSurface).toHaveBeenCalledWith(expect.objectContaining({
      paramMouthFormSupported: true,
    }));
    expect(handle.branch.metadata()).toEqual(expect.objectContaining({
      param_mouth_form_supported: true,
    }));

    handle.shutdown();
    expect(mocks.backendUnload).toHaveBeenCalledOnce();
  });
});
