import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { useAvatarStore } from './app-shell/app-store.js';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';
import type { AgentDataBundle } from './driver/types.js';
import { AvatarDebugProbeKind, AvatarDebugProbeStatus } from '@nimiplatform/sdk/runtime/wire-types';
import {
  AVATAR_SCALE_DEFAULT,
  AVATAR_SCALE_STORAGE_KEY,
  readAvatarInstanceScale,
} from './avatar-scale-state.js';
import { readAvatarShellSettings } from './settings-state.js';

const bootstrapAvatarMock = vi.fn<() => Promise<BootstrapHandle>>();
const setIgnoreCursorEventsMock = vi.fn();
const constrainWindowToVisibleAreaMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
const hideAvatarWindowMock = vi.fn();
const closeAvatarWindowMock = vi.fn();
const onLaunchContextUpdatedMock = vi.fn();
const reloadAvatarShellMock = vi.fn();
let tauriRuntime = false;
type AvatarLaunchContextForTest = {
  agentId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
};

let launchContextUpdatedHandler:
  | ((payload: AvatarLaunchContextForTest) => void)
  | null = null;

function launchContext(overrides: Partial<AvatarLaunchContextForTest> = {}): AvatarLaunchContextForTest {
  return {
    agentId: 'local-agent:avatar-product-01',
    ownerUserId: 'owner-product',
    runtimeSourceRef: 'agent-product-01',
    localAgentRef: 'local-agent:avatar-product-01',
    avatarInstanceId: 'avatar-instance-01',
    launchSource: 'desktop-avatar-launcher',
    ...overrides,
  };
}

vi.mock('./app-shell/app-bootstrap.js', () => ({
  bootstrapAvatar: () => bootstrapAvatarMock(),
}));

vi.mock('./app-shell/tauri-commands.js', () => ({
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

vi.mock('./app-shell/tauri-lifecycle.js', () => ({
  isTauriRuntime: () => tauriRuntime,
  onLaunchContextUpdated: (handler: typeof launchContextUpdatedHandler) => {
    launchContextUpdatedHandler = handler;
    return onLaunchContextUpdatedMock();
  },
}));

vi.mock('./shell-reload.js', () => ({
  reloadAvatarShell: () => reloadAvatarShellMock(),
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

function createCompanionParticipationProjection() {
  return {
    projectionId: 'companion_participation_projection/anchor-01/avatar_companion/turn-01',
    agentId: 'local-agent:owner-product:agent-product-01',
    surfaceKind: 'avatar_companion',
    profileRef: 'runtime.agent.profile/local-agent:owner-product:agent-product-01',
    roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
    triggerSource: 'user_explicit',
    status: 'running',
    auditRef: 'runtime.audit.companion_participation/anchor-01',
    conversationAnchorId: 'anchor-01',
    turnId: 'turn-01',
  } as const;
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
  avatarDebug?: BootstrapHandle['avatarDebug'];
} = {}): BootstrapHandle {
  const projection = input.projection;
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
          surface: { Component: () => null },
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
    cancelCompanionParticipation: vi.fn(async () => createCompanionParticipationProjection()),
    interruptActiveTurn: vi.fn(async () => undefined),
    requestCompanionParticipation: vi.fn(async () => createCompanionParticipationProjection()),
    avatarDebug: input.avatarDebug ?? null,
    shutdown: vi.fn(async () => {}),
  } as unknown as BootstrapHandle;
}

function createAvatarDebugFacade(input: {
  snapshotError?: Error;
  requestError?: Error;
} = {}): NonNullable<BootstrapHandle['avatarDebug']> {
  return {
    snapshot: vi.fn(async () => {
      if (input.snapshotError) throw input.snapshotError;
      return {
        agentId: 'local-agent:owner-product:agent-product-01',
        conversationAnchorId: 'anchor-01',
        probeResults: [
          {
            probeId: 'probe-backend-load-01',
            agentId: 'local-agent:owner-product:agent-product-01',
            conversationAnchorId: 'anchor-01',
            probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
            status: AvatarDebugProbeStatus.BLOCKED,
            observedAt: { seconds: '1770000000', nanos: 0 },
            evidenceRefs: ['runtime.audit.avatar_debug.authorization/probe-backend-load-01'],
            reasonCode: 'avatar_debug_session_not_available',
            resultId: 'runtime-avatar-debug-result-01',
          },
        ],
        replayRefs: [
          {
            probeId: 'probe-backend-load-01',
            replayRef: 'runtime.audit.avatar_debug.replay/probe-backend-load-01',
            redactionState: 1,
            visibility: 1,
            linkedAt: { seconds: '1770000000', nanos: 0 },
          },
        ],
        observedAt: { seconds: '1770000000', nanos: 0 },
      } as Awaited<ReturnType<NonNullable<BootstrapHandle['avatarDebug']>['snapshot']>>;
    }),
    requestProbe: vi.fn(async () => {
      if (input.requestError) throw input.requestError;
      return {
        request: undefined,
        result: undefined,
        replayRef: undefined,
      } as Awaited<ReturnType<NonNullable<BootstrapHandle['avatarDebug']>['requestProbe']>>;
    }),
    listProbeResults: vi.fn(async () => ({
      probeResults: [],
    }) as Awaited<ReturnType<NonNullable<BootstrapHandle['avatarDebug']>['listProbeResults']>>),
  };
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
    agentId: 'local-agent:owner-product:agent-product-01',
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
    active_user_id: 'user-01',
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
      agent_id: 'local-agent:owner-product:agent-product-01',
      conversation_anchor_id: 'anchor-01',
      active_turn_id: turnId,
      active_turn_stream_id: 'stream-active-01',
      active_turn_phase: phase,
      active_turn_text: 'active reply',
      active_turn_updated_at: now,
    },
  } satisfies AgentDataBundle);
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

function setTauriRuntime(value: boolean): void {
  tauriRuntime = value;
}

function hasLaunchContextUpdatedHandler(): boolean {
  return launchContextUpdatedHandler !== null;
}

function emitLaunchContextUpdated(payload: Partial<AvatarLaunchContextForTest>): void {
  launchContextUpdatedHandler?.(launchContext(payload));
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
  onLaunchContextUpdatedMock.mockReset();
  onLaunchContextUpdatedMock.mockResolvedValue(() => {});
  reloadAvatarShellMock.mockReset();
  launchContextUpdatedHandler = null;
  tauriRuntime = false;
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('App action radial overlay', () => {
  async function openActionRadial() {
    const stage = await screen.findByTestId('avatar-embodiment-stage');
    vi.useFakeTimers();
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 41,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    const radial = screen.getByTestId('avatar-action-radial');
    vi.useRealTimers();
    return radial;
  }

  it('single click applies local presentation and does not create a Runtime text turn', async () => {
    const projection = createBackendProjection();
    const handle = createBootstrapHandle({ projection });
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 40,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    fireEvent.pointerUp(stage, {
      button: 0,
      pointerId: 40,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });

    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'happy', intensity: 0.35 });
    expect(handle.requestCompanionParticipation).not.toHaveBeenCalled();
  });

  it('opens action radial from stationary 1s press', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    expect(await openActionRadial()).toBeTruthy();
    expect(handle.driver?.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'avatar.user.long_press',
        detail: expect.objectContaining({
          client_x: 160,
          client_y: 260,
        }),
      }),
    );
  });

  it('selects a radial presentation action without calling Runtime conversation participation', async () => {
    const projection = createBackendProjection();
    const handle = createBootstrapHandle({ projection });
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await openActionRadial();
    fireEvent.click(screen.getByTestId('avatar-action-radial-item-happy'));

    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'happy', intensity: 0.8 });
    expect(handle.requestCompanionParticipation).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-action-radial')).toBeNull();
    });
  });

  it('selects Look at me as local focused presentation without creating text or voice turns', async () => {
    const projection = createBackendProjection();
    const handle = createBootstrapHandle({ projection });
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await openActionRadial();
    fireEvent.click(screen.getByTestId('avatar-action-radial-item-look_at_me'));

    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'focused', intensity: 0.55 });
    expect(handle.requestCompanionParticipation).not.toHaveBeenCalled();
    expect(handle.startVoiceCapture).not.toHaveBeenCalled();
  });

  it('opens transient composer from action radial and keeps text authority in Runtime', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await openActionRadial();
    fireEvent.click(screen.getByTestId('avatar-action-radial-item-open_text_input'));

    await waitFor(() => {
      expect(screen.queryByTestId('avatar-action-radial')).toBeNull();
    });
    expect(await screen.findByTestId('avatar-transient-composer')).toBeTruthy();
  });

  it('does not open action radial after movement starts drag', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    vi.useFakeTimers();
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 42,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    fireEvent.pointerMove(stage, {
      button: 0,
      buttons: 1,
      pointerId: 42,
      clientX: 168,
      clientY: 260,
      screenX: 168,
      screenY: 260,
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();
    fireEvent.pointerUp(stage, {
      button: 0,
      pointerId: 42,
      clientX: 168,
      clientY: 260,
      screenX: 168,
      screenY: 260,
    });

    expect(screen.queryByTestId('avatar-action-radial')).toBeNull();
  });
});

describe('App per-avatar scale', () => {
  it('scales current avatar instance from wheel over the embodiment stage and persists it', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.wheel(stage, {
      deltaY: -100,
      clientX: 180,
      clientY: 260,
    });

    expect(readAvatarInstanceScale('avatar:avatar-instance-01')).toBe(1.05);
  });

  it('resets per-avatar scale from the context menu', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.wheel(stage, {
      deltaY: -100,
      clientX: 180,
      clientY: 260,
    });
    expect(readAvatarInstanceScale('avatar:avatar-instance-01')).toBe(1.05);

    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 51,
      clientX: 140,
      clientY: 180,
    });
    const resetScale = await screen.findByTestId('avatar-context-menu-item-reset_scale');
    expect((resetScale as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(resetScale);

    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
    expect(readAvatarInstanceScale('avatar:avatar-instance-01')).toBe(AVATAR_SCALE_DEFAULT);
  });

  it('restores persisted scale for the launched avatar instance', async () => {
    window.localStorage.setItem(
      AVATAR_SCALE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        scales: {
          'avatar:avatar-instance-01': 1.35,
        },
      }),
    );
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 52,
      clientX: 140,
      clientY: 180,
    });
    const resetScale = await screen.findByTestId('avatar-context-menu-item-reset_scale');
    expect((resetScale as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('App transient composer overlay', () => {
  async function openComposer() {
    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 31,
      clientX: 150,
      clientY: 200,
    });
    const textInput = await screen.findByTestId('avatar-context-menu-item-open_text_input');
    expect((textInput as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(textInput);
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
    return screen.findByTestId('avatar-transient-composer');
  }

  it('opens from context menu', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    expect(await openComposer()).toBeTruthy();
  });

  it('submits through Runtime participation and stays open for repeated turns', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await openComposer();
    const textarea = screen.getByLabelText('Type a message to send to this anchor') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'first note' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(handle.requestCompanionParticipation).toHaveBeenCalledWith({
        agentId: 'local-agent:owner-product:agent-product-01',
        conversationAnchorId: 'anchor-01',
        text: 'first note',
      });
    });
    expect(screen.getByTestId('avatar-transient-composer')).toBeTruthy();
    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
    fireEvent.change(textarea, { target: { value: 'second note' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => {
      expect(handle.requestCompanionParticipation).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId('avatar-transient-composer')).toBeTruthy();
  });

  it('keeps composer open and restores draft when Runtime rejects', async () => {
    const handle = createBootstrapHandle();
    (handle.requestCompanionParticipation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...createCompanionParticipationProjection(),
      status: 'blocked',
      refusalReason: 'runtime_policy_blocked',
    });
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await openComposer();
    const textarea = screen.getByLabelText('Type a message to send to this anchor') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'blocked note' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('runtime_policy_blocked');
    });
    expect(textarea.value).toBe('blocked note');
  });

  it('dismisses on Escape and focus switch', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await openComposer();
    const textarea = screen.getByLabelText('Type a message to send to this anchor') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-transient-composer')).toBeNull();
    });

    await openComposer();
    const activeTextarea = screen.getByLabelText('Type a message to send to this anchor') as HTMLTextAreaElement;
    activeTextarea.blur();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-transient-composer')).toBeNull();
    });
  });
});
