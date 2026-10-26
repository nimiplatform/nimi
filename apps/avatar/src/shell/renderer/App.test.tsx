// App.tsx shell composition integration tests.
// The app-local prerequisite composition renders one of:
// product embodiment-stage under ready, non-interactive renderer preview under
// fixture_not_verified, or degraded-surface under the remaining postures.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { useAvatarStore } from './app-shell/app-store.js';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';
import { useEffect, useRef } from 'react';
import type {
  BackendPresentationState,
  BackendSurfaceProps,
} from './carrier/backend-branch.js';
import type { AgentDataBundle } from './driver/types.js';
import {
  AVATAR_SCALE_DEFAULT,
  AVATAR_SCALE_STORAGE_KEY,
  readAvatarInstanceScale,
} from './avatar-scale-state.js';
import { readAvatarShellSettings } from './settings-state.js';
import { isAvatarLocalQuiet } from './local-quiet-state.js';

const bootstrapAvatarMock = vi.fn<(options?: { signal?: AbortSignal }) => Promise<BootstrapHandle>>();
const setIgnoreCursorEventsMock = vi.fn();
const constrainWindowToVisibleAreaMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
const hideAvatarWindowMock = vi.fn();
const closeAvatarWindowMock = vi.fn();
const installAvatarAgentCenterPreviewHandoffMock = vi.fn(async (_input: unknown) => () => {});
let hostRuntime = false;
type AvatarLaunchContextForTest = {
  agentHandle: string;
  conversationAnchorId: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
};

function launchContext(overrides: Partial<AvatarLaunchContextForTest> = {}): AvatarLaunchContextForTest {
  return {
    agentHandle: `agent_ref_${'a'.repeat(43)}`,
    conversationAnchorId: 'anchor-01',
    avatarInstanceId: 'avatar-instance-01',
    launchSource: 'desktop-avatar-launcher',
    ...overrides,
  };
}

vi.mock('./app-shell/app-bootstrap.js', () => ({
  bootstrapAvatar: (options?: { signal?: AbortSignal }) => bootstrapAvatarMock(options),
}));

vi.mock('./app-shell/avatar-host-bridge.js', () => ({
  hasAvatarHostRuntime: () => hostRuntime,
}));


vi.mock('./app-shell/avatar-window-commands.js', () => ({
  setIgnoreCursorEvents: (...args: unknown[]) => setIgnoreCursorEventsMock(...args),
  constrainWindowToVisibleArea: (...args: unknown[]) => constrainWindowToVisibleAreaMock(...args),
  setAlwaysOnTop: (...args: unknown[]) => setAlwaysOnTopMock(...args),
  hideAvatarWindow: (...args: unknown[]) => hideAvatarWindowMock(...args),
  closeAvatarWindow: (...args: unknown[]) => closeAvatarWindowMock(...args),
  beginManualDragWindow: vi.fn(),
  moveManualDragWindow: vi.fn(),
  getCursorClientPosition: vi.fn(async () => ({
    screenX: 0,
    screenY: 0,
    clientX: 0,
    clientY: 0,
    scaleFactor: 1,
  })),
}));

vi.mock('./app-shell/host-lifecycle.js', () => ({
  onHostSuspend: async () => () => {},
}));

vi.mock('./agent-center-preview/agent-center-preview-handoff.js', () => ({
  installAvatarAgentCenterPreviewHandoff: (input: unknown) => (
    installAvatarAgentCenterPreviewHandoffMock(input)
  ),
}));

vi.mock('./live2d/Live2DCarrierVisualSurface.js', () => ({
  Live2DCarrierVisualSurface: () => null,
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createBackendProjection() {
  return {
    applyActivity: vi.fn(),
    applyEmotion: vi.fn(),
    applyMotion: vi.fn(),
    applyExpression: vi.fn(),
    reset: vi.fn(),
  };
}

type AvatarModelManifestForTest = NonNullable<NonNullable<BootstrapHandle['carrier']>['model']>;
const READY_PRESENTATION_STATE: BackendPresentationState = { kind: 'ready' };

function createLive2dModelManifest(): AvatarModelManifestForTest {
  return {
    kind: 'live2d',
    modelId: 'ren-prod',
    runtimeDir: '/private/runtime/ren-prod',
    nimiDir: '/private/runtime/ren-prod/nimi',
    posterPath: null,
    live2d: {
      modelJson: '/private/runtime/ren-prod/ren.model3.json',
      adapterManifestPath: '/private/runtime/ren-prod/nimi/live2d-adapter.json',
      calibrationRef: null,
    },
  };
}

function createBootstrapHandle(input: {
  projection?: ReturnType<typeof createBackendProjection>;
  modelManifest?: AvatarModelManifestForTest;
  presentationState?: BackendPresentationState;
  presentationStates?: BackendPresentationState[];
  onSurfaceMount?: () => void;
  onSurfaceUnmount?: () => void;
  presentationReadyGate?: Promise<void>;
  capturePresentationListener?: (listener: (state: BackendPresentationState) => void) => void;
} = {}): BootstrapHandle {
  const projection = input.projection;
  let surfaceMountCount = 0;
  return {
    driver: {
      kind: 'sdk',
      status: 'running',
      start: vi.fn(),
      stop: vi.fn(),
      getBundle: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      onBundleChange: vi.fn(() => () => {}),
      onStatusChange: vi.fn(() => () => {}),
      emit: vi.fn(),
    },
    carrier: {
      backendSession: null,
      ...(input.modelManifest ? { model: input.modelManifest } : {}),
      backend: projection
        ? {
          kind: 'vrm',
          nominalBounds: { width: 360, height: 640, bodyCenterX: 180, bodyCenterY: 320 },
          projection,
          surface: {
            Component: (props: BackendSurfaceProps) => {
              const mountIndexRef = useRef<number | null>(null);
              if (mountIndexRef.current === null) {
                mountIndexRef.current = surfaceMountCount++;
              }
              const presentationState = input.presentationStates?.[mountIndexRef.current]
                ?? input.presentationState
                ?? READY_PRESENTATION_STATE;
              useEffect(() => {
                let active = true;
                if (props.onPresentationStateChange) input.capturePresentationListener?.(props.onPresentationStateChange);
                const publish = () => {
                  if (active) props.onPresentationStateChange?.(presentationState);
                };
                if (input.presentationReadyGate) {
                  void input.presentationReadyGate.then(publish);
                } else {
                  publish();
                }
                return () => {
                  active = false;
                };
              }, [presentationState, props.onPresentationStateChange]);
              useEffect(() => {
                input.onSurfaceMount?.();
                return () => input.onSurfaceUnmount?.();
              }, []);
              return presentationState.kind === 'unavailable' ? (
                <button
                  type="button"
                  data-testid="test-backend-presentation-restart"
                  onClick={props.onPresentationRestart}
                >
                  Restart presentation
                </button>
              ) : null;
            },
          },
          metadata: () => ({}),
          shutdown: vi.fn(),
        }
        : undefined,
      shutdown: vi.fn(),
    },
    getVoiceInputAvailability: vi.fn(async () => ({ available: true, reason: null })),
    startVoiceCapture: vi.fn(async () => ({
      stop: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm' })),
      cancel: vi.fn(),
    })),
    submitVoiceCaptureTurn: vi.fn(async () => ({ transcript: 'voice hello' })),
    interruptConversationTurn: vi.fn(async () => undefined),
    sendConversationText: vi.fn(async () => ({ turnId: 'turn-01' })),
    abortPendingLaunch: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  } as unknown as BootstrapHandle;
}

function seedReadyState(): void {
  useAvatarStore.getState().markShellReady({ width: 360, height: 640 });
  useAvatarStore.getState().setConsumeMode({
    mode: 'sdk',
    authority: 'runtime',
    fixtureId: null,
    fixturePlaying: false,
  });
  useAvatarStore.getState().setRuntimeBinding({
    avatarInstanceId: 'avatar-instance-01',
    conversationAnchorId: 'anchor-01',
    agentHandle: `agent_ref_${'a'.repeat(43)}`,
    worldId: 'world-01',
  });
  useAvatarStore.getState().setLaunchContext(launchContext());
  useAvatarStore.getState().setDriverStatus('running');
}

function seedActiveTurnBundle(input: {
  turnId?: string;
  phase?: 'accepted' | 'started' | 'streaming' | 'committed';
} = {}): void {
  const turnId = input.turnId ?? 'turn-active-01';
  const phase = input.phase ?? 'streaming';
  const now = '2026-06-16T10:00:00.000Z';
  useAvatarStore.getState().setBundle({
    posture: {
      posture_class: 'baseline_observer',
      action_family: 'observe',
      interrupt_mode: 'welcome',
      transition_reason: 'test',
      truth_basis_ids: [],
    },
    status_text: '',
    execution_state: 'CHAT_ACTIVE',
    active_world_id: 'world-01',
    active_agent_handle: `agent_ref_${'a'.repeat(43)}`,
    app: {
      namespace: 'avatar',
      surface_id: 'avatar-window',
      visible: true,
      focused: true,
      window: { x: 0, y: 0, width: 360, height: 640 },
      cursor_x: 0,
      cursor_y: 0,
    },
    runtime: {
      now,
      session_id: 'anchor-01',
      locale: 'en',
    },
    custom: {
      agent_handle: `agent_ref_${'a'.repeat(43)}`,
      conversation_anchor_id: 'anchor-01',
      active_turn_id: turnId,
      active_turn_stream_id: 'stream-active-01',
      active_turn_phase: phase,
      active_turn_text: 'active reply',
      active_turn_updated_at: now,
    },
  } satisfies AgentDataBundle);
}

function seedMockDriverWithoutRuntimeBinding(): void {
  useAvatarStore.getState().markShellReady({ width: 360, height: 640 });
  useAvatarStore.getState().setConsumeMode({
    mode: 'mock',
    authority: 'fixture',
    fixtureId: 'default',
    fixturePlaying: true,
  });
  useAvatarStore.getState().setLaunchContext(launchContext());
  useAvatarStore.getState().setRuntimeConsumeContext({
    avatarInstanceId: 'fixture-avatar-default',
    conversationAnchorId: 'fixture-anchor-default',
    agentHandle: 'fixture-agent-default',
    worldId: 'world-mock-default',
  });
  useAvatarStore.getState().setDriverStatus('running');
}

function seedRuntimeDriverWithoutRuntimeBinding(): void {
  useAvatarStore.getState().markShellReady({ width: 360, height: 640 });
  useAvatarStore.getState().setConsumeMode({
    mode: 'sdk',
    authority: 'runtime',
    fixtureId: null,
    fixturePlaying: false,
  });
  useAvatarStore.getState().setLaunchContext(launchContext());
  useAvatarStore.getState().setDriverStatus('running');
}

function seedDegradedRuntime(): void {
  useAvatarStore.getState().markShellReady({ width: 360, height: 640 });
  useAvatarStore.getState().setConsumeMode({
    mode: 'sdk',
    authority: 'runtime',
    fixtureId: null,
    fixturePlaying: false,
  });
  useAvatarStore.getState().setRuntimeBindingStatus({
    status: 'unavailable',
    reason: 'local_app_operation: LOCAL_APP_OPERATION_UNAVAILABLE',
  });
  useAvatarStore.getState().setLaunchContext(launchContext());
  useAvatarStore.getState().setDriverStatus('stopped');
}

function seedDegradedReauth(): void {
  useAvatarStore.getState().markShellReady({ width: 360, height: 640 });
  useAvatarStore.getState().setConsumeMode({
    mode: 'sdk',
    authority: 'runtime',
    fixtureId: null,
    fixturePlaying: false,
  });
  useAvatarStore.getState().setRuntimeBindingStatus({
    status: 'unavailable',
    reason: 'runtime_account_session_unavailable',
  });
  useAvatarStore.getState().setLaunchContext(launchContext());
  useAvatarStore.getState().setDriverStatus('stopped');
}

function setHostRuntime(value: boolean): void {
  hostRuntime = value;
}

beforeEach(() => {
  useAvatarStore.setState(useAvatarStore.getInitialState(), true);
  bootstrapAvatarMock.mockReset();
  setIgnoreCursorEventsMock.mockReset();
  constrainWindowToVisibleAreaMock.mockReset();
  setAlwaysOnTopMock.mockReset();
  setAlwaysOnTopMock.mockResolvedValue(undefined);
  hideAvatarWindowMock.mockReset();
  hideAvatarWindowMock.mockResolvedValue(undefined);
  closeAvatarWindowMock.mockReset();
  closeAvatarWindowMock.mockResolvedValue(undefined);
  installAvatarAgentCenterPreviewHandoffMock.mockClear();
  hostRuntime = false;
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('App composition state machine', () => {
  it('keeps the local audio gate quiet when a latched composition recovers', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle({ projection: createBackendProjection() }));
    render(<App />);
    act(() => seedReadyState());
    await waitFor(() => expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-product-ready')).toBe('true'));
    expect(isAvatarLocalQuiet()).toBe(false);
    act(() => useAvatarStore.getState().setDriverStatus('error', 'preview-stream-lost'));
    await waitFor(() => expect(screen.getByTestId('avatar-degraded-surface')).toBeTruthy());
    expect(isAvatarLocalQuiet()).toBe(true);
    act(() => useAvatarStore.getState().setDriverStatus('running'));
    await waitFor(() => expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-product-ready')).toBe('true'));
    expect(isAvatarLocalQuiet()).toBe(true);
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
  });

  it('abandons a terminal initial attempt once and ignores its late ready', async () => {
    let publish!: (state: BackendPresentationState) => void;
    const handle = createBootstrapHandle({
      projection: createBackendProjection(), presentationState: { kind: 'loading' },
      capturePresentationListener: listener => { publish = listener; },
    });
    Object.assign(handle.carrier!, { committedPresentationSelection: {
      avatarAssetRef: 'vrm_aaaaaaaaaaaa', backendKind: 'vrm', presentationRevision: 'revision-1', previewMaterialRef: 'material-1',
    } });
    handle.commitInitialPresentation = vi.fn(async () => {});
    bootstrapAvatarMock.mockResolvedValue(handle);
    render(<App />);
    act(() => seedReadyState());
    await waitFor(() => expect(publish).toBeTypeOf('function'));
    act(() => { publish({ kind: 'unavailable', reason: 'load failed' }); });
    act(() => { publish({ kind: 'unavailable', reason: 'duplicate failure' }); publish({ kind: 'ready' }); });
    expect(handle.abortPendingLaunch).toHaveBeenCalledTimes(1);
    expect(handle.commitInitialPresentation).not.toHaveBeenCalled();
    expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state')).toBe('unavailable');
    expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-product-ready')).toBe('false');
  });

  it('does not turn a failed initial attempt ready when its in-flight commit finishes', async () => {
    let publish!: (state: BackendPresentationState) => void;
    const commit = createDeferred<void>();
    const handle = createBootstrapHandle({
      projection: createBackendProjection(), presentationState: { kind: 'loading' },
      capturePresentationListener: listener => { publish = listener; },
    });
    Object.assign(handle.carrier!, { committedPresentationSelection: {
      avatarAssetRef: 'vrm_aaaaaaaaaaaa', backendKind: 'vrm', presentationRevision: 'revision-1', previewMaterialRef: 'material-1',
    } });
    handle.commitInitialPresentation = vi.fn(() => commit.promise);
    bootstrapAvatarMock.mockResolvedValue(handle);
    render(<App />);
    act(() => seedReadyState());
    await waitFor(() => expect(publish).toBeTypeOf('function'));
    act(() => publish({ kind: 'ready' }));
    expect(handle.commitInitialPresentation).toHaveBeenCalledTimes(1);
    act(() => publish({ kind: 'unavailable', reason: 'render lost before acknowledgement' }));
    await act(async () => { commit.resolve(); await commit.promise; });
    expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state')).toBe('unavailable');
    expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-product-ready')).toBe('false');
  });

  it('ignores callbacks from a closed bootstrap after a fresh App becomes ready', async () => {
    let oldPublish!: (state: BackendPresentationState) => void;
    const old = createBootstrapHandle({ projection: createBackendProjection(),
      capturePresentationListener: listener => { oldPublish = listener; } });
    const current = createBootstrapHandle({ projection: createBackendProjection() });
    bootstrapAvatarMock.mockResolvedValueOnce(old).mockResolvedValueOnce(current);
    const view = render(<App />);
    act(() => seedReadyState());
    await waitFor(() => expect(oldPublish).toBeTypeOf('function'));
    view.unmount();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-product-ready')).toBe('true'));
    act(() => oldPublish({ kind: 'unavailable', reason: 'old closed backend' }));
    expect(old.abortPendingLaunch).not.toHaveBeenCalled();
    expect(current.abortPendingLaunch).not.toHaveBeenCalled();
    expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-product-ready')).toBe('true');
  });
  it('mounts degraded-surface (loading variant) before bootstrap completes', async () => {
    const deferred = createDeferred<BootstrapHandle>();
    bootstrapAvatarMock.mockReturnValue(deferred.promise);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('avatar-degraded-surface')).toBeTruthy();
    });
    const root = screen.getByTestId('avatar-root');
    expect(root.getAttribute('data-composition')).toBe('loading');
    expect(screen.queryByTestId('avatar-embodiment-stage')).toBeNull();
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();

    deferred.resolve(createBootstrapHandle());
  });

  it('mounts embodiment-stage only under ready composition', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
    });
    expect(screen.queryByTestId('avatar-degraded-surface')).toBeNull();
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition')).toBe('ready');
  });

  it('renders an explicit fixture surface without claiming product readiness', async () => {
    const handle = createBootstrapHandle({ projection: createBackendProjection() });
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedMockDriverWithoutRuntimeBinding();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
    });
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
    const root = screen.getByTestId('avatar-root');
    expect(root.getAttribute('data-composition')).toBe('fixture_not_verified');
    expect(root.getAttribute('data-avatar-status')).toBe('not_verified');
    expect(root.getAttribute('data-avatar-product-ready')).toBe('false');
    expect(root.getAttribute('data-avatar-development-preview')).toBe('true');
    const stage = screen.getByTestId('avatar-embodiment-stage');
    expect(stage.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByTestId('avatar-runtime-status').textContent)
      .toBe('Fixture preview — not verified as a live Runtime avatar');

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 90,
      clientX: 160,
      clientY: 260,
    });
    fireEvent.pointerUp(stage, {
      button: 0,
      pointerId: 90,
      clientX: 160,
      clientY: 260,
    });
    expect(handle.driver?.emit).not.toHaveBeenCalled();
    expect(handle.getVoiceInputAvailability).not.toHaveBeenCalled();
  });

  it('keeps the production Runtime path gated by its Runtime binding', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedRuntimeDriverWithoutRuntimeBinding();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-degraded-surface')).toBeTruthy();
    });
    expect(screen.queryByTestId('avatar-embodiment-stage')).toBeNull();
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition'))
      .toBe('degraded_runtime_unavailable');
  });

  it('does not register the Agent Center Host preview handoff for fixture mode', async () => {
    setHostRuntime(true);
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);
    act(() => {
      seedMockDriverWithoutRuntimeBinding();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-root').getAttribute('data-composition'))
        .toBe('fixture_not_verified');
    });
    expect(installAvatarAgentCenterPreviewHandoffMock).not.toHaveBeenCalled();
  });

  it('mounts ONLY degraded-surface under degraded:runtime-unavailable', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedDegradedRuntime();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-degraded-surface')).toBeTruthy();
    });
    expect(screen.queryByTestId('avatar-embodiment-stage')).toBeNull();
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
    const root = screen.getByTestId('avatar-root');
    expect(root.getAttribute('data-composition')).toBe('degraded_runtime_unavailable');
  });

  it('mounts ONLY degraded-surface under degraded:reauth-required', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedDegradedReauth();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-degraded-surface')).toBeTruthy();
    });
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition')).toBe('degraded_reauth_required');
  });

  it('mounts degraded-surface (error variant) when bootstrap throws untyped error', async () => {
    bootstrapAvatarMock.mockRejectedValue(new Error('unknown bootstrap explosion'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('avatar-degraded-surface')).toBeTruthy();
      // The same surface is already mounted while bootstrap is loading.
      expect(screen.getByTestId('avatar-root').getAttribute('data-composition')).toBe('error_bootstrap_fatal');
    });
  });

  it('restart from a degraded bootstrap tears down the prior handle before revalidation', async () => {
    const initialHandle = createBootstrapHandle();
    const replacementHandle = createBootstrapHandle();
    bootstrapAvatarMock
      .mockResolvedValueOnce(initialHandle)
      .mockResolvedValueOnce(replacementHandle);

    render(<App />);

    act(() => {
      seedDegradedRuntime();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-degraded-restart')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('avatar-degraded-restart'));

    await waitFor(() => {
      expect(initialHandle.shutdown).toHaveBeenCalledTimes(1);
      expect(bootstrapAvatarMock).toHaveBeenCalledTimes(2);
    });
  });

  it('cancels the current restart scope when unmounted before bootstrap settles', async () => {
    const initial = createBootstrapHandle();
    const replacement = createBootstrapHandle();
    const pending = createDeferred<BootstrapHandle>();
    bootstrapAvatarMock.mockResolvedValueOnce(initial).mockReturnValueOnce(pending.promise);
    const view = render(<App />);
    act(() => seedDegradedRuntime());
    await waitFor(() => expect(screen.getByTestId('avatar-degraded-restart')).toBeTruthy());
    fireEvent.click(screen.getByTestId('avatar-degraded-restart'));
    await waitFor(() => expect(bootstrapAvatarMock).toHaveBeenCalledTimes(2));
    const signal = bootstrapAvatarMock.mock.calls[1]?.[0]?.signal;
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(replacement); await pending.promise; });
    expect(replacement.shutdown).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer staged request intact when an older callback or activation rejection arrives late', async () => {
    setHostRuntime(true);
    const oldResult = createDeferred<void>();
    const oldReady = createDeferred<void>();
    const nextReady = createDeferred<void>();
    const oldListener: { current?: (state: BackendPresentationState) => void } = {};
    const nextMounted = vi.fn(), nextUnmounted = vi.fn();
    const initialHandle = createBootstrapHandle({ projection: createBackendProjection() });
    const first = createBootstrapHandle({ projection: createBackendProjection(), presentationReadyGate: oldReady.promise,
      capturePresentationListener: listener => { oldListener.current = listener; } }).carrier!;
    const second = createBootstrapHandle({ projection: createBackendProjection(), presentationReadyGate: nextReady.promise,
      onSurfaceMount: nextMounted, onSurfaceUnmount: nextUnmounted }).carrier!;
    first.committedPresentationSelection = { avatarAssetRef: 'vrm_aaaaaaaaaaaa', backendKind: 'vrm', previewMaterialRef: 'first', presentationRevision: '1' };
    second.committedPresentationSelection = { avatarAssetRef: 'vrm_bbbbbbbbbbbb', backendKind: 'vrm', previewMaterialRef: 'second', presentationRevision: '2' };
    initialHandle.activateCommittedPresentation = vi.fn(async (request, waitForReady) => {
      if (request.previewRequestId === 'old-request') { await waitForReady(first); await oldResult.promise; }
      else { await waitForReady(second); initialHandle.carrier = second; }
    });
    bootstrapAvatarMock.mockResolvedValue(initialHandle);
    render(<App />);
    act(() => seedReadyState());
    await waitFor(() => expect(installAvatarAgentCenterPreviewHandoffMock).toHaveBeenCalledTimes(1));
    const handoff = installAvatarAgentCenterPreviewHandoffMock.mock.calls[0]![0] as {
      activatePresentation(input: Parameters<BootstrapHandle['activateCommittedPresentation']>[0]): Promise<void>;
    };
    const activation = { agentHandle: `agent_ref_${'a'.repeat(43)}`, avatarAssetRef: 'vrm_bbbbbbbbbbbb',
      backendKind: 'vrm' as const, presentationRevision: '2', signal: new AbortController().signal };
    let old!: Promise<unknown>;
    act(() => { old = handoff.activatePresentation({ ...activation, previewRequestId: 'old-request' }).catch(error => error); });
    await waitFor(() => expect(oldListener.current).toBeTypeOf('function'));
    const staleCallback = oldListener.current!;
    await act(async () => { oldReady.resolve(); await Promise.resolve(); });
    let next!: Promise<void>, nextSettled = false;
    act(() => {
      next = handoff.activatePresentation({ ...activation, previewRequestId: 'next-request' });
      void next.then(() => { nextSettled = true; }, () => { nextSettled = true; });
    });
    await waitFor(() => expect(nextMounted).toHaveBeenCalledOnce());
    await act(async () => { staleCallback({ kind: 'ready' }); await Promise.resolve(); });
    expect(nextSettled).toBe(false);
    await act(async () => { oldResult.reject(new Error('old activation failed')); await old; });
    expect(nextUnmounted).not.toHaveBeenCalled();
    expect(nextSettled).toBe(false);
    await act(async () => { nextReady.resolve(); await next; });
    expect(nextSettled).toBe(true);
  });

  it('aborts and clears a staged preview when stream composition becomes unavailable', async () => {
    setHostRuntime(true);
    const candidateMounted = vi.fn();
    const frame = createDeferred<void>();
    const initialHandle = createBootstrapHandle({ projection: createBackendProjection() });
    const candidate = createBootstrapHandle({ projection: createBackendProjection(), presentationReadyGate: frame.promise,
      onSurfaceMount: candidateMounted }).carrier!;
    candidate.committedPresentationSelection = { avatarAssetRef: 'vrm_cccccccccccc', backendKind: 'vrm', previewMaterialRef: 'candidate', presentationRevision: '2' };
    initialHandle.activateCommittedPresentation = vi.fn(async (_request, waitForReady) => { await waitForReady(candidate); });
    bootstrapAvatarMock.mockResolvedValue(initialHandle);
    render(<App />);
    act(() => seedReadyState());
    await waitFor(() => expect(installAvatarAgentCenterPreviewHandoffMock).toHaveBeenCalledTimes(1));
    const handoff = installAvatarAgentCenterPreviewHandoffMock.mock.calls[0]![0] as {
      signal: AbortSignal;
      activatePresentation(input: Parameters<BootstrapHandle['activateCommittedPresentation']>[0]): Promise<void>;
    };
    let pending!: Promise<unknown>;
    act(() => { pending = handoff.activatePresentation({ previewRequestId: 'stream-loss', signal: handoff.signal,
      agentHandle: `agent_ref_${'a'.repeat(43)}`, avatarAssetRef: 'vrm_cccccccccccc', backendKind: 'vrm', presentationRevision: '2',
    }).catch(error => error); });
    await waitFor(() => expect(candidateMounted).toHaveBeenCalledOnce());
    await act(async () => { seedDegradedRuntime(); await Promise.resolve(); });
    expect(handoff.signal.aborted).toBe(true);
    expect(await pending).toBeInstanceOf(Error);
    expect(document.querySelector('[data-avatar-presentation-layer="staging"]')).toBeNull();
    frame.resolve();
  });

  it('keeps staged promotion mounted when the unavailable current carrier is restarted', async () => {
    setHostRuntime(true);
    const candidateMounted = vi.fn();
    const candidateUnmounted = vi.fn();
    const candidateReady = createDeferred<void>();
    const initialHandle = createBootstrapHandle({
      projection: createBackendProjection(),
      presentationState: { kind: 'unavailable', reason: 'current_backend_failed' },
    });
    const candidateHandle = createBootstrapHandle({
      projection: createBackendProjection(),
      onSurfaceMount: candidateMounted,
      onSurfaceUnmount: candidateUnmounted,
      presentationReadyGate: candidateReady.promise,
    });
    const initialCarrier = initialHandle.carrier!;
    const candidateCarrier = candidateHandle.carrier!;
    initialCarrier.committedPresentationSelection = {
      avatarAssetRef: 'avatar_asset_old',
      backendKind: 'vrm',
      previewMaterialRef: 'material_old',
      presentationRevision: 'revision_old',
    };
    candidateCarrier.committedPresentationSelection = {
      avatarAssetRef: 'avatar_asset_new',
      backendKind: 'vrm',
      previewMaterialRef: 'material_new',
      presentationRevision: 'revision_new',
    };
    initialHandle.activateCommittedPresentation = vi.fn(async (_request, waitForReady) => {
      await waitForReady(candidateCarrier);
      initialHandle.carrier = candidateCarrier;
    });
    bootstrapAvatarMock.mockResolvedValue(initialHandle);

    render(<App />);
    act(() => seedReadyState());

    await waitFor(() => {
      expect(installAvatarAgentCenterPreviewHandoffMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('unavailable');
    });
    const previewInput = installAvatarAgentCenterPreviewHandoffMock.mock.calls[0]?.[0] as {
      activatePresentation(input: Parameters<BootstrapHandle['activateCommittedPresentation']>[0]): Promise<void>;
    };

    let activationPromise!: Promise<void>;
    act(() => {
      activationPromise = previewInput.activatePresentation({
        previewRequestId: 'preview-staged-ready', signal: new AbortController().signal,
        agentHandle: `agent_ref_${'a'.repeat(43)}`,
        avatarAssetRef: 'avatar_asset_new',
        backendKind: 'vrm',
        presentationRevision: 'revision_new',
      });
    });
    await waitFor(() => expect(candidateMounted).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByTestId('test-backend-presentation-restart')[0]!);
    act(() => candidateReady.resolve());
    await act(async () => activationPromise);

    expect(candidateMounted).toHaveBeenCalledTimes(1);
    expect(candidateUnmounted).not.toHaveBeenCalled();
  });

  it('does not overwrite a recovered active carrier when staging fails', async () => {
    setHostRuntime(true);
    const candidateMounted = vi.fn();
    const candidateResult = createDeferred<void>();
    const initialHandle = createBootstrapHandle({
      projection: createBackendProjection(),
      presentationStates: [
        { kind: 'unavailable', reason: 'current_backend_failed' },
        { kind: 'ready' },
      ],
    });
    const candidateHandle = createBootstrapHandle({
      projection: createBackendProjection(),
      presentationState: { kind: 'unavailable', reason: 'candidate_backend_failed' },
      presentationReadyGate: candidateResult.promise,
      onSurfaceMount: candidateMounted,
    });
    const initialCarrier = initialHandle.carrier!;
    const candidateCarrier = candidateHandle.carrier!;
    initialCarrier.committedPresentationSelection = {
      avatarAssetRef: 'avatar_asset_old',
      backendKind: 'vrm',
      previewMaterialRef: 'material_old',
      presentationRevision: 'revision_old',
    };
    candidateCarrier.committedPresentationSelection = {
      avatarAssetRef: 'avatar_asset_failed',
      backendKind: 'vrm',
      previewMaterialRef: 'material_failed',
      presentationRevision: 'revision_failed',
    };
    initialHandle.activateCommittedPresentation = vi.fn(async (_request, waitForReady) => {
      await waitForReady(candidateCarrier);
    });
    bootstrapAvatarMock.mockResolvedValue(initialHandle);

    render(<App />);
    act(() => seedReadyState());

    await waitFor(() => {
      expect(installAvatarAgentCenterPreviewHandoffMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('unavailable');
    });
    const previewInput = installAvatarAgentCenterPreviewHandoffMock.mock.calls[0]?.[0] as {
      activatePresentation(input: Parameters<BootstrapHandle['activateCommittedPresentation']>[0]): Promise<void>;
    };
    let activationPromise!: Promise<void>;
    act(() => {
      activationPromise = previewInput.activatePresentation({
        previewRequestId: 'preview-staged-failed', signal: new AbortController().signal,
        agentHandle: `agent_ref_${'a'.repeat(43)}`,
        avatarAssetRef: 'avatar_asset_failed',
        backendKind: 'vrm',
        presentationRevision: 'revision_failed',
      });
    });
    await waitFor(() => expect(candidateMounted).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getAllByTestId('test-backend-presentation-restart')[0]!);
    await waitFor(() => {
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('ready');
    });
    const activationResult = activationPromise.then(
      () => null,
      (error: unknown) => error,
    );
    let activationError: unknown;
    await act(async () => {
      candidateResult.resolve();
      activationError = await activationResult;
    });
    expect(activationError).toEqual(expect.objectContaining({
      message: 'candidate_backend_failed',
    }));

    expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
      .toBe('ready');
    expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-product-ready'))
      .toBe('true');
  });

  it('remounts the same backend after terminal presentation failure without re-bootstrapping', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle({
      projection: createBackendProjection(),
      presentationStates: [
        { kind: 'unavailable', reason: 'vrm_load_failed' },
        { kind: 'ready' },
      ],
    }));

    render(<App />);
    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('unavailable');
    });
    expect(screen.getByTestId('avatar-runtime-status').getAttribute('data-avatar-status'))
      .toBe('unavailable');
    expect(screen.getByTestId('avatar-runtime-status').textContent).toBe('Avatar unavailable');
    expect(screen.getByTestId('avatar-embodiment-stage').getAttribute('tabindex')).toBe('-1');

    fireEvent.click(screen.getByTestId('test-backend-presentation-restart'));

    await waitFor(() => {
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('ready');
    });
    expect(bootstrapAvatarMock).toHaveBeenCalledTimes(1);
  });
});
