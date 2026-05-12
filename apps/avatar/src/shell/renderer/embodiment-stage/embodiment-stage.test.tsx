// Wave 1 K-NAV-SHELL-COMPOSITION-001..002 + topic
// `2026-04-30-avatar-vrm-backend-branch` wave_1 step_4 + wave_4 chunk
// 4-C — per-surface unit test for embodiment-stage covering:
//  * render presence under ready / fixture_active composition states
//  * surface-mounted / surface-unmounted evidence emission
//  * BackendBranch surface mount + the three lifecycle callbacks
//    (audio-consumer registration, hit-region throttle, lifecycle
//    evidence record) introduced in step_4
//  * pointermove → setIgnoreCursorEvents alpha-mask + bbox fallback
//    routing (chunk 4-C)
//  * global cursor poll recovery after click-through is enabled, preventing
//    macOS ignoreCursorEvents deadlock
//  * 60Hz cap on rapid pointermove (chunk 4-C acceptance_invariant 7)

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

vi.mock('../app-shell/avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: (...args: unknown[]) =>
    recordAvatarEvidenceEventuallyMock(...args),
}));

vi.mock('../app-shell/tauri-commands.js', () => ({
  startWindowDrag: vi.fn(),
  dragWindowBy: vi.fn(),
  setIgnoreCursorEvents: (...args: unknown[]) => setIgnoreCursorEventsMock(...args),
  getCursorClientPosition: (...args: unknown[]) => getCursorClientPositionMock(...args),
  constrainWindowToVisibleArea: vi.fn(),
  setAlwaysOnTop: vi.fn(),
}));

vi.mock('../app-shell/tauri-lifecycle.js', () => ({
  isTauriRuntime: () => false,
  onLaunchContextUpdated: () => Promise.resolve(() => {}),
}));

vi.mock('../audio/audio-pipeline.js', () => ({
  getSharedAudioPipelineController: () => ({
    registerLipsyncSink: (...args: unknown[]) => registerLipsyncSinkMock(...args),
    setRuntime: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    play: vi.fn(),
    stop: vi.fn(),
  }),
}));

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
      props.onLifecycleEvidence?.('mounted', { test_marker: true });
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

beforeEach(() => {
  recordAvatarEvidenceEventuallyMock.mockReset();
  setIgnoreCursorEventsMock.mockReset();
  getCursorClientPositionMock.mockReset();
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

describe('EmbodimentStage — BackendBranch surface mount (wave_1 step_4)', () => {
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

  it('forwards onLifecycleEvidence as avatar.carrier.visual evidence with lifecycle phase', () => {
    const backend = createMockBackend();
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.carrier.visual',
        detail: expect.objectContaining({
          source: 'embodiment-stage',
          lifecycle: 'mounted',
          test_marker: true,
        }),
      }),
    );
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

  it('alpha-mask path: transparent point → setIgnore(true) on pointermove', () => {
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
    fireEvent.pointerMove(stage, { clientX: 50, clientY: 50 });
    // After leading-edge fire the IPC has been called with `true`
    // (transparent → ignore=true). Drain any queued trailing edge.
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
    const stageEl = stage as HTMLElement;
    stageEl.getBoundingClientRect = (() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 600,
      width: 400,
      height: 600,
      toJSON: () => ({}),
    })) as typeof stageEl.getBoundingClientRect;
    setIgnoreCursorEventsMock.mockClear();
    fireEvent.pointerMove(stage, { clientX: 200, clientY: 300 });
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
    expect(container).toBeTruthy();
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
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    setIgnoreCursorEventsMock.mockClear();
    const stage = screen.getByTestId('avatar-embodiment-stage');

    fireEvent.pointerMove(stage, { clientX: 50, clientY: 50 });
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(true);

    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    expect(getCursorClientPositionMock).toHaveBeenCalled();
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
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
    // 60Hz cap (packet acceptance_invariant 7 + negative_test #3).
    expect(setIgnoreCursorEventsMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
