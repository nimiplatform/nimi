import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Live2DAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import { createLive2DExpressionInventory } from './live2d-expression-stack.js';
import { LIVE2D_PARAMETER_LANE_ORDER } from './live2d-parameter-lane-scheduler.js';

const mocks = vi.hoisted(() => ({
  waitForCubismCore: vi.fn(),
  loadOfficialCubismFrameworkRuntime: vi.fn(),
  createLive2DBackendSession: vi.fn(),
  createLive2DCarrierSurface: vi.fn(),
  createLive2DCarrierVisualHost: vi.fn(),
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

vi.mock('./carrier-visual-host.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./carrier-visual-host.js')>();
  return {
    ...actual,
    createLive2DCarrierVisualHost: (...args: unknown[]) => mocks.createLive2DCarrierVisualHost(...args),
  };
});

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
      calibrationRef: null,
    },
  };
}

function live2dManifestWithCalibrationRef(): Live2DAvatarModelManifest {
  return {
    ...live2dManifest(),
    live2d: {
      ...live2dManifest().live2d,
      calibrationRef: 'live2d_calibration_ab12cd34ef56',
    },
  };
}

function expressionInventory() {
  return createLive2DExpressionInventory([
    {
      expressionId: 'smile',
      sourcePath: '/models/ren/runtime/expressions/smile.exp3.json',
      parameters: [
        { id: 'ParamAngleX', value: 1, blend: 'add' },
      ],
    },
  ]);
}

function baseBackendSession(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      modelId: 'ren',
    },
    settings: {
      Version: 3,
      FileReferences: {
        Moc: 'ren.moc3',
        Textures: ['texture.png'],
      },
    },
    resources: {
      mocPath: '/models/ren/runtime/ren.moc3',
      texturePaths: ['/models/ren/runtime/texture.png'],
      motionGroups: new Map(),
      expressions: new Map([
        ['smile', '/models/ren/runtime/expressions/smile.exp3.json'],
      ]),
      physicsPath: null,
      posePath: null,
      displayInfoPath: null,
    },
    expressionInventory: expressionInventory(),
    execution: {
      loaded: true,
      activeMotion: null,
      activeExpression: null,
      activePose: null,
      parameters: new Map(),
      parameterLanes: {
        speechLipsync: new Map(),
        live2dExtensionDirect: new Map(),
      },
      commandLog: [],
    },
    applyCommand: (...args: unknown[]) => mocks.backendApplyCommand(...args),
    unload: (...args: unknown[]) => mocks.backendUnload(...args),
    compatibility: {
      tier: 'render_only',
      adapter: null,
      diagnostics: [],
      activityMotionGroups: new Map(),
      idleMotionGroup: 'Idle',
      mouthOpenParameterId: 'ParamMouthOpenY',
      paramMouthFormSupported: false,
      missingActivity: 'idle_degraded_with_diagnostic',
    },
    ...overrides,
  };
}

describe('createLive2DBackendBranch', () => {
  beforeEach(() => {
    mocks.waitForCubismCore.mockReset();
    mocks.loadOfficialCubismFrameworkRuntime.mockReset();
    mocks.createLive2DBackendSession.mockReset();
    mocks.createLive2DCarrierSurface.mockReset();
    mocks.createLive2DCarrierVisualHost.mockReset();
    mocks.backendApplyCommand.mockReset();
    mocks.backendUnload.mockReset();
    mocks.waitForCubismCore.mockResolvedValue({ Version: { csmGetVersion: () => 1 } });
    mocks.loadOfficialCubismFrameworkRuntime.mockResolvedValue({ CubismFramework: {} });
    mocks.createLive2DCarrierSurface.mockReturnValue({ Component: () => null });
    mocks.createLive2DCarrierVisualHost.mockResolvedValue({
      canvas: {
        toDataURL: vi.fn(() => 'data:image/png;base64,preview'),
      },
      probeVisibleFrame: vi.fn(() => ({
        width: 360,
        height: 480,
        drawableCount: 1,
        visibleDrawableCount: 1,
        nonZeroOpacityDrawableCount: 1,
        textureBindingCount: 1,
        activeMotionGroup: null,
        motionFrameApplied: false,
        activeExpressionId: null,
        expressionFrameApplied: false,
        parameterLaneOrder: LIVE2D_PARAMETER_LANE_ORDER,
        parameterLaneApplied: [],
        parameterLaneElapsedMs: 0.5,
        parameterLaneUnsupportedParameterIds: [],
        parameterLaneSpeechLipsyncParameterCount: 0,
        parameterLaneDirectParameterCount: 0,
        lookAtIdleSupported: true,
        lookAtIdleBlinkSupported: true,
        lookAtIdleReasonCode: 'ready',
        lookAtIdleParameterIds: ['ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen'],
        sampledPixels: 576,
        visiblePixels: 32,
        sampledPixelChecksum: 12345,
      })),
      drawFrame: vi.fn(),
      resize: vi.fn(),
      unload: vi.fn(),
    });
  });

  it('passes compatibility-projected ParamMouthForm support into the surface and metadata', async () => {
    mocks.createLive2DBackendSession.mockResolvedValue(baseBackendSession({
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
    }));

    const { createLive2DBackendBranch } = await import('./live2d-backend-branch.js');
    const handle = await createLive2DBackendBranch(live2dManifest());

    expect(mocks.createLive2DCarrierSurface).toHaveBeenCalledWith(expect.objectContaining({
      paramMouthFormSupported: true,
    }));
    expect(handle.branch.metadata()).toEqual(expect.objectContaining({
      param_mouth_form_supported: true,
      live2d_calibration_ref: null,
      live2d_calibration_projection_status: 'not_configured',
      live2d_calibration_effect_admitted: false,
    }));

    handle.shutdown();
    expect(mocks.backendUnload).toHaveBeenCalledOnce();
  });

  it('projects Live2D calibration refs as effect-blocked metadata only', async () => {
    mocks.createLive2DBackendSession.mockResolvedValue(baseBackendSession());

    const { createLive2DBackendBranch } = await import('./live2d-backend-branch.js');
    const handle = await createLive2DBackendBranch(live2dManifestWithCalibrationRef());

    expect(handle.branch.metadata()).toEqual(expect.objectContaining({
      live2d_calibration_ref: 'live2d_calibration_ab12cd34ef56',
      live2d_calibration_projection_status: 'ref_resolved_effect_not_admitted',
      live2d_calibration_effect_admitted: false,
    }));
    expect(mocks.createLive2DBackendSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ live2dCalibrationRef: expect.anything() }),
      expect.any(Object),
    );

    handle.shutdown();
  });

  it('routes Live2DBackendExtension parameter writes into the direct parameter lane', async () => {
    mocks.createLive2DBackendSession.mockResolvedValue(baseBackendSession());

    const { createLive2DBackendBranch } = await import('./live2d-backend-branch.js');
    const handle = await createLive2DBackendBranch(live2dManifest());

    handle.branch.live2dExtension.setParameter('ParamMouthOpenY', 0.4);

    expect(mocks.backendApplyCommand).toHaveBeenCalledWith({
      kind: 'parameter',
      id: 'ParamMouthOpenY',
      value: 0.4,
      weight: 1,
      source: 'live2d_extension_direct',
    });
  });

  it('updates in-memory visual readiness metadata from the official SDK preview', async () => {
    mocks.createLive2DBackendSession.mockResolvedValue(baseBackendSession());

    const { createLive2DBackendBranch } = await import('./live2d-backend-branch.js');
    const handle = await createLive2DBackendBranch(live2dManifest());

    expect(handle.branch.metadata()).toEqual(expect.objectContaining({
      carrier_visual_readiness_status: 'pending',
    }));

    await handle.verifyBootstrapVisualOutput();

    expect(handle.branch.metadata()).toEqual(expect.objectContaining({
      carrier_visual_readiness_status: 'ready',
      carrier_visual_visible_pixels: 32,
      carrier_visual_texture_binding_count: 1,
      carrier_visual_look_at_idle_supported: true,
      carrier_visual_look_at_idle_blink_supported: true,
      carrier_visual_look_at_idle_reason_code: 'ready',
      expression_stack_supported: true,
      expression_inventory_parameter_count: 1,
    }));
  });
});
