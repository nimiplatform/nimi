// K-NAV-SHELL-COMPOSITION-001..002 per-surface unit tests for
// embodiment-stage covering:
//  * render presence under ready / fixture_active composition states
//  * surface-mounted / surface-unmounted evidence emission
//  * BackendBranch surface mount + the three lifecycle callbacks
//    (audio-consumer registration, hit-region throttle, lifecycle
//    evidence record)
//  * pointermove → setIgnoreCursorEvents alpha-mask + bbox fallback
//    routing
//  * global cursor poll recovery after click-through is enabled, preventing
//    macOS ignoreCursorEvents deadlock
//  * canonical 60Hz cap on rapid pointermove

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { useEffect } from 'react';
import { EmbodimentStage } from './embodiment-stage.js';
import type {
  BackendAudioConsumer,
  BackendBranch,
  BackendHitRegion,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';

const recordAvatarEvidenceEventuallyMock = vi.fn();
const setIgnoreCursorEventsMock = vi.fn();
const getCursorClientPositionMock = vi.fn();
const registerLipsyncSinkMock = vi.fn();
const beginManualDragWindowMock = vi.fn();
const moveManualDragWindowMock = vi.fn();
const constrainWindowToVisibleAreaMock = vi.fn();
const runtimeFlags = vi.hoisted(() => ({
  tauriRuntime: false,
}));

vi.mock('../app-shell/avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: (...args: unknown[]) =>
    recordAvatarEvidenceEventuallyMock(...args),
}));

vi.mock('../app-shell/tauri-commands.js', () => ({
  beginManualDragWindow: (...args: unknown[]) => beginManualDragWindowMock(...args),
  moveManualDragWindow: (...args: unknown[]) => moveManualDragWindowMock(...args),
  setIgnoreCursorEvents: (...args: unknown[]) => setIgnoreCursorEventsMock(...args),
  getCursorClientPosition: (...args: unknown[]) => getCursorClientPositionMock(...args),
  constrainWindowToVisibleArea: (...args: unknown[]) => constrainWindowToVisibleAreaMock(...args),
  setAlwaysOnTop: vi.fn(),
}));

vi.mock('../app-shell/tauri-lifecycle.js', () => ({
  isTauriRuntime: () => runtimeFlags.tauriRuntime,
  onLaunchContextUpdated: () => Promise.resolve(() => {}),
}));

vi.mock('../app-shell/avatar-host-bridge.js', () => ({
  // Manual drag now runs whenever an avatar host runtime is present; the test
  // toggles it via the same `runtimeFlags.tauriRuntime` seam used for
  // click-through gating.
  hasAvatarHostRuntime: () => runtimeFlags.tauriRuntime,
}));

vi.mock('@nimiplatform/kit/features/avatar/headless', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nimiplatform/kit/features/avatar/headless')>();
  return {
    ...actual,
    getSharedAudioPipelineController: () => ({
      registerLipsyncSink: (...args: unknown[]) => registerLipsyncSinkMock(...args),
      setRuntime: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      play: vi.fn(),
      stop: vi.fn(),
    }),
  };
});

function createAudioConsumerStub(): BackendAudioConsumer {
  return {
    async attachAudioSource() {},
    detachAudioSource() {},
    silent() {},
    snapshot() {
      return null;
    },
  };
}

function createHitRegionStub(): BackendHitRegion {
  return {
    body: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
    drag: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
    isOpaqueAtClientPoint: null,
  };
}

function createMockBackend(input?: {
  audioConsumer?: BackendAudioConsumer;
  hitRegion?: BackendHitRegion;
}): BackendBranch & { kind: 'live2d' } {
  const audioConsumer = input?.audioConsumer ?? createAudioConsumerStub();
  const hitRegion = input?.hitRegion ?? createHitRegionStub();
  const Component: ComponentType<BackendSurfaceProps> = (props) => {
    useEffect(() => {
      props.onAudioConsumerReady?.(audioConsumer);
      props.onHitRegionChange?.(hitRegion);
      props.onLifecycleEvidence?.('context_lost', { context_kind: 'webgl', test_marker: true });
    }, [
      props.onAudioConsumerReady,
      props.onHitRegionChange,
      props.onLifecycleEvidence,
    ]);
    return null;
  };
  return {
    kind: 'live2d',
    nominalBounds: { width: 400, height: 600, bodyCenterX: 0.5, bodyCenterY: 0.5 },
    projection: {
      applyActivity() {},
      applyEmotion() {},
      applyMotion() {},
      applyExpression() {},
      reset() {},
    },
    surface: { Component },
    metadata: () => ({}),
    shutdown() {},
    live2dExtension: { setParameter() {} },
  };
}

function createMockNimi2DBackend(input: {
  lifecycleEvents: Array<{ kind: string; detail: Record<string, unknown> }>;
  hitRegion?: BackendHitRegion;
}): BackendBranch & { kind: 'nimi2d' } {
  const audioConsumer = createAudioConsumerStub();
  const hitRegion = input.hitRegion ?? createHitRegionStub();
  const Component: ComponentType<BackendSurfaceProps> = (props) => {
    useEffect(() => {
      props.onAudioConsumerReady?.(audioConsumer);
      props.onHitRegionChange?.(hitRegion);
      for (const event of input.lifecycleEvents) {
        props.onLifecycleEvidence?.(event.kind, event.detail);
      }
    }, [
      props.onAudioConsumerReady,
      props.onHitRegionChange,
      props.onLifecycleEvidence,
    ]);
    return null;
  };
  return {
    kind: 'nimi2d',
    nominalBounds: { width: 512, height: 512, bodyCenterX: 0.5, bodyCenterY: 0.5 },
    projection: {
      applyActivity() {},
      applyEmotion() {},
      applyMotion() {},
      applyExpression() {},
      reset() {},
    },
    surface: { Component },
    metadata: () => ({}),
    shutdown() {},
  };
}

beforeEach(() => {
  recordAvatarEvidenceEventuallyMock.mockReset();
  setIgnoreCursorEventsMock.mockReset();
  getCursorClientPositionMock.mockReset();
  beginManualDragWindowMock.mockReset();
  beginManualDragWindowMock.mockResolvedValue({ x: 1000, y: 700 });
  moveManualDragWindowMock.mockReset();
  moveManualDragWindowMock.mockResolvedValue(undefined);
  constrainWindowToVisibleAreaMock.mockReset();
  constrainWindowToVisibleAreaMock.mockResolvedValue(undefined);
  runtimeFlags.tauriRuntime = false;
  getCursorClientPositionMock.mockResolvedValue({
    screenX: 200,
    screenY: 200,
    clientX: 200,
    clientY: 200,
    scaleFactor: 1,
  });
  registerLipsyncSinkMock.mockReset();
  registerLipsyncSinkMock.mockReturnValue(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

const baseProps = {
  backend: null,
  windowSize: { width: 400, height: 600 },
  embodied: true,
  compositionState: 'ready',
  interactionModality: 'pointer' as const,
};

function installStageRect(stage: HTMLElement): void {
  stage.getBoundingClientRect = (() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 600,
    width: 400,
    height: 600,
    toJSON: () => ({}),
  })) as typeof stage.getBoundingClientRect;
}

describe('EmbodimentStage — render', () => {
  it('renders the embodiment stage section with body hit-region', () => {
    render(<EmbodimentStage {...baseProps} />);
    expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
    expect(screen.getByTestId('avatar-body-hit-region')).toBeTruthy();
  });

  it('renders even when not embodied (during transient embodiment swap)', () => {
    render(<EmbodimentStage {...baseProps} embodied={false} />);
    expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
  });
});

describe('EmbodimentStage — composition evidence emit', () => {
  it('emits avatar.composition.surface-mounted on mount with composition_state', () => {
    render(<EmbodimentStage {...baseProps} compositionState="ready" />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-mounted',
        detail: expect.objectContaining({
          surface: 'embodiment-stage',
          composition_state: 'ready',
        }),
      }),
    );
  });

  it('emits surface-mounted with fixture_active when in fixture mode', () => {
    render(<EmbodimentStage {...baseProps} compositionState="fixture_active" />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-mounted',
        detail: expect.objectContaining({
          surface: 'embodiment-stage',
          composition_state: 'fixture_active',
        }),
      }),
    );
  });

  it('emits avatar.composition.surface-unmounted on unmount', () => {
    const { unmount } = render(<EmbodimentStage {...baseProps} compositionState="ready" />);
    recordAvatarEvidenceEventuallyMock.mockClear();
    unmount();
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-unmounted',
        detail: expect.objectContaining({
          surface: 'embodiment-stage',
          composition_state: 'ready',
        }),
      }),
    );
  });
});

describe('EmbodimentStage — BackendBranch surface mount', () => {
  it('mounts backend.surface.Component when backend is provided', () => {
    const consumer = createAudioConsumerStub();
    const backend = createMockBackend({ audioConsumer: consumer });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    expect(registerLipsyncSinkMock).toHaveBeenCalledWith(consumer);
  });

  it('does not fire click-through from hit-region change alone beyond mount reset', () => {
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint: null,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    // Mount resets a possibly stale native ignoreCursorEvents=true state.
    // The bbox snapshot itself must not trigger an additional click-through
    // toggle; pointermove remains the normal driver.
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledTimes(1);
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
  });

  it('forwards admitted onLifecycleEvidence as carrier lifecycle evidence', () => {
    const backend = createMockBackend();
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.carrier.lifecycle.context_lost',
        detail: expect.objectContaining({
          source: 'embodiment-stage',
          lifecycle: 'context_lost',
          test_marker: true,
        }),
      }),
    );
  });

  it('admits Nimi2D renderer and alpha-probe ready evidence as carrier visual evidence', () => {
    const backend = createMockNimi2DBackend({
      lifecycleEvents: [
        {
          kind: 'renderer_pipeline_ready',
          detail: {
            source: 'nimi2d-carrier-surface',
            model_kind: 'nimi2d',
            renderer: 'pixi.js',
            mode: 'pixi_renderer_foundation',
          },
        },
        {
          kind: 'hit_region_alpha_probe_ready',
          detail: {
            source: 'nimi2d-carrier-surface',
            model_kind: 'nimi2d',
            mode: 'decoded_layer_alpha_probe',
          },
        },
        {
          kind: 'mounted_visual_frame_ready',
          detail: {
            source: 'nimi2d-carrier-surface',
            model_kind: 'nimi2d',
            mode: 'mounted_pixi_canvas_capture',
            human_visible_artifact_path: '/evidence/nimi2d.png',
            artifact_mime_type: 'image/png',
            artifact_byte_length: 128,
          },
        },
      ],
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);

    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.carrier.visual',
        detail: expect.objectContaining({
          source: 'nimi2d-carrier-surface',
          model_kind: 'nimi2d',
          renderer: 'pixi.js',
          mode: 'pixi_renderer_foundation',
          status: 'ready',
        }),
      }),
    );
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.carrier.visual',
        detail: expect.objectContaining({
          source: 'nimi2d-carrier-surface',
          model_kind: 'nimi2d',
          mode: 'decoded_layer_alpha_probe',
          status: 'ready',
        }),
      }),
    );
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.carrier.visual',
        detail: expect.objectContaining({
          source: 'nimi2d-carrier-surface',
          model_kind: 'nimi2d',
          mode: 'mounted_pixi_canvas_capture',
          status: 'ready',
          human_visible_artifact_path: '/evidence/nimi2d.png',
        }),
      }),
    );
    const failedClosedCalls = recordAvatarEvidenceEventuallyMock.mock.calls.filter(([payload]) => (
      (payload as { kind?: string }).kind === 'avatar.carrier.lifecycle.failed_closed'
    ));
    expect(failedClosedCalls).toHaveLength(0);
  });

  it('admits Nimi2D mounted visual capture failure as carrier visual error evidence', () => {
    const backend = createMockNimi2DBackend({
      lifecycleEvents: [{
        kind: 'mounted_visual_frame_failed',
        detail: {
          source: 'nimi2d-carrier-surface',
          model_kind: 'nimi2d',
          mode: 'mounted_pixi_canvas_capture',
          reason_code: 'canvas_capture_failed',
          error: 'no readable pixels',
        },
      }],
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);

    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.carrier.visual',
        detail: expect.objectContaining({
          source: 'nimi2d-carrier-surface',
          model_kind: 'nimi2d',
          mode: 'mounted_pixi_canvas_capture',
          status: 'error',
          reason_code: 'canvas_capture_failed',
        }),
      }),
    );
    const failedClosedCalls = recordAvatarEvidenceEventuallyMock.mock.calls.filter(([payload]) => (
      (payload as { kind?: string }).kind === 'avatar.carrier.lifecycle.failed_closed'
    ));
    expect(failedClosedCalls).toHaveLength(0);
  });

  it('unregisters the lipsync sink on unmount', () => {
    const unregister = vi.fn();
    registerLipsyncSinkMock.mockReturnValueOnce(unregister);
    const backend = createMockBackend();
    const { unmount } = render(<EmbodimentStage {...baseProps} backend={backend} />);
    unmount();
    expect(unregister).toHaveBeenCalled();
  });
});

// Wave 4 chunk 4-C: pointer hit-test → throttled setIgnoreCursorEvents.
describe('EmbodimentStage — pointermove click-through (chunk 4-C)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('alpha-mask path: opaque point → setIgnore(false) on pointermove', () => {
    const isOpaqueAtClientPoint = vi.fn((x: number, _y: number) => x > 100);
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    setIgnoreCursorEventsMock.mockClear();
    const stage = screen.getByTestId('avatar-embodiment-stage');
    fireEvent.pointerMove(stage, { clientX: 200, clientY: 200 });
    expect(isOpaqueAtClientPoint).toHaveBeenCalled();
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
  });

  it('alpha-mask path: transparent point inside body bbox keeps cursor events captured', () => {
    const isOpaqueAtClientPoint = vi.fn(() => false);
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    setIgnoreCursorEventsMock.mockClear();
    const stage = screen.getByTestId('avatar-embodiment-stage') as HTMLElement;
    installStageRect(stage);
    fireEvent.pointerMove(stage, { clientX: 50, clientY: 50 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
  });

  it('alpha-mask path: transparent point outside body bbox enables click-through', () => {
    const isOpaqueAtClientPoint = vi.fn(() => false);
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
        drag: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
        isOpaqueAtClientPoint,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    setIgnoreCursorEventsMock.mockClear();
    const stage = screen.getByTestId('avatar-embodiment-stage') as HTMLElement;
    installStageRect(stage);

    fireEvent.pointerMove(stage, { clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(true);
  });

  it('bbox fallback: alpha-mask null + point inside body → setIgnore(false)', () => {
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint: null,
      },
    });
    const { container } = render(
      <EmbodimentStage {...baseProps} backend={backend} />,
    );
    const stage = screen.getByTestId('avatar-embodiment-stage');
    // jsdom layout returns 0×0; force a non-zero rect via a stub so the
    // bbox math has something to work against.
    installStageRect(stage as HTMLElement);
    setIgnoreCursorEventsMock.mockClear();
    fireEvent.pointerMove(stage, { clientX: 200, clientY: 300 });
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
    expect(container).toBeTruthy();
  });

  it('bbox fallback: alpha probe unavailable for this frame does not enable click-through inside body', () => {
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
        drag: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
        isOpaqueAtClientPoint: () => null,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    const stage = screen.getByTestId('avatar-embodiment-stage') as HTMLElement;
    installStageRect(stage);
    setIgnoreCursorEventsMock.mockClear();

    fireEvent.pointerMove(stage, { clientX: 200, clientY: 300 });

    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
  });

  it('global cursor poll restores setIgnore(false) after transparent click-through re-enters opaque pixels', async () => {
    const isOpaqueAtClientPoint = vi.fn((x: number, _y: number) => x > 100);
    getCursorClientPositionMock.mockResolvedValue({
      screenX: 200,
      screenY: 200,
      clientX: 200,
      clientY: 200,
      scaleFactor: 1,
    });
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
        drag: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
        isOpaqueAtClientPoint,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    setIgnoreCursorEventsMock.mockClear();
    const stage = screen.getByTestId('avatar-embodiment-stage') as HTMLElement;
    installStageRect(stage);

    fireEvent.pointerMove(stage, { clientX: 20, clientY: 20 });
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(true);

    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    expect(getCursorClientPositionMock).toHaveBeenCalled();
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
  });

  it('macOS manual drag uses absolute target movement and freezes click-through during the drag', async () => {
    runtimeFlags.tauriRuntime = true;
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    const isOpaqueAtClientPoint = vi.fn(() => false);
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    setIgnoreCursorEventsMock.mockClear();
    const stage = screen.getByTestId('avatar-embodiment-stage');

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 7,
      clientX: 120,
      clientY: 220,
      screenX: 800,
      screenY: 500,
    });
    await Promise.resolve();

    expect(beginManualDragWindowMock).toHaveBeenCalledTimes(1);
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
    setIgnoreCursorEventsMock.mockClear();
    isOpaqueAtClientPoint.mockClear();

    fireEvent.pointerMove(stage, {
      button: 0,
      buttons: 1,
      pointerId: 7,
      clientX: 180,
      clientY: 260,
      screenX: 860,
      screenY: 540,
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(moveManualDragWindowMock).toHaveBeenCalledWith({
      origin: { x: 1000, y: 700 },
      totalDeltaX: 60,
      totalDeltaY: 40,
    });
    expect(isOpaqueAtClientPoint).not.toHaveBeenCalled();
    expect(setIgnoreCursorEventsMock).not.toHaveBeenCalled();
  });

  it('macOS manual drag cancels pending long-press action radial timer once movement starts', async () => {
    runtimeFlags.tauriRuntime = true;
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    const emit = vi.fn();
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint: () => true,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} emit={emit} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 10,
      clientX: 120,
      clientY: 220,
      screenX: 800,
      screenY: 500,
    });
    await Promise.resolve();

    fireEvent.pointerMove(stage, {
      button: 0,
      buttons: 1,
      pointerId: 10,
      clientX: 180,
      clientY: 260,
      screenX: 860,
      screenY: 540,
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(moveManualDragWindowMock).toHaveBeenCalledWith({
      origin: { x: 1000, y: 700 },
      totalDeltaX: 60,
      totalDeltaY: 40,
    });
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'avatar.user.long_press' }),
    );
  });

  it('macOS manual drag coalesces move IPC while a prior move is in flight', async () => {
    runtimeFlags.tauriRuntime = true;
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    const moveResolvers: Array<() => void> = [];
    moveManualDragWindowMock.mockImplementation(
      () => new Promise<void>((resolve) => {
        moveResolvers.push(resolve);
      }),
    );
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint: () => true,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 11,
      clientX: 120,
      clientY: 220,
      screenX: 800,
      screenY: 500,
    });
    await Promise.resolve();

    fireEvent.pointerMove(stage, {
      button: 0,
      buttons: 1,
      pointerId: 11,
      clientX: 180,
      clientY: 260,
      screenX: 860,
      screenY: 540,
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(moveManualDragWindowMock).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(stage, {
      button: 0,
      buttons: 1,
      pointerId: 11,
      clientX: 220,
      clientY: 280,
      screenX: 900,
      screenY: 560,
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(moveManualDragWindowMock).toHaveBeenCalledTimes(1);

    moveResolvers[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(moveManualDragWindowMock).toHaveBeenCalledTimes(2);
    expect(moveManualDragWindowMock).toHaveBeenLastCalledWith({
      origin: { x: 1000, y: 700 },
      totalDeltaX: 100,
      totalDeltaY: 60,
    });
  });

  it('drag is unified to manual movement on every platform (no system start-dragging)', async () => {
    // Window drag now uses the kit standard manual drag primitive
    // (`beginManualDragWindow` → `moveManualDragWindow`) on every host and
    // platform; the retired system-level start-dragging OS-sniff branch is
    // gone. A Win32 platform (which used to take the system-drag path) now
    // takes the manual path too.
    runtimeFlags.tauriRuntime = true;
    Object.defineProperty(window.navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint: () => true,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 8,
      clientX: 120,
      clientY: 220,
      screenX: 800,
      screenY: 500,
    });
    await Promise.resolve();

    expect(beginManualDragWindowMock).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(stage, {
      button: 0,
      buttons: 1,
      pointerId: 8,
      clientX: 130,
      clientY: 220,
      screenX: 810,
      screenY: 500,
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(moveManualDragWindowMock).toHaveBeenCalledWith({
      origin: { x: 1000, y: 700 },
      totalDeltaX: 10,
      totalDeltaY: 0,
    });
  });

  it('zero-delta pointermove while armed does not consume a click as drag', async () => {
    runtimeFlags.tauriRuntime = true;
    const emit = vi.fn();
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint: () => true,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} emit={emit} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 9,
      clientX: 120,
      clientY: 220,
      screenX: 800,
      screenY: 500,
    });
    fireEvent.pointerMove(stage, {
      button: 0,
      buttons: 1,
      pointerId: 9,
      clientX: 120,
      clientY: 220,
      screenX: 800,
      screenY: 500,
    });
    fireEvent.pointerUp(stage, {
      button: 0,
      buttons: 0,
      pointerId: 9,
      clientX: 120,
      clientY: 220,
      screenX: 800,
      screenY: 500,
    });

    expect(moveManualDragWindowMock).not.toHaveBeenCalled();
    expect(constrainWindowToVisibleAreaMock).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'avatar.user.click' }));
  });

  it('60Hz cap: 1000 rapid pointermove events → ≤ 2 IPC calls', () => {
    let opaque = true;
    const isOpaqueAtClientPoint = vi.fn(() => opaque);
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    setIgnoreCursorEventsMock.mockClear();
    const stage = screen.getByTestId('avatar-embodiment-stage');
    // Alternate opaque / transparent so dedup doesn't suppress all calls.
    for (let i = 0; i < 1000; i += 1) {
      opaque = i % 2 === 0;
      fireEvent.pointerMove(stage, { clientX: 100 + i, clientY: 100 });
    }
    // Within the same simulated tick (no timer advance) at most the
    // leading edge has fired.
    expect(setIgnoreCursorEventsMock.mock.calls.length).toBeLessThanOrEqual(1);
    // Drain any queued trailing edge.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // After drain: leading + at most 1 trailing = ≤ 2 total per the
    // Canonical 60Hz cap.
    expect(setIgnoreCursorEventsMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
