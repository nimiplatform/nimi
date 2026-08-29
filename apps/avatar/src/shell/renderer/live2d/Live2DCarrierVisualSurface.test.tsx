import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendAudioConsumer } from '@nimiplatform/kit/features/avatar/headless';
import type { Live2DBackendSession } from './backend-session.js';
import { createEmptyLive2DExpressionInventory } from './live2d-expression-stack.js';
import type {
  Live2DCarrierVisualFrameStats,
  Live2DCarrierVisualHost,
} from './carrier-visual-host.js';
import { LIVE2D_PARAMETER_LANE_ORDER } from './live2d-parameter-lane-scheduler.js';

const createLive2DCarrierVisualHostMock = vi.fn();

vi.mock('./carrier-visual-host.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./carrier-visual-host.js')>();
  return {
    ...actual,
    createLive2DCarrierVisualHost: (...args: unknown[]) =>
      createLive2DCarrierVisualHostMock(...args),
  };
});

function createSession(): Live2DBackendSession {
  return {
    manifest: {
      runtimeDir: '/models/ren/runtime',
      modelId: 'ren',
      model3JsonPath: '/models/ren/runtime/ren.model3.json',
      nimiDir: null,
    },
    settings: { Version: 3, FileReferences: { Moc: 'ren.moc3', Textures: [] } },
    resources: {
      mocPath: '/models/ren/runtime/ren.moc3',
      texturePaths: [],
      motionGroups: new Map(),
      expressions: new Map(),
      physicsPath: null,
      posePath: null,
      displayInfoPath: null,
    },
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
    framework: {
      modelSetting: null,
      motions: new Map(),
      expressions: new Map(),
      physics: null,
      pose: null,
    },
    expressionInventory: createEmptyLive2DExpressionInventory(),
    execution: {
      loaded: true,
      activeMotion: null,
      activeMotionLoop: false,
      activeExpression: null,
      activePose: null,
      parameters: new Map(),
      parameterLanes: {
        speechLipsync: new Map(),
        live2dExtensionDirect: new Map(),
      },
      commandLog: [],
    },
    applyCommand: vi.fn(),
    unload: vi.fn(),
  };
}

function createAudioConsumer(): BackendAudioConsumer {
  return {
    async attachAudioSource() {},
    detachAudioSource() {},
    silent() {},
    snapshot() {
      return null;
    },
  };
}

function createFrameStats(): Live2DCarrierVisualFrameStats {
  return {
    width: 240,
    height: 260,
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
    parameterLaneElapsedMs: 0,
    parameterLaneUnsupportedParameterIds: [],
    parameterLaneSpeechLipsyncParameterCount: 0,
    parameterLaneDirectParameterCount: 0,
    lookAtIdleSupported: true,
    lookAtIdleBlinkSupported: true,
    lookAtIdleReasonCode: 'ready' as const,
    lookAtIdleParameterIds: ['ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen'],
    sampledPixels: 576,
    visiblePixels: 24,
    sampledPixelChecksum: 1234,
  };
}

function createVisualHost(): Live2DCarrierVisualHost {
  const canvas = document.createElement('canvas');
  canvas.toDataURL = vi.fn(() => 'data:image/png;base64,avatar');
  return {
    canvas,
    drawFrame: vi.fn(() => ({
      width: 240,
      height: 260,
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
      parameterLaneElapsedMs: 0,
      parameterLaneUnsupportedParameterIds: [],
      parameterLaneSpeechLipsyncParameterCount: 0,
      parameterLaneDirectParameterCount: 0,
      lookAtIdleSupported: true,
      lookAtIdleBlinkSupported: true,
      lookAtIdleReasonCode: 'ready' as const,
      lookAtIdleParameterIds: ['ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen'],
    })),
    probeVisibleFrame: vi.fn(() => createFrameStats()),
    resize: vi.fn(),
    unload: vi.fn(),
  };
}

describe('Live2DCarrierVisualSurface', () => {
  const rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    rafCallbacks.length = 0;
    createLive2DCarrierVisualHostMock.mockReset();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses visible-frame probing only for startup proof, then draws steady frames without readback stats', async () => {
    const { Live2DCarrierVisualSurface } = await import('./Live2DCarrierVisualSurface.js');
    const visualHost = createVisualHost();
    const onVisualObservation = vi.fn();
    createLive2DCarrierVisualHostMock.mockResolvedValue(visualHost);

    render(
      <Live2DCarrierVisualSurface
        session={createSession()}
        audioConsumer={createAudioConsumer()}
        paramMouthFormSupported={false}
        onVisualObservation={onVisualObservation}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(visualHost.probeVisibleFrame).toHaveBeenCalledTimes(1);
    expect(visualHost.drawFrame).not.toHaveBeenCalled();
    expect(onVisualObservation).toHaveBeenCalledWith(createFrameStats());
    expect(screen.getByTestId('avatar-live2d-carrier-visual').getAttribute(
      'data-avatar-live2d-carrier-visible-pixels',
    )).toBe('24');

    for (let index = 0; index < 3; index += 1) {
      const callback = rafCallbacks.shift();
      expect(callback).toBeTruthy();
      act(() => {
        callback?.(performance.now());
      });
    }

    expect(visualHost.probeVisibleFrame).toHaveBeenCalledTimes(1);
    expect(visualHost.drawFrame).toHaveBeenCalledTimes(3);
  });

  it('renders the local unavailable surface when visual host initialization fails', async () => {
    const { Live2DCarrierVisualSurface } = await import('./Live2DCarrierVisualSurface.js');
    createLive2DCarrierVisualHostMock.mockRejectedValue(new Error('cubism_context_unavailable'));

    render(
      <Live2DCarrierVisualSurface
        session={createSession()}
        audioConsumer={createAudioConsumer()}
        paramMouthFormSupported={false}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('avatar-presentation-unavailable')).toBeTruthy();
    expect(screen.getByText('cubism_context_unavailable')).toBeTruthy();
  });

  it('replaces a presented surface after an unrecoverable frame failure', async () => {
    const { Live2DCarrierVisualSurface } = await import('./Live2DCarrierVisualSurface.js');
    const visualHost = createVisualHost();
    createLive2DCarrierVisualHostMock.mockResolvedValue(visualHost);

    render(
      <Live2DCarrierVisualSurface
        session={createSession()}
        audioConsumer={createAudioConsumer()}
        paramMouthFormSupported={false}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId('avatar-presentation-unavailable')).toBeNull();

    vi.mocked(visualHost.drawFrame).mockImplementation(() => {
      throw new Error('render_context_permanently_lost');
    });
    const callback = rafCallbacks.shift();
    act(() => {
      callback?.(performance.now());
    });

    expect(screen.getByTestId('avatar-presentation-unavailable')).toBeTruthy();
    expect(screen.getByText('render_context_permanently_lost')).toBeTruthy();
    expect(visualHost.unload).toHaveBeenCalledTimes(1);
  });

  it('disposes a visual host that resolves after the surface was replaced', async () => {
    const { Live2DCarrierVisualSurface } = await import('./Live2DCarrierVisualSurface.js');
    const visualHost = createVisualHost();
    let resolveVisualHost: ((host: Live2DCarrierVisualHost) => void) | null = null;
    createLive2DCarrierVisualHostMock.mockReturnValue(new Promise((resolve) => {
      resolveVisualHost = resolve;
    }));

    const result = render(
      <Live2DCarrierVisualSurface
        session={createSession()}
        audioConsumer={createAudioConsumer()}
        paramMouthFormSupported={false}
      />,
    );
    result.unmount();

    await act(async () => {
      resolveVisualHost?.(visualHost);
      await Promise.resolve();
    });

    expect(visualHost.unload).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('avatar-presentation-unavailable')).toBeNull();
  });
});
