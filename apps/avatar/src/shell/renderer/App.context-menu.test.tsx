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
  agentHandle: string;
  conversationAnchorId: string;
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
    agentHandle: `agent_ref_${'a'.repeat(43)}`,
    conversationAnchorId: 'anchor-01',
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

describe('App context menu overlay', () => {
  it('opens avatar-local context menu from right click and forwards the user event to the driver', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 21,
      clientX: 180,
      clientY: 220,
    });

    expect(await screen.findByTestId('avatar-context-menu')).toBeTruthy();
    expect(handle.driver?.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'avatar.user.right_click',
        detail: expect.objectContaining({
          button: 'right',
          client_x: 180,
          client_y: 220,
        }),
      }),
    );
  });

  it('dismisses context menu on Escape and outside click', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 22,
      clientX: 120,
      clientY: 180,
    });
    await screen.findByTestId('avatar-context-menu');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });

    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 23,
      clientX: 160,
      clientY: 180,
    });
    await screen.findByTestId('avatar-context-menu');
    fireEvent.pointerDown(document.body, { button: 0, clientX: 1, clientY: 1 });
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
  });

  it('requests foreground priority from the menu without creating conversation turns', async () => {
    const projection = createBackendProjection();
    const foregroundHandle = createBootstrapHandle({ projection });
    bootstrapAvatarMock.mockResolvedValue(foregroundHandle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 24,
      clientX: 140,
      clientY: 180,
    });
    const wakeForeground = await screen.findByTestId('avatar-context-menu-item-wake_foreground');
    expect((wakeForeground as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(wakeForeground);

    expect(foregroundHandle.requestCompanionParticipation).not.toHaveBeenCalled();
    expect(foregroundHandle.driver?.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'avatar.shell.foreground_priority.requested',
        detail: expect.objectContaining({
          avatar_instance_id: 'avatar-instance-01',
          agent_id: 'local-agent:owner-product:agent-product-01',
          source: 'context_menu',
        }),
      }),
    );
    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'focused', intensity: 0.45 });
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
  });

  it('keeps interrupt disabled when the current anchor has no active Runtime turn', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 224,
      clientX: 140,
      clientY: 180,
    });

    expect((await screen.findByTestId('avatar-context-menu-item-interrupt') as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('requests Runtime companion participation cancel for the active current-anchor turn', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
      seedActiveTurnBundle();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 225,
      clientX: 140,
      clientY: 180,
    });
    const interrupt = await screen.findByTestId('avatar-context-menu-item-interrupt');
    expect((interrupt as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(interrupt);

    await waitFor(() => {
      expect(handle.interruptActiveTurn).toHaveBeenCalledWith({
        agentId: 'local-agent:owner-product:agent-product-01',
        conversationAnchorId: 'anchor-01',
        turnId: 'turn-active-01',
        reason: 'user_cancel',
      });
    });
    expect(handle.requestCompanionParticipation).not.toHaveBeenCalled();
    expect(handle.startVoiceCapture).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
  });

  it('keeps native window menu actions disabled outside Tauri shell runtime', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 124,
      clientX: 140,
      clientY: 180,
    });

    expect((await screen.findByTestId('avatar-context-menu-item-hide') as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByTestId('avatar-context-menu-item-close') as HTMLButtonElement).disabled)
      .toBe(true);
    expect(hideAvatarWindowMock).not.toHaveBeenCalled();
    expect(closeAvatarWindowMock).not.toHaveBeenCalled();
  });

  it('hides the current avatar window through the native window command', async () => {
    setTauriRuntime(true);
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 125,
      clientX: 140,
      clientY: 180,
    });
    const hide = await screen.findByTestId('avatar-context-menu-item-hide');
    expect((hide as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(hide);

    await waitFor(() => {
      expect(hideAvatarWindowMock).toHaveBeenCalledTimes(1);
    });
    expect(closeAvatarWindowMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
  });

  it('closes the current avatar window through the native window command', async () => {
    setTauriRuntime(true);
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 126,
      clientX: 140,
      clientY: 180,
    });
    const close = await screen.findByTestId('avatar-context-menu-item-close');
    expect((close as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(close);

    await waitFor(() => {
      expect(closeAvatarWindowMock).toHaveBeenCalledTimes(1);
    });
    expect(hideAvatarWindowMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
  });

  it('requests foreground priority from double click without starting local voice capture', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 26,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    fireEvent.pointerUp(stage, {
      button: 0,
      pointerId: 26,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 27,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    fireEvent.pointerUp(stage, {
      button: 0,
      pointerId: 27,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });

    expect(handle.startVoiceCapture).not.toHaveBeenCalled();
    expect(handle.submitVoiceCaptureTurn).not.toHaveBeenCalled();
    expect(handle.driver?.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'avatar.user.double_click' }),
    );
    expect(handle.driver?.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'avatar.shell.foreground_priority.requested',
        detail: expect.objectContaining({ source: 'double_click' }),
      }),
    );
  });

  it('toggles always-on-top from the menu', async () => {
    setTauriRuntime(true);
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    await waitFor(() => {
      expect(setAlwaysOnTopMock).toHaveBeenCalledWith(true);
    });
    setAlwaysOnTopMock.mockClear();

    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 25,
      clientX: 140,
      clientY: 180,
    });
    const alwaysOnTop = await screen.findByTestId('avatar-context-menu-item-toggle_always_on_top');
    fireEvent.click(alwaysOnTop);

    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
    await waitFor(() => {
      expect(setAlwaysOnTopMock).toHaveBeenCalledWith(false);
    });
  });

  it('opens transient settings overlay from context menu with only admitted shell settings', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 325,
      clientX: 140,
      clientY: 180,
    });
    const settings = await screen.findByTestId('avatar-context-menu-item-settings');
    expect((settings as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(settings);

    expect(await screen.findByTestId('avatar-settings-overlay')).toBeTruthy();
    expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    expect(screen.getByText('Avatar settings')).toBeTruthy();
    expect(screen.getByText('Always on top')).toBeTruthy();
    expect(screen.getByText('Show voice captions')).toBeTruthy();
    expect(screen.queryByText('Auto-open new replies')).toBeNull();
  });

  it('persists voice caption setting changes from the settings overlay', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 326,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-settings'));

    const captions = await screen.findByTestId('avatar-settings-toggle-show-voice-captions') as HTMLInputElement;
    expect(captions.checked).toBe(true);
    fireEvent.click(captions);

    expect(readAvatarShellSettings().showVoiceCaptions).toBe(false);
  });

  it('dismisses settings overlay by explicit close', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 327,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-settings'));
    await screen.findByTestId('avatar-settings-overlay');
    fireEvent.click(screen.getByTestId('avatar-settings-overlay-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('avatar-settings-overlay')).toBeNull();
    });
  });

  it('keeps appearance disabled when the current carrier manifest is unavailable', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 326,
      clientX: 140,
      clientY: 180,
    });

    expect((await screen.findByTestId('avatar-context-menu-item-appearance') as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.queryByTestId('avatar-appearance-overlay')).toBeNull();
  });

  it('opens read-only appearance overlay without exposing local asset paths or creating turns', async () => {
    const handle = createBootstrapHandle({ modelManifest: createLive2dModelManifest() });
    bootstrapAvatarMock.mockResolvedValue(handle);

    const { container } = render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 327,
      clientX: 140,
      clientY: 180,
    });
    const appearance = await screen.findByTestId('avatar-context-menu-item-appearance');
    expect((appearance as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(appearance);

    expect(await screen.findByTestId('avatar-appearance-overlay')).toBeTruthy();
    expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    expect(screen.getByText('Live2D')).toBeTruthy();
    expect(screen.getByText('ren-prod')).toBeTruthy();
    expect(screen.getByText('Connected to Runtime')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('Nimi Desktop avatar settings')).toBeTruthy();
    expect(container.textContent).not.toContain('/private/runtime');
    expect(container.textContent).not.toContain('ren.model3.json');
    expect(handle.requestCompanionParticipation).not.toHaveBeenCalled();
    expect(handle.startVoiceCapture).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('avatar-appearance-overlay-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-appearance-overlay')).toBeNull();
    });
  });

  it('keeps debug disabled when the runtime-bound debug facade is unavailable', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 328,
      clientX: 140,
      clientY: 180,
    });

    expect((await screen.findByTestId('avatar-context-menu-item-debug') as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.queryByTestId('avatar-debug-overlay')).toBeNull();
  });

  it('opens transient debug overlay from context menu and loads Runtime avatar debug snapshot', async () => {
    const avatarDebug = createAvatarDebugFacade();
    const handle = createBootstrapHandle({ avatarDebug });
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 329,
      clientX: 140,
      clientY: 180,
    });
    const debug = await screen.findByTestId('avatar-context-menu-item-debug');
    expect((debug as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(debug);

    expect(await screen.findByTestId('avatar-debug-overlay')).toBeTruthy();
    expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    await waitFor(() => {
      expect(avatarDebug.snapshot).toHaveBeenCalledWith(
        {
          agentId: 'local-agent:owner-product:agent-product-01',
          conversationAnchorId: 'anchor-01',
        },
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          timeoutMs: 10_000,
        }),
      );
    });
    expect(screen.getByText('Backend load')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText('runtime.audit.avatar_debug.replay/probe-backend-load-01')).toBeTruthy();
    expect(handle.requestCompanionParticipation).not.toHaveBeenCalled();
    expect(handle.startVoiceCapture).not.toHaveBeenCalled();
  });

  it('requests only Avatar backend debug probes from the debug overlay', async () => {
    const avatarDebug = createAvatarDebugFacade();
    const handle = createBootstrapHandle({ avatarDebug });
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 330,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-debug'));
    await screen.findByTestId('avatar-debug-overlay');
    fireEvent.click(screen.getByTestId('avatar-debug-overlay-request-probes'));

    await waitFor(() => {
      expect(avatarDebug.requestProbe).toHaveBeenCalledTimes(7);
    });
    const probeKinds = (avatarDebug.requestProbe as ReturnType<typeof vi.fn>).mock.calls
      .map(([input]) => (input as { probeKind: AvatarDebugProbeKind }).probeKind);
    expect(probeKinds).toEqual([
      AvatarDebugProbeKind.BACKEND_LOAD,
      AvatarDebugProbeKind.CAPABILITY_PROFILE,
      AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
      AvatarDebugProbeKind.GENERATED_MOTION,
      AvatarDebugProbeKind.EMOTION_EXPRESSION,
      AvatarDebugProbeKind.SPEECH_LIPSYNC,
      AvatarDebugProbeKind.WINDOW_HIT_REGION,
    ]);
    expect(probeKinds).not.toContain(AvatarDebugProbeKind.PACKAGE_VALIDATION);
    expect(probeKinds).not.toContain(AvatarDebugProbeKind.LAUNCH_READINESS);
    expect(handle.requestCompanionParticipation).not.toHaveBeenCalled();
    expect(handle.startVoiceCapture).not.toHaveBeenCalled();
  });

  it('cancels only the active diagnostic RPC and keeps the Avatar surface ready', async () => {
    const avatarDebug = createAvatarDebugFacade();
    const requestSignal: { current: AbortSignal | null } = { current: null };
    (avatarDebug.requestProbe as ReturnType<typeof vi.fn>).mockImplementation(
      (_input: unknown, options?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        requestSignal.current = options?.signal ?? null;
        requestSignal.current?.addEventListener('abort', () => {
          reject(new DOMException('diagnostic canceled', 'AbortError'));
        }, { once: true });
      }),
    );
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle({ avatarDebug }));

    render(<App />);
    act(() => {
      seedReadyState();
    });
    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 331,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-debug'));
    await screen.findByTestId('avatar-debug-overlay');
    fireEvent.click(screen.getByTestId('avatar-debug-overlay-request-probes'));

    await waitFor(() => {
      expect(avatarDebug.requestProbe).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Cancel checks')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('avatar-debug-overlay-request-probes'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Diagnostics were canceled');
    });
    expect(requestSignal.current?.aborted).toBe(true);
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition')).toBe('ready');
    expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
    expect(avatarDebug.requestProbe).toHaveBeenCalledTimes(1);
  });

  it('dismisses debug overlay by Escape and outside click', async () => {
    const avatarDebug = createAvatarDebugFacade();
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle({ avatarDebug }));

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 333,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-debug'));
    await screen.findByTestId('avatar-debug-overlay');
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('avatar-debug-overlay')).toBeNull();
    });

    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 334,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-debug'));
    await screen.findByTestId('avatar-debug-overlay');
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByTestId('avatar-debug-overlay')).toBeNull();
    });
  });

  it('dismisses debug overlay by explicit close', async () => {
    const avatarDebug = createAvatarDebugFacade();
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle({ avatarDebug }));

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 332,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-debug'));
    await screen.findByTestId('avatar-debug-overlay');
    fireEvent.click(screen.getByTestId('avatar-debug-overlay-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('avatar-debug-overlay')).toBeNull();
    });
  });

  it('exposes the always-on-top toggle as a checked menu item', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 41,
      clientX: 140,
      clientY: 180,
    });

    const toggle = await screen.findByTestId('avatar-context-menu-item-toggle_always_on_top');
    expect(toggle.getAttribute('role')).toBe('menuitemcheckbox');
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    const plainItem = screen.getByTestId('avatar-context-menu-item-settings');
    expect(plainItem.getAttribute('role')).toBe('menuitem');
    expect(plainItem.getAttribute('aria-checked')).toBeNull();
  });

  it('moves focus across enabled menu items with arrow keys', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await screen.findByTestId('avatar-embodiment-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 42,
      clientX: 140,
      clientY: 180,
    });

    const menu = await screen.findByTestId('avatar-context-menu');
    const first = screen.getByTestId('avatar-context-menu-item-open_text_input');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('avatar-context-menu-item-wake_foreground'));

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('avatar-context-menu-item-settings'));
  });
});
