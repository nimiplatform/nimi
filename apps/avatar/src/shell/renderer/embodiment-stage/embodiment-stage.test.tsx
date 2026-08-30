// Per-surface owner behavior tests for embodiment-stage covering:
//  * render presence under the ready composition state
//  * BackendBranch surface mount + audio-consumer / hit-region callbacks
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
  BackendHitRegion,
} from '@nimiplatform/kit/features/avatar/headless';
import type {
  BackendBranch,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';

const setIgnoreCursorEventsMock = vi.fn();
const getCursorClientPositionMock = vi.fn();
const registerLipsyncSinkMock = vi.fn();
const beginManualDragWindowMock = vi.fn();
const moveManualDragWindowMock = vi.fn();
const constrainWindowToVisibleAreaMock = vi.fn();
const runtimeFlags = vi.hoisted(() => ({
  hostRuntime: false,
}));

vi.mock('../app-shell/avatar-window-commands.js', () => ({
  beginManualDragWindow: (...args: unknown[]) => beginManualDragWindowMock(...args),
  moveManualDragWindow: (...args: unknown[]) => moveManualDragWindowMock(...args),
  setIgnoreCursorEvents: (...args: unknown[]) => setIgnoreCursorEventsMock(...args),
  getCursorClientPosition: (...args: unknown[]) => getCursorClientPositionMock(...args),
  constrainWindowToVisibleArea: (...args: unknown[]) => constrainWindowToVisibleAreaMock(...args),
  setAlwaysOnTop: vi.fn(),
}));

vi.mock('../app-shell/avatar-host-bridge.js', () => ({
  // Manual drag now runs whenever an avatar host runtime is present; the test
  // toggles it via the same host-runtime seam used for click-through gating.
  hasAvatarHostRuntime: () => runtimeFlags.hostRuntime,
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
  onSurfaceProps?: (props: BackendSurfaceProps) => void;
  onMount?: () => void;
  onUnmount?: () => void;
}): BackendBranch & { kind: 'live2d' } {
  const audioConsumer = input?.audioConsumer ?? createAudioConsumerStub();
  const hitRegion = input?.hitRegion ?? createHitRegionStub();
  const Component: ComponentType<BackendSurfaceProps> = (props) => {
    input?.onSurfaceProps?.(props);
    useEffect(() => {
      input?.onMount?.();
      return () => input?.onUnmount?.();
    }, []);
    useEffect(() => {
      props.onAudioConsumerReady?.(audioConsumer);
      props.onHitRegionChange?.(hitRegion);
      props.onPresentationStateChange?.({ kind: 'ready' });
    }, [
      props.onAudioConsumerReady,
      props.onHitRegionChange,
      props.onPresentationStateChange,
    ]);
    return null;
  };
  return {
    kind: 'live2d',
    nominalBounds: { width: 400, height: 600, bodyCenterX: 0.5, bodyCenterY: 0.5 },
    projection: {
      applyActivity() { return 'applied'; },
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
  setIgnoreCursorEventsMock.mockReset();
  getCursorClientPositionMock.mockReset();
  beginManualDragWindowMock.mockReset();
  beginManualDragWindowMock.mockResolvedValue({ x: 1000, y: 700 });
  moveManualDragWindowMock.mockReset();
  moveManualDragWindowMock.mockResolvedValue(undefined);
  constrainWindowToVisibleAreaMock.mockReset();
  constrainWindowToVisibleAreaMock.mockResolvedValue(undefined);
  runtimeFlags.hostRuntime = false;
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
  reducedMotion: false,
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
    const stage = screen.getByTestId('avatar-embodiment-stage');
    expect(stage.getAttribute('tabindex')).toBe('0');
    expect(stage.getAttribute('aria-label')).toBe('Agent avatar');
    expect(stage.getAttribute('aria-keyshortcuts')).toContain('Shift+F10');
    expect(screen.getByTestId('avatar-body-hit-region')).toBeTruthy();
  });

  it('opens the ordinary partner menu through the keyboard context-menu path', () => {
    const emit = vi.fn();
    render(<EmbodimentStage {...baseProps} interactionModality="keyboard" emit={emit} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');
    installStageRect(stage);
    stage.focus();
    fireEvent.keyDown(stage, { key: 'F10', shiftKey: true });
    expect(emit).toHaveBeenCalledWith({
      name: 'avatar.user.right_click',
      detail: {
        region: 'body',
        source: 'keyboard',
        client_x: 200,
        client_y: 300,
      },
    });
  });

  it('serializes keyboard window nudges without emitting drag semantics', async () => {
    runtimeFlags.hostRuntime = true;
    const emit = vi.fn();
    render(<EmbodimentStage {...baseProps} interactionModality="keyboard" emit={emit} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(beginManualDragWindowMock).toHaveBeenCalledTimes(1);
    expect(moveManualDragWindowMock).toHaveBeenCalledWith({
      origin: { x: 1000, y: 700 },
      totalDeltaX: 8,
      totalDeltaY: 0,
    });
    expect(constrainWindowToVisibleAreaMock).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });

  it('uses one window-sized Shift+Arrow step as the non-drag display transition', async () => {
    runtimeFlags.hostRuntime = true;
    render(<EmbodimentStage {...baseProps} interactionModality="keyboard" />);
    const stage = screen.getByTestId('avatar-embodiment-stage');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 520,
      width: 390, height: 520, toJSON: () => ({}),
    });
    fireEvent.keyDown(stage, { key: 'ArrowUp', shiftKey: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(moveManualDragWindowMock).toHaveBeenCalledWith({
      origin: { x: 1000, y: 700 },
      totalDeltaX: 0,
      totalDeltaY: -520,
    });
    expect(constrainWindowToVisibleAreaMock).toHaveBeenCalledTimes(1);
  });

  it('does not move the window for assistive-technology modifiers or key repeat', async () => {
    runtimeFlags.hostRuntime = true;
    render(<EmbodimentStage {...baseProps} interactionModality="keyboard" />);
    const stage = screen.getByTestId('avatar-embodiment-stage');

    fireEvent.keyDown(stage, { key: 'ArrowRight', ctrlKey: true, altKey: true });
    fireEvent.keyDown(stage, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(stage, { key: 'ArrowRight', repeat: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(beginManualDragWindowMock).not.toHaveBeenCalled();
    expect(moveManualDragWindowMock).not.toHaveBeenCalled();
  });

  it('renders even when not embodied (during transient embodiment swap)', () => {
    render(<EmbodimentStage {...baseProps} embodied={false} />);
    expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
  });

  it('renders a development preview without product interaction, audio, or Host movement', async () => {
    runtimeFlags.hostRuntime = true;
    const emit = vi.fn();
    const onAvatarWheel = vi.fn();
    const consumer = createAudioConsumerStub();
    render(
      <EmbodimentStage
        {...baseProps}
        backend={createMockBackend({ audioConsumer: consumer })}
        embodied={false}
        interactive={false}
        interactionModality="keyboard"
        emit={emit}
        onAvatarWheel={onAvatarWheel}
      />,
    );
    const stage = screen.getByTestId('avatar-embodiment-stage');
    installStageRect(stage);
    expect(stage.getAttribute('tabindex')).toBe('-1');
    expect(stage.getAttribute('aria-keyshortcuts')).toBeNull();
    expect(registerLipsyncSinkMock).not.toHaveBeenCalled();

    fireEvent.keyDown(stage, { key: 'F10', shiftKey: true });
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 80,
      clientX: 200,
      clientY: 300,
      screenX: 800,
      screenY: 500,
    });
    fireEvent.pointerUp(stage, {
      button: 0,
      pointerId: 80,
      clientX: 200,
      clientY: 300,
      screenX: 800,
      screenY: 500,
    });
    fireEvent.wheel(stage, { deltaY: -100, clientX: 200, clientY: 300 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(emit).not.toHaveBeenCalled();
    expect(onAvatarWheel).not.toHaveBeenCalled();
    expect(beginManualDragWindowMock).not.toHaveBeenCalled();
    expect(moveManualDragWindowMock).not.toHaveBeenCalled();
  });
});

describe('EmbodimentStage — BackendBranch surface mount', () => {
  it('mounts backend.surface.Component when backend is provided', () => {
    const consumer = createAudioConsumerStub();
    const backend = createMockBackend({ audioConsumer: consumer });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    expect(registerLipsyncSinkMock).toHaveBeenCalledWith(consumer);
  });

  it('passes the governed reduced-motion posture into the active backend', () => {
    const observed: BackendSurfaceProps[] = [];
    const backend = createMockBackend({ onSurfaceProps: (props) => observed.push(props) });
    render(<EmbodimentStage {...baseProps} backend={backend} reducedMotion />);
    expect(observed.at(-1)?.reducedMotion).toBe(true);
  });

  it('keeps the staged surface mounted while promoting it to active without early audio attachment', () => {
    const oldConsumer = createAudioConsumerStub();
    const candidateConsumer = createAudioConsumerStub();
    const candidateMounted = vi.fn();
    const candidateUnmounted = vi.fn();
    const oldBackend = createMockBackend({ audioConsumer: oldConsumer });
    const candidateBackend = createMockBackend({
      audioConsumer: candidateConsumer,
      onMount: candidateMounted,
      onUnmount: candidateUnmounted,
    });
    const stagedReady = vi.fn();
    const result = render(
      <EmbodimentStage
        {...baseProps}
        backend={oldBackend}
        presentationKey="old"
        stagingPresentation={{
          backend: candidateBackend,
          presentationKey: 'candidate',
          onPresentationStateChange: stagedReady,
        }}
      />,
    );

    expect(candidateMounted).toHaveBeenCalledOnce();
    expect(candidateUnmounted).not.toHaveBeenCalled();
    expect(stagedReady).toHaveBeenCalledWith({ kind: 'ready' });
    expect(registerLipsyncSinkMock).toHaveBeenCalledWith(oldConsumer);
    expect(registerLipsyncSinkMock).not.toHaveBeenCalledWith(candidateConsumer);

    result.rerender(
      <EmbodimentStage
        {...baseProps}
        backend={candidateBackend}
        presentationKey="candidate"
        stagingPresentation={null}
      />,
    );

    expect(candidateMounted).toHaveBeenCalledOnce();
    expect(candidateUnmounted).not.toHaveBeenCalled();
    expect(registerLipsyncSinkMock).toHaveBeenCalledWith(candidateConsumer);
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

  it('alpha-mask path: transparent point inside body bbox enables click-through', () => {
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
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(true);
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

  it('restores native click capture when an interactive capsule mounts under the cursor', async () => {
    getCursorClientPositionMock.mockResolvedValue({
      screenX: 20,
      screenY: 20,
      clientX: 20,
      clientY: 20,
      scaleFactor: 1,
    });
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
        drag: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
        isOpaqueAtClientPoint: () => false,
      },
    });
    const { rerender } = render(<EmbodimentStage {...baseProps} backend={backend} />);
    const stage = screen.getByTestId('avatar-embodiment-stage') as HTMLElement;
    installStageRect(stage);
    setIgnoreCursorEventsMock.mockClear();
    fireEvent.pointerMove(stage, { clientX: 20, clientY: 20 });
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(true);

    rerender(
      <>
        <EmbodimentStage {...baseProps} backend={backend} />
        <div data-testid="async-capsule" data-avatar-interactive-region="true" />
      </>,
    );
    const capsule = screen.getByTestId('async-capsule');
    capsule.getBoundingClientRect = (() => ({
      x: 0, y: 0, left: 0, top: 0, right: 60, bottom: 60,
      width: 60, height: 60, toJSON: () => ({}),
    })) as typeof capsule.getBoundingClientRect;

    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
  });

  it('macOS manual drag uses absolute target movement and freezes click-through during the drag', async () => {
    runtimeFlags.hostRuntime = true;
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    const isOpaqueAtClientPoint = vi.fn(() => true);
    const emit = vi.fn();
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} emit={emit} />);
    setIgnoreCursorEventsMock.mockClear();
    const stage = screen.getByTestId('avatar-embodiment-stage');
    installStageRect(stage);

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
      clientX: 123,
      clientY: 220,
      screenX: 803,
      screenY: 500,
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(moveManualDragWindowMock).not.toHaveBeenCalled();
    expect(emit.mock.calls.some(([event]) => event.name === 'avatar.user.drag.start')).toBe(false);

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

    fireEvent.pointerMove(stage, {
      button: 0,
      buttons: 1,
      pointerId: 7,
      clientX: 125,
      clientY: 220,
      screenX: 1500,
      screenY: 900,
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(moveManualDragWindowMock).toHaveBeenLastCalledWith({
      origin: { x: 1000, y: 700 },
      totalDeltaX: 700,
      totalDeltaY: 400,
    });
    expect(setIgnoreCursorEventsMock).not.toHaveBeenCalledWith(true);

    fireEvent.pointerUp(stage, {
      button: 0,
      buttons: 0,
      pointerId: 7,
      clientX: 125,
      clientY: 220,
      screenX: 1500,
      screenY: 900,
    });
    expect(emit.mock.calls.map(([event]) => event.name)).toEqual(expect.arrayContaining([
      'avatar.user.drag.start',
      'avatar.user.drag.move',
      'avatar.user.drag.end',
    ]));
    expect(emit.mock.calls.some(([event]) => event.name === 'avatar.user.click')).toBe(false);
  });

  it('does not arm manual drag on a transparent backend pixel', async () => {
    runtimeFlags.hostRuntime = true;
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint: () => false,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    setIgnoreCursorEventsMock.mockClear();
    const stage = screen.getByTestId('avatar-embodiment-stage');
    installStageRect(stage);

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 70,
      clientX: 120,
      clientY: 220,
      screenX: 800,
      screenY: 500,
    });
    await Promise.resolve();

    expect(beginManualDragWindowMock).not.toHaveBeenCalled();
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(true);
  });

  it('falls back to the current drag rectangle when a Tier A/B precision probe returns null', async () => {
    runtimeFlags.hostRuntime = true;
    const emit = vi.fn();
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint: () => null,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} emit={emit} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');
    installStageRect(stage);

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 71,
      clientX: 120,
      clientY: 220,
      screenX: 800,
      screenY: 500,
    });
    fireEvent.pointerMove(stage, {
      button: 0,
      buttons: 1,
      pointerId: 71,
      clientX: 140,
      clientY: 220,
      screenX: 820,
      screenY: 500,
    });
    fireEvent.pointerUp(stage, {
      button: 0,
      pointerId: 71,
      clientX: 140,
      clientY: 220,
      screenX: 820,
      screenY: 500,
    });
    await Promise.resolve();

    expect(beginManualDragWindowMock).toHaveBeenCalledOnce();
    expect(emit.mock.calls.some(([event]) => event.name === 'avatar.user.drag.start'))
      .toBe(true);
  });

  it('falls back to the current drag rectangle when the precision probe throws', async () => {
    runtimeFlags.hostRuntime = true;
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 },
        drag: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 },
        isOpaqueAtClientPoint: () => {
          throw new Error('precision snapshot unreadable');
        },
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');
    installStageRect(stage);

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 73,
      clientX: 200,
      clientY: 300,
      screenX: 800,
      screenY: 500,
    });
    await Promise.resolve();

    expect(beginManualDragWindowMock).toHaveBeenCalledOnce();
  });

  it('requires the point to be inside the current bounded drag rectangle before probing precision', async () => {
    runtimeFlags.hostRuntime = true;
    const isOpaqueAtClientPoint = vi.fn(() => true);
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
        isOpaqueAtClientPoint,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');
    installStageRect(stage);

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 74,
      clientX: 20,
      clientY: 20,
      screenX: 620,
      screenY: 320,
    });
    await Promise.resolve();

    // Pointerdown performs one ordinary click-through hit-test. Drag admission
    // must reject on the rectangle and must not issue a second precision query.
    expect(isOpaqueAtClientPoint).toHaveBeenCalledOnce();
    expect(beginManualDragWindowMock).not.toHaveBeenCalled();
  });

  it('allows Tier C rectangle drag when the backend deliberately publishes no precision probe', async () => {
    runtimeFlags.hostRuntime = true;
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 },
        drag: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 },
        isOpaqueAtClientPoint: null,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    const stage = screen.getByTestId('avatar-embodiment-stage');
    installStageRect(stage);

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 72,
      clientX: 200,
      clientY: 300,
      screenX: 800,
      screenY: 500,
    });
    await Promise.resolve();

    expect(beginManualDragWindowMock).toHaveBeenCalledOnce();
  });

  it('does not arm manual drag when the backend publishes an invalid zero-area region', async () => {
    runtimeFlags.hostRuntime = true;
    render(<EmbodimentStage
      {...baseProps}
      backend={createMockBackend({
        hitRegion: {
          body: { left: 0, top: 0, right: 0, bottom: 0 },
          drag: { left: 0, top: 0, right: 0, bottom: 0 },
          isOpaqueAtClientPoint: null,
        },
      })}
    />);
    const stage = screen.getByTestId('avatar-embodiment-stage');
    installStageRect(stage);

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 9,
      clientX: 200,
      clientY: 300,
      screenX: 1200,
      screenY: 900,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(beginManualDragWindowMock).not.toHaveBeenCalled();
  });

  it('macOS manual drag cancels pending long-press action radial timer once movement starts', async () => {
    runtimeFlags.hostRuntime = true;
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
    installStageRect(stage);

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
    runtimeFlags.hostRuntime = true;
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
    installStageRect(stage);

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
    runtimeFlags.hostRuntime = true;
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
    installStageRect(stage);

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
    runtimeFlags.hostRuntime = true;
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
    installStageRect(stage);

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
