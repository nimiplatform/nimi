import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { useAvatarStore } from './app-shell/app-store.js';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';
import type { AgentDataBundle, AgentEvent } from './driver/types.js';
import {
  AVATAR_SCALE_DEFAULT,
  AVATAR_SCALE_STORAGE_KEY,
  readAvatarInstanceScale,
} from './avatar-scale-state.js';
import { readAvatarShellSettings } from './settings-state.js';
import { useEffect } from 'react';
import type { BackendSurfaceProps } from './carrier/backend-branch.js';

const bootstrapAvatarMock = vi.fn<() => Promise<BootstrapHandle>>();
const setIgnoreCursorEventsMock = vi.fn();
const constrainWindowToVisibleAreaMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
const hideAvatarWindowMock = vi.fn();
const closeAvatarWindowMock = vi.fn();
const quitAvatarAppMock = vi.fn();
let hostRuntime = false;
let avatarHostRuntime = false;
type AvatarLaunchContextForTest = {
  agentHandle: string;
  conversationAnchorId: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
};

let hostSuspendHandler: (() => void) | null = null;

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
  bootstrapAvatar: () => bootstrapAvatarMock(),
}));

vi.mock('./app-shell/avatar-host-bridge.js', () => ({
  hasAvatarHostRuntime: () => avatarHostRuntime,
}));

vi.mock('./app-shell/avatar-window-commands.js', () => ({
  setIgnoreCursorEvents: (...args: unknown[]) => setIgnoreCursorEventsMock(...args),
  constrainWindowToVisibleArea: (...args: unknown[]) => constrainWindowToVisibleAreaMock(...args),
  setAlwaysOnTop: (...args: unknown[]) => setAlwaysOnTopMock(...args),
  hideAvatarWindow: (...args: unknown[]) => hideAvatarWindowMock(...args),
  closeAvatarWindow: (...args: unknown[]) => closeAvatarWindowMock(...args),
  quitAvatarApp: (...args: unknown[]) => quitAvatarAppMock(...args),
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
  onHostSuspend: async (handler: () => void) => {
    hostSuspendHandler = handler;
    return () => {};
  },
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
} = {}): BootstrapHandle {
  const projection = input.projection ?? createBackendProjection();
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
      backend: {
          kind: 'vrm',
          nominalBounds: { width: 360, height: 640, bodyCenterX: 180, bodyCenterY: 320 },
          projection,
          surface: {
            Component: (props: BackendSurfaceProps) => {
              useEffect(() => {
                props.onPresentationStateChange?.({ kind: 'ready' });
              }, [props.onPresentationStateChange]);
              return null;
            },
          },
          metadata: () => ({}),
          shutdown: vi.fn(),
        },
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

async function readyEmbodimentStage(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
      .toBe('ready');
  });
  return screen.getByTestId('avatar-embodiment-stage');
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
  avatarHostRuntime = value;
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
  quitAvatarAppMock.mockReset();
  quitAvatarAppMock.mockResolvedValue(undefined);
  hostSuspendHandler = null;
  hostRuntime = false;
  avatarHostRuntime = false;
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

    await waitFor(() => {
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('ready');
    });
    const stage = await readyEmbodimentStage();
    stage.focus();
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

    await waitFor(() => {
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('ready');
    });
    const stage = await readyEmbodimentStage();
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

  it('opens the transient companion capsule from the menu without starting capture', async () => {
    const projection = createBackendProjection();
    const foregroundHandle = createBootstrapHandle({ projection });
    bootstrapAvatarMock.mockResolvedValue(foregroundHandle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await readyEmbodimentStage();
    stage.focus();
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 24,
      clientX: 140,
      clientY: 180,
    });
    const openCapsule = await screen.findByTestId('avatar-context-menu-item-open_capsule');
    expect((openCapsule as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(openCapsule);

    expect(foregroundHandle.sendConversationText).not.toHaveBeenCalled();
    expect(foregroundHandle.startVoiceCapture).not.toHaveBeenCalled();
    expect(await screen.findByTestId('avatar-companion-surface')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close companion controls'));
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
      expect(document.activeElement).toBe(stage);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
  });

  it('applies Quiet as a local latched cleanup and re-engages only explicitly', async () => {
    const projection = createBackendProjection();
    const handle = createBootstrapHandle({ projection });
    bootstrapAvatarMock.mockResolvedValue(handle);
    render(<App />);
    act(() => {
      seedReadyState();
    });

    const stage = await readyEmbodimentStage();
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 240,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-open_capsule'));
    expect(await screen.findByTestId('avatar-companion-surface')).toBeTruthy();

    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 241,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-quiet'));
    await waitFor(() => expect(screen.queryByTestId('avatar-companion-surface')).toBeNull());
    expect(handle.interruptConversationTurn).not.toHaveBeenCalled();
    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'idle', intensity: 0.2 });

    projection.applyActivity.mockClear();
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 242,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    fireEvent.pointerUp(stage, {
      button: 0,
      pointerId: 242,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    expect(projection.applyActivity).not.toHaveBeenCalled();

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      pointerId: 243,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    fireEvent.pointerUp(stage, {
      button: 0,
      pointerId: 243,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    expect(await screen.findByTestId('avatar-companion-surface')).toBeTruthy();
    expect((screen.getByLabelText('Start voice input') as HTMLButtonElement).disabled).toBe(false);
  });

  it('enters the same Quiet cleanup on host suspend and does not auto-resume capture', async () => {
    avatarHostRuntime = true;
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);
    render(<App />);
    act(() => {
      seedReadyState();
    });
    const stage = await readyEmbodimentStage();
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 245,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-open_capsule'));
    expect(await screen.findByTestId('avatar-companion-surface')).toBeTruthy();
    await waitFor(() => expect(hostSuspendHandler).not.toBeNull());

    act(() => hostSuspendHandler?.());
    await waitFor(() => expect(screen.queryByTestId('avatar-companion-surface')).toBeNull());
    expect(handle.startVoiceCapture).not.toHaveBeenCalled();
    expect(handle.interruptConversationTurn).not.toHaveBeenCalled();
  });

  it('enters latched Quiet on a ready-to-degraded transition and stays quiet after recovery', async () => {
    const projection = createBackendProjection();
    const handle = createBootstrapHandle({ projection });
    bootstrapAvatarMock.mockResolvedValue(handle);
    render(<App />);
    act(() => {
      seedReadyState();
    });
    const stage = await readyEmbodimentStage();
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 246,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-open_capsule'));
    expect(await screen.findByTestId('avatar-companion-surface')).toBeTruthy();

    projection.applyActivity.mockClear();
    act(() => useAvatarStore.getState().setDriverStatus('error', 'reconnecting'));
    expect(await screen.findByTestId('avatar-degraded-surface')).toBeTruthy();
    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'idle', intensity: 0.2 });
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();

    act(() => useAvatarStore.getState().setDriverStatus('running'));
    const recoveredStage = await readyEmbodimentStage();
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
    projection.applyActivity.mockClear();
    fireEvent.pointerDown(recoveredStage, {
      button: 0,
      buttons: 1,
      pointerId: 247,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    fireEvent.pointerUp(recoveredStage, {
      button: 0,
      pointerId: 247,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    expect(projection.applyActivity).not.toHaveBeenCalled();

    fireEvent.pointerDown(recoveredStage, {
      button: 0,
      buttons: 1,
      pointerId: 248,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    fireEvent.pointerUp(recoveredStage, {
      button: 0,
      pointerId: 248,
      clientX: 160,
      clientY: 260,
      screenX: 160,
      screenY: 260,
    });
    expect(await screen.findByTestId('avatar-companion-surface')).toBeTruthy();
    expect((screen.getByLabelText('Start voice input') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not expose Chat turn text or claim speaking from an active turn cue alone', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
      seedActiveTurnBundle();
    });

    await waitFor(() => expect(screen.queryByTestId('avatar-companion-surface')).toBeNull());
    expect(screen.queryByText('active reply')).toBeNull();
    expect(handle.interruptConversationTurn).not.toHaveBeenCalled();
    expect(handle.sendConversationText).not.toHaveBeenCalled();
    expect(handle.startVoiceCapture).not.toHaveBeenCalled();
  });

  it('produces an assistant caption only from an exact-turn Runtime voice chunk', async () => {
    let voiceEventHandler: ((event: AgentEvent) => void) | null = null;
    const handle = createBootstrapHandle();
    handle.driver!.onEvent = vi.fn((handler) => {
      voiceEventHandler = handler;
      return () => {};
    });
    bootstrapAvatarMock.mockResolvedValue(handle);
    render(<App />);
    act(() => {
      seedReadyState();
      seedActiveTurnBundle({ turnId: 'turn-caption-1', phase: 'committed' });
      const current = useAvatarStore.getState().bundle!;
      useAvatarStore.getState().setBundle({
        ...current,
        custom: {
          ...current.custom,
          latest_committed_turn_id: 'turn-caption-1',
          latest_committed_message_id: 'message-caption-1',
          latest_committed_message_text: 'Exact spoken reply',
          latest_committed_message_at: '2026-08-30T00:00:00.000Z',
          last_conversation_voice_id: 'voice-caption-1',
        },
      });
    });
    await readyEmbodimentStage();
    await waitFor(() => expect(voiceEventHandler).not.toBeNull());
    act(() => voiceEventHandler?.({
      event_id: 'voice-event-1',
      name: 'avatar.conversation.voice.audio_chunk',
      timestamp: '2026-08-30T00:00:01.000Z',
      detail: {
        turn_id: 'turn-caption-1',
        voice_id: 'voice-caption-1',
      },
    }));

    const caption = await screen.findByText('Exact spoken reply');
    expect(caption.getAttribute('role')).toBe('status');
    expect(caption.getAttribute('aria-live')).toBe('polite');

    act(() => voiceEventHandler?.({
      event_id: 'voice-event-other-failed',
      name: 'avatar.conversation.voice.failed',
      timestamp: '2026-08-30T00:00:02.000Z',
      detail: { voice_id: 'voice-other' },
    }));
    expect(screen.getByText('Exact spoken reply')).toBeTruthy();

    act(() => voiceEventHandler?.({
      event_id: 'voice-event-active-failed',
      name: 'avatar.conversation.voice.failed',
      timestamp: '2026-08-30T00:00:03.000Z',
      detail: { voice_id: 'voice-caption-1' },
    }));
    expect(screen.queryByText('Exact spoken reply')).toBeNull();
  });

  it('keeps native window menu actions disabled without an Avatar host runtime', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await readyEmbodimentStage();
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
    expect((screen.getByTestId('avatar-context-menu-item-quit_app') as HTMLButtonElement).disabled)
      .toBe(true);
    expect(hideAvatarWindowMock).not.toHaveBeenCalled();
    expect(closeAvatarWindowMock).not.toHaveBeenCalled();
    expect(quitAvatarAppMock).not.toHaveBeenCalled();
  });

  it('enables the same lifecycle and always-on-top commands on the Electron host', async () => {
    avatarHostRuntime = true;
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);
    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(setAlwaysOnTopMock).toHaveBeenCalledWith(true);
    });
    const stage = await readyEmbodimentStage();
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 127,
      clientX: 140,
      clientY: 180,
    });

    expect((await screen.findByTestId('avatar-context-menu-item-hide') as HTMLButtonElement).disabled)
      .toBe(false);
    expect((screen.getByTestId('avatar-context-menu-item-close') as HTMLButtonElement).disabled)
      .toBe(false);
    expect((screen.getByTestId('avatar-context-menu-item-quit_app') as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('hides the current avatar window through the native window command', async () => {
    setHostRuntime(true);
    const projection = createBackendProjection();
    const cancelCapture = vi.fn();
    const handle = createBootstrapHandle({ projection });
    (handle.startVoiceCapture as ReturnType<typeof vi.fn>).mockResolvedValue({
      stop: vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: 'audio/webm' })),
      cancel: cancelCapture,
    });
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('ready');
    });
    const stage = await readyEmbodimentStage();
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 1241,
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId('avatar-context-menu-item-open_capsule'));
    fireEvent.click(await screen.findByLabelText('Start voice input'));
    await waitFor(() => expect(handle.startVoiceCapture).toHaveBeenCalledOnce());
    await waitFor(() => expect(
      (screen.getByLabelText('Stop and send voice input') as HTMLButtonElement).disabled,
    ).toBe(false));
    projection.applyActivity.mockImplementationOnce(() => {
      throw new Error('backend already unavailable');
    });

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
    expect(cancelCapture).toHaveBeenCalledOnce();
    expect(cancelCapture.mock.invocationCallOrder[0]).toBeLessThan(
      hideAvatarWindowMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'idle', intensity: 0.2 });
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
    expect(handle.interruptConversationTurn).not.toHaveBeenCalled();
    expect(closeAvatarWindowMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
  });

  it('closes the current avatar window through the native window command', async () => {
    setHostRuntime(true);
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await readyEmbodimentStage();
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
    expect(quitAvatarAppMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
  });

  it('quits the Avatar App without closing only the current avatar', async () => {
    setHostRuntime(true);
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('ready');
    });
    const stage = await readyEmbodimentStage();
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 1261,
      clientX: 140,
      clientY: 180,
    });
    const quitApp = await screen.findByRole('menuitem', { name: 'Quit Avatar App' });
    expect(quitApp).toBe(screen.getByTestId('avatar-context-menu-item-quit_app'));
    fireEvent.click(quitApp);

    await waitFor(() => {
      expect(quitAvatarAppMock).toHaveBeenCalledTimes(1);
    });
    expect(closeAvatarWindowMock).not.toHaveBeenCalled();
    expect(hideAvatarWindowMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
    });
  });

  it('opens the transient capsule from double click without starting local voice capture', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await readyEmbodimentStage();
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
    expect(await screen.findByTestId('avatar-companion-surface')).toBeTruthy();
  });

  it('toggles always-on-top from the menu', async () => {
    setHostRuntime(true);
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await readyEmbodimentStage();
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

    const stage = await readyEmbodimentStage();
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
    expect(screen.getByText('Caption size')).toBeTruthy();
    expect(screen.getByText('Caption contrast')).toBeTruthy();
    expect(screen.getByText('Caption duration')).toBeTruthy();
    expect(screen.queryByText('Auto-open new replies')).toBeNull();
  });

  it('persists voice caption setting changes from the settings overlay', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-root').getAttribute('data-avatar-presentation-state'))
        .toBe('ready');
    });
    const stage = await readyEmbodimentStage();
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
    fireEvent.change(screen.getByTestId('avatar-settings-caption-size'), { target: { value: 'large' } });
    fireEvent.change(screen.getByTestId('avatar-settings-caption-contrast'), { target: { value: 'high' } });
    fireEvent.change(screen.getByTestId('avatar-settings-caption-duration'), { target: { value: 'long' } });

    expect(readAvatarShellSettings().showVoiceCaptions).toBe(false);
    expect(readAvatarShellSettings()).toMatchObject({
      captionSize: 'large',
      captionContrast: 'high',
      captionDuration: 'long',
    });
  });

  it('dismisses settings overlay by explicit close', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await readyEmbodimentStage();
    stage.focus();
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
      expect(document.activeElement).toBe(stage);
    });
  });

  it('keeps appearance disabled when the current carrier manifest is unavailable', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await readyEmbodimentStage();
    stage.focus();
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

    const stage = await readyEmbodimentStage();
    stage.focus();
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
    expect(screen.getByText('Runtime presentation profile')).toBeTruthy();
    expect(container.textContent).not.toContain('/private/runtime');
    expect(container.textContent).not.toContain('ren.model3.json');
    expect(handle.sendConversationText).not.toHaveBeenCalled();
    expect(handle.startVoiceCapture).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('avatar-appearance-overlay-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-appearance-overlay')).toBeNull();
      expect(document.activeElement).toBe(stage);
    });
  });

  it('does not expose Debug in the ordinary partner menu', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);
    act(() => {
      seedReadyState();
    });
    const stage = await readyEmbodimentStage();
    fireEvent.pointerDown(stage, {
      button: 2,
      buttons: 2,
      pointerId: 328,
      clientX: 140,
      clientY: 180,
    });

    await screen.findByTestId('avatar-context-menu');
    expect(screen.queryByTestId('avatar-context-menu-item-debug')).toBeNull();
    expect(screen.queryByTestId('avatar-debug-overlay')).toBeNull();
  });

  it('opens the same partner menu from Shift+F10 and restores stage focus on Escape', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());
    render(<App />);
    act(() => {
      seedReadyState();
    });
    const stage = await readyEmbodimentStage();
    fireEvent.keyDown(window, { key: 'Tab' });
    stage.focus();
    fireEvent.keyDown(stage, { key: 'F10', shiftKey: true });

    const menu = await screen.findByTestId('avatar-context-menu');
    expect(document.activeElement).toBe(menu);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-context-menu')).toBeNull();
      expect(document.activeElement).toBe(stage);
    });
  });

  it('exposes the always-on-top toggle as a checked menu item', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    const stage = await readyEmbodimentStage();
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

    const stage = await readyEmbodimentStage();
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
    expect(document.activeElement).toBe(screen.getByTestId('avatar-context-menu-item-open_capsule'));

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('avatar-context-menu-item-settings'));
  });
});
