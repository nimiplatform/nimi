import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { useAvatarStore } from './app-shell/app-store.js';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';

const bootstrapAvatarMock = vi.fn<() => Promise<BootstrapHandle>>();
const startWindowDragMock = vi.fn();
const setIgnoreCursorEventsMock = vi.fn();
const constrainWindowToVisibleAreaMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
const onLaunchContextUpdatedMock = vi.fn();
const reloadAvatarShellMock = vi.fn();
let tauriRuntime = false;
let launchContextUpdatedHandler: ((payload: {
  agentId: string;
  avatarPackageKind: 'live2d' | 'vrm';
  avatarPackageId: string;
  avatarPackageSchemaVersion: 1;
  avatarInstanceId: string;
  conversationAnchorId: string;
  launchedBy: string;
  sourceSurface: string | null;
  scopedBinding: {
    bindingId: string;
    bindingHandle: string | null;
    runtimeAppId: string;
    appInstanceId: string;
    windowId: string;
    avatarInstanceId: string;
    agentId: string;
    conversationAnchorId: string;
    worldId: string | null;
    purpose: 'avatar.interaction.consume';
    scopes: string[];
    issuedAt: string | null;
    expiresAt: string | null;
    state: string;
    reasonCode: string;
  };
}) => void) | null = null;

function launchContext(overrides: Partial<Parameters<NonNullable<typeof launchContextUpdatedHandler>>[0]> = {}) {
  const base = {
    agentId: 'agent-product-01',
    avatarPackageKind: 'live2d' as const,
    avatarPackageId: 'live2d_ab12cd34ef56',
    avatarPackageSchemaVersion: 1 as const,
    avatarInstanceId: 'avatar-instance-01',
    conversationAnchorId: 'anchor-01',
    launchedBy: 'desktop',
    sourceSurface: 'desktop-avatar-launcher',
    ...overrides,
  };
  return {
    ...base,
    scopedBinding: overrides.scopedBinding || {
      bindingId: `binding-${base.conversationAnchorId}`,
      bindingHandle: `binding:${base.conversationAnchorId}`,
      runtimeAppId: 'nimi.desktop',
      appInstanceId: 'nimi.desktop.local-first-party',
      windowId: 'desktop-agent-chat',
      avatarInstanceId: base.avatarInstanceId,
      agentId: base.agentId,
      conversationAnchorId: base.conversationAnchorId,
      worldId: null,
      purpose: 'avatar.interaction.consume' as const,
      scopes: [
        'runtime.agent.turn.read',
        'runtime.agent.presentation.read',
        'runtime.agent.state.read',
      ],
      issuedAt: null,
      expiresAt: null,
      state: 'active',
      reasonCode: 'action_executed',
    },
  };
}

vi.mock('./app-shell/app-bootstrap.js', () => ({
  bootstrapAvatar: () => bootstrapAvatarMock(),
}));

vi.mock('./app-shell/avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: vi.fn(),
}));

vi.mock('./app-shell/tauri-commands.js', () => ({
  startWindowDrag: () => startWindowDragMock(),
  setIgnoreCursorEvents: (...args: unknown[]) => setIgnoreCursorEventsMock(...args),
  constrainWindowToVisibleArea: (...args: unknown[]) => constrainWindowToVisibleAreaMock(...args),
  setAlwaysOnTop: (...args: unknown[]) => setAlwaysOnTopMock(...args),
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createBootstrapHandle(): BootstrapHandle {
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
    getVoiceInputAvailability: vi.fn(async () => ({
      available: true,
      reason: null,
    })),
    startVoiceCapture: vi.fn(async () => ({
      stop: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/webm',
      })),
      cancel: vi.fn(),
    })),
    submitVoiceCaptureTurn: vi.fn(async () => ({
      transcript: 'Voice hello',
    })),
    interruptTurn: vi.fn(async () => {}),
    requestTextTurn: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
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
    agentId: 'agent-product-01',
    worldId: 'world-01',
  });
  useAvatarStore.getState().setLaunchContext(launchContext());
  useAvatarStore.getState().setDriverStatus('running');
  useAvatarStore.getState().setBundle({
    posture: {
      posture_class: 'baseline_observer',
      action_family: 'observe',
      interrupt_mode: 'welcome',
      transition_reason: 'test',
      truth_basis_ids: [],
    },
    activity: {
      name: 'calm_presence',
      category: 'state',
      intensity: 'weak',
      source: 'direct_api',
    },
    status_text: 'Holding a calm desktop presence.',
    execution_state: 'IDLE',
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
      now: new Date('2026-04-22T00:00:00.000Z').toISOString(),
      session_id: 'anchor-01',
      locale: 'en-US',
    },
    custom: {
      agent_id: 'agent-product-01',
      conversation_anchor_id: 'anchor-01',
    },
  });
}

function expectNonReadySurface(): void {
  expect(screen.queryByText('Runtime binding')).toBeNull();
  expect(screen.queryByText('Current presence')).toBeNull();
  expect(screen.queryByText('Runtime IPC')).toBeNull();
  expect(screen.queryByText(/Bound \(/)).toBeNull();
}

function setElementRect(element: Element, rect: { left: number; top: number; width: number; height: number }): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }),
  });
}

describe('App surface foundation', () => {
  beforeEach(() => {
    useAvatarStore.setState(useAvatarStore.getInitialState(), true);
    bootstrapAvatarMock.mockReset();
    startWindowDragMock.mockReset();
    setIgnoreCursorEventsMock.mockReset();
    constrainWindowToVisibleAreaMock.mockReset();
    setAlwaysOnTopMock.mockReset();
    onLaunchContextUpdatedMock.mockReset();
    reloadAvatarShellMock.mockReset();
    tauriRuntime = false;
    launchContextUpdatedHandler = null;
    window.localStorage.clear();
    onLaunchContextUpdatedMock.mockResolvedValue(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders a productized ready surface instead of diagnostics text', async () => {
    seedReadyState();
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    expect(screen.getByText('First-party avatar surface')).toBeTruthy();
    expect(screen.getByText('Holding a calm desktop presence.')).toBeTruthy();
    expect(screen.getByText('Live companion')).toBeTruthy();
    expect(screen.getByText('Text or review this anchor')).toBeTruthy();
    expect(screen.getByText('Foreground only, same anchor')).toBeTruthy();
    expect(screen.getByTestId('avatar-live2d-carrier-visual').getAttribute('data-avatar-owned-live2d-status')).toBe('idle');
    expect(screen.queryByText(/shell:/i)).toBeNull();
    expect(screen.queryByText(/driver:/i)).toBeNull();
  });

  it('adds embodied ready-stage feedback for hover, pointer contact, and keyboard focus', async () => {
    seedReadyState();
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    const shell = screen.getByTestId('avatar-shell');
    const stage = screen.getByTestId('avatar-stage');
    const triggerRow = screen.getByTestId('avatar-trigger-row');
    const chatTrigger = screen.getByRole('button', { name: 'Open avatar companion input' });

    expect(shell.className).toContain('avatar-shell--ambient-ready');
    expect(stage.className).toContain('avatar-stage--attention-ready');

    fireEvent.pointerEnter(stage);
    expect(stage.className).toContain('avatar-stage--body-hover');

    fireEvent.pointerDown(stage, { button: 0 });
    expect(stage.className).toContain('avatar-stage--pointer-contact');

    fireEvent.pointerUp(stage, { button: 0 });
    expect(stage.className).not.toContain('avatar-stage--pointer-contact');

    fireEvent.keyDown(window, { key: 'Tab' });
    fireEvent.focus(chatTrigger);
    expect(stage.className).toContain('avatar-stage--focus-visible');
    expect(triggerRow.className).toContain('avatar-companion-trigger-row--focus-visible');
  });

  it('starts native drag only after the avatar drag threshold and keeps stage/bubble choreography aligned', async () => {
    tauriRuntime = true;
    seedReadyState();
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    const stage = screen.getByTestId('avatar-stage');
    const body = screen.getByTestId('avatar-body-hit-region');
    setElementRect(body, { left: 10, top: 20, width: 100, height: 200 });

    fireEvent.pointerDown(stage, { button: 0, clientX: 60, clientY: 180 });
    expect(startWindowDragMock).not.toHaveBeenCalled();
    fireEvent.pointerMove(stage, { button: 0, buttons: 1, clientX: 66, clientY: 180 });
    expect(startWindowDragMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open avatar companion input' }));

    expect(screen.getByTestId('avatar-shell').className).toContain('avatar-shell--ambient-engaged');
    expect(screen.getByTestId('avatar-stage').className).toContain('avatar-stage--attention-engaged');
    expect(screen.getByTestId('avatar-trigger-row').className).toContain('avatar-companion-trigger-row--engaged');
    expect(screen.getByTestId('avatar-companion-bubble').className).toContain('avatar-companion--engaged');
  });

  it('clears pointer-contact on native drag handoff so pressed classes do not stick', async () => {
    tauriRuntime = true;
    seedReadyState();
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    const stage = screen.getByTestId('avatar-stage');
    const body = screen.getByTestId('avatar-body-hit-region');
    const triggerRow = screen.getByTestId('avatar-trigger-row');
    setElementRect(body, { left: 10, top: 20, width: 100, height: 200 });

    fireEvent.pointerEnter(stage, { clientX: 60, clientY: 180 });
    fireEvent.pointerDown(stage, { button: 0, clientX: 60, clientY: 180 });
    expect(stage.className).toContain('avatar-stage--pointer-contact');
    fireEvent.pointerMove(stage, { button: 0, buttons: 1, clientX: 66, clientY: 180 });

    expect(startWindowDragMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(stage.className).not.toContain('avatar-stage--pointer-contact');
      expect(triggerRow.className).not.toContain('avatar-companion-trigger-row--pointer-contact');
    });
  });

  it('routes shell-origin avatar.user events only for hit-region interactions', async () => {
    tauriRuntime = true;
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    const stage = screen.getByTestId('avatar-stage');
    const body = screen.getByTestId('avatar-body-hit-region');
    setElementRect(body, { left: 10, top: 20, width: 100, height: 200 });

    fireEvent.pointerMove(stage, { button: 0, clientX: 180, clientY: 180 });
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(true);
    expect(handle.driver!.emit).not.toHaveBeenCalled();

    fireEvent.pointerMove(stage, { button: 0, clientX: 60, clientY: 70 });
    fireEvent.pointerDown(stage, { button: 0, clientX: 60, clientY: 70 });
    fireEvent.pointerUp(stage, { button: 0, clientX: 60, clientY: 70 });
    fireEvent.pointerDown(stage, { button: 2, clientX: 60, clientY: 180 });

    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
    const emitMock = vi.mocked(handle.driver!.emit);
    expect(emitMock.mock.calls.map((call) => call[0].name)).toEqual([
      'avatar.user.hover',
      'avatar.user.click',
      'avatar.user.right_click',
    ]);
    expect(emitMock.mock.calls[1]?.[0].detail).toMatchObject({
      region: 'face',
      x: 50,
      y: 50,
      button: 'left',
    });
  });

  it('clears stage focus-visible when pointer modality resumes while focus stays inside the stage', async () => {
    seedReadyState();
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    const stage = screen.getByTestId('avatar-stage');
    const triggerRow = screen.getByTestId('avatar-trigger-row');
    const chatTrigger = screen.getByRole('button', { name: 'Open avatar companion input' });

    fireEvent.keyDown(window, { key: 'Tab' });
    fireEvent.focus(chatTrigger);

    expect(stage.className).toContain('avatar-stage--focus-visible');
    expect(triggerRow.className).toContain('avatar-companion-trigger-row--focus-visible');

    fireEvent.pointerDown(window, { button: 0 });

    expect(stage.className).not.toContain('avatar-stage--focus-visible');
    expect(triggerRow.className).not.toContain('avatar-companion-trigger-row--focus-visible');
  });

  it('reveals the Wave 2 trigger and submits text on the current anchor only', async () => {
    seedReadyState();
    useAvatarStore.getState().setBundle({
      ...useAvatarStore.getState().bundle!,
      custom: {
        ...useAvatarStore.getState().bundle!.custom,
        latest_committed_message_id: 'msg-1',
        latest_committed_turn_id: 'turn-1',
        latest_committed_message_text: 'Anchor reply is ready.',
        latest_committed_message_at: '2026-04-22T00:00:02.000Z',
      },
    });
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar companion input' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar companion input' }));

    expect(screen.getByText('Text note on current anchor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Text note' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Foreground voice' })).toBeTruthy();
    expect(screen.getByText('Anchor reply is ready.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ping this anchor' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);

    await waitFor(() => {
      expect(handle.requestTextTurn).toHaveBeenCalledWith({
        agentId: 'agent-product-01',
        conversationAnchorId: 'anchor-01',
        text: 'Ping this anchor',
      });
    });
    expect(screen.getByText('You: Ping this anchor')).toBeTruthy();
  });

  it('automatically reveals the bubble when a fresh committed assistant reply arrives', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar companion input' })).toBeTruthy();
    expect(screen.queryByText('Latest anchor reply')).toBeNull();

    await act(async () => {
      useAvatarStore.getState().setBundle({
        ...useAvatarStore.getState().bundle!,
        custom: {
          ...useAvatarStore.getState().bundle!.custom,
          latest_committed_message_id: 'msg-fresh',
          latest_committed_turn_id: 'turn-fresh',
          latest_committed_message_text: 'Fresh committed reply',
          latest_committed_message_at: '2026-04-22T00:00:05.000Z',
        },
      });
    });

    expect(await screen.findByText('Latest anchor reply')).toBeTruthy();
    expect(screen.getByText('Fresh committed reply')).toBeTruthy();
  });

  it('keeps one companion grammar when switching from text draft to foreground voice and back', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar companion input' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar companion input' }));
    expect(screen.getByText('Text note on current anchor')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft stays bounded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Foreground voice' }));

    expect(screen.getByText('Foreground voice companion')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Text note' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Text note' }));

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(screen.getByText('Text note on current anchor')).toBeTruthy();
    expect(textbox.value).toBe('Draft stays bounded');
  });

  it('persists bounded shell settings and can keep fresh replies unread instead of auto-opening the bubble', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Shell settings' }));

    fireEvent.click(screen.getByLabelText('Always on top'));
    expect(screen.getByText('Floating shell')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Auto-open new replies'));

    const persisted = JSON.parse(window.localStorage.getItem('nimi.avatar.shell-settings.v1') || '{}') as Record<string, unknown>;
    expect(persisted).toEqual(expect.objectContaining({
      schemaVersion: 1,
      alwaysOnTop: false,
      bubbleAutoOpen: false,
    }));

    await act(async () => {
      useAvatarStore.getState().setBundle({
        ...useAvatarStore.getState().bundle!,
        custom: {
          ...useAvatarStore.getState().bundle!.custom,
          latest_committed_message_id: 'msg-hidden',
          latest_committed_turn_id: 'turn-hidden',
          latest_committed_message_text: 'Unread reply stays quiet.',
          latest_committed_message_at: '2026-04-22T00:00:06.000Z',
        },
      });
    });

    expect(screen.getByTestId('avatar-shell').className).toContain('avatar-shell--ambient-unread');
    expect(screen.getByTestId('avatar-stage').className).toContain('avatar-stage--attention-unread');
    expect(screen.getByTestId('avatar-trigger-row').className).toContain('avatar-companion-trigger-row--unread');
    expect(screen.getByRole('button', { name: 'Open avatar companion input' }).className).toContain('avatar-companion-trigger--unread');
    expect(screen.queryByText('Latest anchor reply')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open avatar companion input' }));
    expect(await screen.findByText('Unread reply stays quiet.')).toBeTruthy();
  });

  it('surfaces shell controls as admitted local settings only', async () => {
    seedReadyState();
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Shell controls')).toBeTruthy();
    expect(screen.getByText('Four avatar-shell behaviors only. Launch and runtime stay upstream.')).toBeTruthy();
    expect(screen.getByText('Window stack')).toBeTruthy();
    expect(screen.getByText('Fresh replies')).toBeTruthy();
    expect(screen.getByText('Quiet bubble')).toBeTruthy();
    expect(screen.getByText('Foreground voice captions')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Shell settings' }));

    expect(screen.getByText('Window behavior')).toBeTruthy();
    expect(screen.getByText('Companion bubble')).toBeTruthy();
    expect(screen.getByText('Foreground voice')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.queryByRole('checkbox', { name: /background voice/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /transcript history/i })).toBeNull();
  });

  it('updates shell-control effect copy when admitted toggles change', async () => {
    seedReadyState();
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Open immediately inside the companion')).toBeTruthy();
    expect(screen.getByText('Visible during foreground turns')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Shell settings' }));
    fireEvent.click(screen.getByLabelText('Auto-open new replies'));
    fireEvent.click(screen.getByLabelText('Show voice captions'));

    expect(screen.getByText('Hold as an unread cue until you open them')).toBeTruthy();
    expect(screen.getByText('Hidden while continuity stays truthful')).toBeTruthy();
  });

  it('can hide bounded foreground voice captions without changing voice continuity truth', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Shell settings' }));
    fireEvent.click(screen.getByLabelText('Show voice captions'));

    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send voice' }));

    await waitFor(() => {
      expect(handle.submitVoiceCaptureTurn).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/Voice captions are hidden in this shell's settings/i)).toBeTruthy();
    expect(screen.queryByText('You said')).toBeNull();
    expect(screen.queryByText('Voice hello')).toBeNull();
  });

  it('clears local bubble, draft, and echo state when the same agent rebinds to a different anchor', async () => {
    seedReadyState();
    useAvatarStore.getState().setBundle({
      ...useAvatarStore.getState().bundle!,
      custom: {
        ...useAvatarStore.getState().bundle!.custom,
        latest_committed_message_id: 'msg-a',
        latest_committed_turn_id: 'turn-a',
        latest_committed_message_text: 'Anchor A reply',
        latest_committed_message_at: '2026-04-22T00:00:02.000Z',
      },
    });
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar companion input' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar companion input' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Anchor A echo' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() => {
      expect(handle.requestTextTurn).toHaveBeenCalledWith({
        agentId: 'agent-product-01',
        conversationAnchorId: 'anchor-01',
        text: 'Anchor A echo',
      });
    });
    expect(screen.getByText('Anchor A reply')).toBeTruthy();
    expect(screen.getByText('You: Anchor A echo')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Text note' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft for anchor A' } });

    await act(async () => {
      useAvatarStore.getState().setRuntimeBinding({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        agentId: 'agent-product-01',
        worldId: 'world-01',
      });
      useAvatarStore.getState().setLaunchContext(launchContext({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
      }));
      useAvatarStore.getState().setBundle({
        ...useAvatarStore.getState().bundle!,
        status_text: 'Anchor B is now active.',
        custom: {
          agent_id: 'agent-product-01',
          conversation_anchor_id: 'anchor-02',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('Anchor A reply')).toBeNull();
    });
    expect(screen.queryByText('You: Anchor A echo')).toBeNull();
    expect(screen.queryByDisplayValue('Draft for anchor A')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open avatar companion input' }));
    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textbox.value).toBe('');
  });

  it('does not reveal companion input when runtime binding is unavailable', async () => {
    seedReadyState();
    useAvatarStore.getState().clearRuntimeBinding();
    useAvatarStore.getState().setDriverStatus('stopped');
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByText('Interaction unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open avatar companion input' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open avatar voice companion' })).toBeNull();
  });

  it('keeps voice unavailable fail-closed inside the shared companion grammar', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    handle.getVoiceInputAvailability = vi.fn(async () => ({
      available: false,
      reason: 'Microphone use is blocked for this anchor.',
    }));
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar voice companion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));

    expect(await screen.findByText('Foreground voice unavailable')).toBeTruthy();
    expect(screen.getByText('Microphone use is blocked for this anchor.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Voice unavailable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(handle.startVoiceCapture).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Text note' }));
    expect(screen.getByText('Text note on current anchor')).toBeTruthy();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('damps embodied reaction classes when the shell is not ready', async () => {
    seedReadyState();
    useAvatarStore.getState().clearRuntimeBinding();
    useAvatarStore.getState().setDriverStatus('stopped');
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Interaction unavailable')).toBeTruthy();
    const shell = screen.getByTestId('avatar-shell');
    const stage = screen.getByTestId('avatar-stage');

    expect(shell.className).toContain('avatar-shell--ambient-damped');
    expect(stage.className).toContain('avatar-stage--attention-muted');

    fireEvent.pointerEnter(stage);
    fireEvent.pointerDown(stage, { button: 0 });

    expect(stage.className).not.toContain('avatar-stage--body-hover');
    expect(stage.className).not.toContain('avatar-stage--pointer-contact');
    expect(stage.className).not.toContain('avatar-stage--focus-visible');
  });

  it('keeps foreground voice truthful: pending before authoritative reply activity, bounded captions, and gated interrupt', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar voice companion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));

    expect(screen.getByText('Foreground voice companion')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Text note' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Foreground voice' })).toBeTruthy();
    expect(screen.getByText(/No wake-word, no background continuation/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));

    await waitFor(() => {
      expect(handle.startVoiceCapture).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent-product-01',
        conversationAnchorId: 'anchor-01',
      }));
    });
    expect(screen.getByText('Listening on current anchor')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Send voice' }));

    await waitFor(() => {
      expect(handle.submitVoiceCaptureTurn).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent-product-01',
        conversationAnchorId: 'anchor-01',
        mimeType: 'audio/webm',
      }));
    });
    expect(await screen.findByText('You said')).toBeTruthy();
    expect(screen.getByText('Voice hello')).toBeTruthy();
    expect(screen.getByText('Reply pending on current anchor')).toBeTruthy();
    expect(screen.queryByText('Speaking on current anchor')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull();

    await act(async () => {
      useAvatarStore.getState().setBundle({
        ...useAvatarStore.getState().bundle!,
        custom: {
          ...useAvatarStore.getState().bundle!.custom,
          active_turn_id: 'turn-voice-1',
          active_turn_stream_id: 'stream-voice-1',
          active_turn_phase: 'streaming',
          active_turn_text: 'Live bounded reply',
          active_turn_updated_at: '2026-04-22T00:00:08.000Z',
        },
      });
    });

    expect(await screen.findByText('Reply active on current anchor')).toBeTruthy();
    expect(await screen.findByText('Assistant (live)')).toBeTruthy();
    expect(screen.getByText('Live bounded reply')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Interrupt' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }));

    await waitFor(() => {
      expect(handle.interruptTurn).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent-product-01',
        conversationAnchorId: 'anchor-01',
        turnId: 'turn-voice-1',
      }));
    });

    await act(async () => {
      useAvatarStore.getState().setBundle({
        ...useAvatarStore.getState().bundle!,
        custom: {
          ...useAvatarStore.getState().bundle!.custom,
          last_turn_terminal_phase: 'interrupted',
          last_turn_terminal_id: 'turn-voice-1',
          last_turn_terminal_at: '2026-04-22T00:00:09.000Z',
          last_turn_terminal_reason: 'avatar_voice_interrupt',
          last_interrupted_turn_id: 'turn-voice-1',
        },
      });
    });

    expect(screen.getByText('Current anchor reply interrupted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Listen again' })).toBeTruthy();
  });

  it('keeps active-reply truth when closing voice mode back to summary grammar', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar voice companion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send voice' }));

    await waitFor(() => {
      expect(handle.submitVoiceCaptureTurn).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      useAvatarStore.getState().setBundle({
        ...useAvatarStore.getState().bundle!,
        custom: {
          ...useAvatarStore.getState().bundle!.custom,
          active_turn_id: 'turn-voice-active',
          active_turn_stream_id: 'stream-voice-active',
          active_turn_phase: 'streaming',
          active_turn_text: 'Live active reply stays truthful.',
          active_turn_updated_at: '2026-04-22T00:00:08.000Z',
        },
      });
    });

    expect(await screen.findByText('Reply active on current anchor')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close voice' }));

    expect(screen.getByText('Reply active on current anchor')).toBeTruthy();
    expect(screen.getByText('Live active reply stays truthful.')).toBeTruthy();
    expect(screen.queryByText('Waiting on current anchor')).toBeNull();
    expect(screen.queryByText('Reply pending on current anchor')).toBeNull();
  });

  it('keeps summary grammar honest when active turn evidence already exists', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar companion input' })).toBeTruthy();

    await act(async () => {
      useAvatarStore.getState().setBundle({
        ...useAvatarStore.getState().bundle!,
        custom: {
          ...useAvatarStore.getState().bundle!.custom,
          latest_committed_message_id: 'msg-active-summary',
          latest_committed_turn_id: 'turn-active-summary',
          latest_committed_message_text: 'Latest committed cue is visible.',
          latest_committed_message_at: '2026-04-22T00:00:10.000Z',
          active_turn_id: 'turn-active-summary',
          active_turn_stream_id: 'stream-active-summary',
          active_turn_phase: 'streaming',
          active_turn_text: 'Summary still shows active reply truth.',
          active_turn_updated_at: '2026-04-22T00:00:11.000Z',
        },
      });
    });

    expect(await screen.findByText('Reply active on current anchor')).toBeTruthy();
    expect(screen.getByText('Summary still shows active reply truth.')).toBeTruthy();
    expect(screen.queryByText('Waiting on current anchor')).toBeNull();
    expect(screen.queryByText('Reply pending on current anchor')).toBeNull();
  });

  it('ignores stale capture resolution after the same agent rebinds to a different anchor', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    const cancelMock = vi.fn();
    const captureDeferred = createDeferred<Awaited<ReturnType<BootstrapHandle['startVoiceCapture']>>>();
    handle.startVoiceCapture = vi.fn(() => captureDeferred.promise);
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar voice companion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
    expect(await screen.findByText('Listening on current anchor')).toBeTruthy();

    await act(async () => {
      useAvatarStore.getState().setRuntimeBinding({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        agentId: 'agent-product-01',
        worldId: 'world-01',
      });
      useAvatarStore.getState().setLaunchContext(launchContext({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
      }));
      useAvatarStore.getState().setBundle({
        ...useAvatarStore.getState().bundle!,
        custom: {
          agent_id: 'agent-product-01',
          conversation_anchor_id: 'anchor-02',
        },
      });
    });

    await act(async () => {
      captureDeferred.resolve({
        stop: vi.fn(async () => ({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'audio/webm',
        })),
        cancel: cancelMock,
      });
      await Promise.resolve();
    });

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Listening on current anchor')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));
    expect(screen.getByText('Foreground voice companion')).toBeTruthy();
    expect(screen.queryByText('You said')).toBeNull();
  });

  it('ignores stale transcript completion after anchor rebind during transcribing', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    const submitDeferred = createDeferred<{ transcript: string }>();
    handle.submitVoiceCaptureTurn = vi.fn(() => submitDeferred.promise);
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar voice companion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send voice' }));

    await waitFor(() => {
      expect(handle.submitVoiceCaptureTurn).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Transcribing current anchor audio')).toBeTruthy();

    await act(async () => {
      useAvatarStore.getState().setRuntimeBinding({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        agentId: 'agent-product-01',
        worldId: 'world-01',
      });
      useAvatarStore.getState().setLaunchContext(launchContext({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
      }));
      useAvatarStore.getState().setBundle({
        ...useAvatarStore.getState().bundle!,
        custom: {
          agent_id: 'agent-product-01',
          conversation_anchor_id: 'anchor-02',
        },
      });
    });

    await act(async () => {
      submitDeferred.resolve({ transcript: 'Stale transcript from anchor A' });
      await Promise.resolve();
    });

    expect(screen.queryByText('Stale transcript from anchor A')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));
    expect(screen.getByText('Foreground voice companion')).toBeTruthy();
    expect(screen.queryByText('You said')).toBeNull();
  });

  it('drops old reply and live caption when binding changes before stale bundle cues are cleared', async () => {
    seedReadyState();
    useAvatarStore.getState().setBundle({
      ...useAvatarStore.getState().bundle!,
      custom: {
        ...useAvatarStore.getState().bundle!.custom,
        latest_committed_message_id: 'msg-old',
        latest_committed_turn_id: 'turn-old',
        latest_committed_message_text: 'Old anchor reply must stay closed.',
        latest_committed_message_at: '2026-04-22T00:00:02.000Z',
        active_turn_id: 'turn-live-old',
        active_turn_stream_id: 'stream-live-old',
        active_turn_phase: 'streaming',
        active_turn_text: 'Old live caption must stay closed.',
        active_turn_updated_at: '2026-04-22T00:00:03.000Z',
      },
    });
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByText('Reply active on current anchor')).toBeTruthy();
    expect(screen.getByText('Old live caption must stay closed.')).toBeTruthy();

    await act(async () => {
      useAvatarStore.getState().setRuntimeBinding({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        agentId: 'agent-product-01',
        worldId: 'world-01',
      });
      useAvatarStore.getState().setLaunchContext(launchContext({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
      }));
    });

    expect(screen.queryByText('Old anchor reply must stay closed.')).toBeNull();
    expect(screen.queryByText('Old live caption must stay closed.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open avatar companion input' }));
    expect(screen.queryByText('Old anchor reply must stay closed.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));
    expect(screen.queryByText('Assistant (live)')).toBeNull();
    expect(screen.queryByText('Old live caption must stay closed.')).toBeNull();
  });

  it('ignores late voice completion after the foreground companion is torn down', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    const submitDeferred = createDeferred<{ transcript: string }>();
    handle.submitVoiceCaptureTurn = vi.fn(() => submitDeferred.promise);
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar voice companion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send voice' }));

    await waitFor(() => {
      expect(handle.submitVoiceCaptureTurn).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Transcribing current anchor audio')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse companion bubble' }));
    expect(screen.queryByText('Transcribing current anchor audio')).toBeNull();

    await act(async () => {
      submitDeferred.resolve({ transcript: 'Late transcript should not surface' });
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));
    expect(screen.getByText('Foreground voice companion')).toBeTruthy();
    expect(screen.queryByText('Late transcript should not surface')).toBeNull();
    expect(screen.queryByText('You said')).toBeNull();
  });

  it('shows an explicit relaunch notice when desktop updates the launch context', async () => {
    tauriRuntime = true;
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar companion input' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft before rebind' } });

    await act(async () => {
      launchContextUpdatedHandler?.(launchContext({
        agentId: 'agent-product-02',
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
      }));
    });

    expect(screen.getAllByText('Desktop update received').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Runtime interaction stays closed/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Reload shell now')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload shell' })).toBeNull();
    expect(screen.getByText(/Local draft, unread cue, and foreground voice capture or caption state clear/i)).toBeTruthy();
    expect(screen.getByText(/Does not invent runtime fallback inside the avatar app/i)).toBeTruthy();
    expect(screen.queryByDisplayValue('Draft before rebind')).toBeNull();
    expect(screen.queryByText('Desktop companion ready')).toBeNull();
    expect(screen.queryByText('Runtime IPC')).toBeNull();
    expect(screen.queryByText(/Bound \(anchor-01\)/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reload shell now' }));
    expect(reloadAvatarShellMock).toHaveBeenCalledTimes(1);
  });

  it('keeps shell-local setting failures inside reload-only guidance', async () => {
    tauriRuntime = true;
    seedReadyState();
    setAlwaysOnTopMock.mockRejectedValueOnce(new Error('native toggle failed'));
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Desktop companion ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Shell settings' }));
    fireEvent.click(screen.getByLabelText('Always on top'));

    expect(await screen.findByText(/Unable to update always-on-top right now: native toggle failed/i)).toBeTruthy();
    expect(screen.getByText('Reload this shell to reopen a clean shell-local settings surface for the admitted controls only.')).toBeTruthy();
    expect(screen.getByText('Reopens a clean surface for the four admitted avatar-shell-local controls.')).toBeTruthy();
    expect(screen.getByText('Does not bypass desktop launch or runtime requirements.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload shell' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload shell now' })).toBeTruthy();
  });

  it('renders a productized launch error without inventing fallback', async () => {
    bootstrapAvatarMock.mockRejectedValue(
      new Error('avatar launch context is required; launch from desktop orchestrator'),
    );

    render(<App />);

    expect(await screen.findByText('Launch from desktop')).toBeTruthy();
    expect(screen.getAllByText(/No standalone agent fallback was used/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Start the avatar again from the desktop orchestrator.').length).toBeGreaterThan(0);
  });

  it('renders a degraded runtime-unbound surface after bootstrap succeeds', async () => {
    seedReadyState();
    useAvatarStore.getState().clearRuntimeBinding();
    useAvatarStore.getState().setDriverStatus('stopped');
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Interaction unavailable')).toBeTruthy();
    expect(screen.getAllByText(/runtime interaction stream is not currently bound/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Runtime unavailable').length).toBeGreaterThan(0);
    expectNonReadySurface();
  });

  it('renders loading state with pending handoff instead of fake bound status', () => {
    bootstrapAvatarMock.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(screen.getByText('Preparing your desktop companion')).toBeTruthy();
    expect(screen.getAllByText('Warming up').length).toBeGreaterThan(0);
    expect(screen.getByText('Pending handoff')).toBeTruthy();
    expect(screen.getByText('Not bound')).toBeTruthy();
    expectNonReadySurface();
  });

  it('renders runtime blocked startup without showing a bound carrier', async () => {
    bootstrapAvatarMock.mockRejectedValue(new Error('runtime daemon failed hard'));

    render(<App />);

    expect(await screen.findByText('Runtime connection blocked')).toBeTruthy();
    expect(screen.getAllByText(/does not switch to mock mode/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Runtime unavailable').length).toBeGreaterThan(0);
    expectNonReadySurface();
  });

  it('renders model error as degraded and unbound', async () => {
    seedReadyState();
    useAvatarStore.getState().setModelError('model package missing runtime/model3.json');
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Embodiment surface paused')).toBeTruthy();
    expect(screen.getByText('Surface blocked')).toBeTruthy();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expectNonReadySurface();
  });

  it('renders driver stopped state without fake presence or operator defaults', async () => {
    seedReadyState();
    useAvatarStore.getState().setDriverStatus('stopped');
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Interaction unavailable')).toBeTruthy();
    expect(screen.getByText('Runtime unavailable')).toBeTruthy();
    expectNonReadySurface();
  });

  it('renders driver error state without fake presence or operator defaults', async () => {
    seedReadyState();
    useAvatarStore.getState().setDriverStatus('error');
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Interaction unavailable')).toBeTruthy();
    expect(screen.getByText('Driver error')).toBeTruthy();
    expectNonReadySurface();
  });

  it('renders explicit fixture mode without pretending to be runtime-bound', async () => {
    useAvatarStore.getState().markShellReady({ width: 360, height: 640 });
    useAvatarStore.getState().setConsumeMode({
      mode: 'mock',
      authority: 'fixture',
      fixtureId: 'default',
      fixturePlaying: true,
    });
    useAvatarStore.getState().setDriverStatus('running');
    useAvatarStore.getState().setBundle({
      posture: {
        posture_class: 'baseline_observer',
        action_family: 'observe',
        interrupt_mode: 'welcome',
        transition_reason: 'fixture',
        truth_basis_ids: [],
      },
      activity: {
        name: 'scenario_loop',
        category: 'state',
        intensity: 'weak',
        source: 'mock',
      },
      status_text: 'Fixture scenario is active.',
      execution_state: 'IDLE',
      active_world_id: 'world-fixture',
      active_user_id: 'fixture-user',
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
        now: new Date('2026-04-22T00:00:00.000Z').toISOString(),
        session_id: 'fixture-session',
        locale: 'en-US',
      },
    });
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Fixture companion ready')).toBeTruthy();
    expect(screen.getByText('Fixture surface (default)')).toBeTruthy();
    expect(screen.getByText('Presence script')).toBeTruthy();
    expect(screen.getByText('Operator scope')).toBeTruthy();
    expect(screen.getAllByText('Not bound').length).toBeGreaterThan(0);
    expect(screen.queryByText('Runtime binding')).toBeNull();
    expect(screen.queryByText('Runtime IPC')).toBeNull();
  });
});
