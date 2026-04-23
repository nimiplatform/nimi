import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { useAvatarStore } from './app-shell/app-store.js';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';

const bootstrapAvatarMock = vi.fn<() => Promise<BootstrapHandle>>();
const startWindowDragMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
const onLaunchContextUpdatedMock = vi.fn();
const reloadAvatarShellMock = vi.fn();
let tauriRuntime = false;
let launchContextUpdatedHandler: ((payload: {
  agentId: string;
  avatarInstanceId: string;
  conversationAnchorId: string | null;
  anchorMode: 'existing' | 'open_new';
  launchedBy: string;
  sourceSurface: string | null;
}) => void) | null = null;

vi.mock('./app-shell/app-bootstrap.js', () => ({
  bootstrapAvatar: () => bootstrapAvatarMock(),
}));

vi.mock('./app-shell/tauri-commands.js', () => ({
  startWindowDrag: () => startWindowDragMock(),
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
  useAvatarStore.getState().setLaunchContext({
    agentId: 'agent-product-01',
    avatarInstanceId: 'avatar-instance-01',
    conversationAnchorId: 'anchor-01',
    anchorMode: 'existing',
    launchedBy: 'desktop',
    sourceSurface: 'desktop-avatar-launcher',
  });
  useAvatarStore.getState().setAuthSession(
    {
      id: 'user-01',
      displayName: 'Nimi Operator',
      email: 'nimi@example.com',
    },
    'access-token',
    'refresh-token',
  );
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
  expect(screen.queryByText('Bound operator')).toBeNull();
  expect(screen.queryByText('Current presence')).toBeNull();
  expect(screen.queryByText('Runtime bound')).toBeNull();
  expect(screen.queryByText(/Bound \(/)).toBeNull();
}

describe('App surface foundation', () => {
  beforeEach(() => {
    useAvatarStore.setState(useAvatarStore.getInitialState(), true);
    bootstrapAvatarMock.mockReset();
    startWindowDragMock.mockReset();
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
    expect(screen.queryByText(/shell:/i)).toBeNull();
    expect(screen.queryByText(/driver:/i)).toBeNull();
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

    expect(screen.getByText('Latest anchor reply')).toBeTruthy();
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

    expect(screen.queryByText('Latest anchor reply')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open avatar companion input' }));
    expect(await screen.findByText('Unread reply stays quiet.')).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft for anchor A' } });

    await act(async () => {
      useAvatarStore.getState().setRuntimeBinding({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        agentId: 'agent-product-01',
        worldId: 'world-01',
      });
      useAvatarStore.getState().setLaunchContext({
        agentId: 'agent-product-01',
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        anchorMode: 'existing',
        launchedBy: 'desktop',
        sourceSurface: 'desktop-avatar-launcher',
      });
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

  it('does not reveal companion input when runtime trust is unavailable', async () => {
    seedReadyState();
    useAvatarStore.getState().clearAuthSession('shared_session_missing');
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByText('Desktop session ended')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open avatar companion input' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open avatar voice companion' })).toBeNull();
  });

  it('keeps foreground voice truthful: pending before authoritative reply activity, bounded captions, and gated interrupt', async () => {
    seedReadyState();
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Open avatar voice companion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open avatar voice companion' }));

    expect(screen.getByText('Foreground voice companion')).toBeTruthy();
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
      useAvatarStore.getState().setLaunchContext({
        agentId: 'agent-product-01',
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        anchorMode: 'existing',
        launchedBy: 'desktop',
        sourceSurface: 'desktop-avatar-launcher',
      });
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
      useAvatarStore.getState().setLaunchContext({
        agentId: 'agent-product-01',
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        anchorMode: 'existing',
        launchedBy: 'desktop',
        sourceSurface: 'desktop-avatar-launcher',
      });
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

    expect(await screen.findByText('Old anchor reply must stay closed.')).toBeTruthy();

    await act(async () => {
      useAvatarStore.getState().setRuntimeBinding({
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        agentId: 'agent-product-01',
        worldId: 'world-01',
      });
      useAvatarStore.getState().setLaunchContext({
        agentId: 'agent-product-01',
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        anchorMode: 'existing',
        launchedBy: 'desktop',
        sourceSurface: 'desktop-avatar-launcher',
      });
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

    await act(async () => {
      launchContextUpdatedHandler?.({
        agentId: 'agent-product-02',
        avatarInstanceId: 'avatar-instance-02',
        conversationAnchorId: 'anchor-02',
        anchorMode: 'existing',
        launchedBy: 'desktop',
        sourceSurface: 'desktop-avatar-launcher',
      });
    });

    expect(screen.getAllByText('Desktop update received').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Runtime and auth truth stay fail-closed/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Desktop companion ready')).toBeNull();
    expect(screen.queryByText('Runtime bound')).toBeNull();
    expect(screen.queryByText(/Bound \(anchor-01\)/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    expect(reloadAvatarShellMock).toHaveBeenCalledTimes(1);
  });

  it('renders a productized launch error without inventing fallback', async () => {
    bootstrapAvatarMock.mockRejectedValue(
      new Error('avatar launch context is required; launch from desktop orchestrator'),
    );

    render(<App />);

    expect(await screen.findByText('Launch from desktop')).toBeTruthy();
    expect(screen.getByText(/No standalone agent fallback was used/i)).toBeTruthy();
    expect(screen.getAllByText('Start the avatar again from the desktop orchestrator.').length).toBeGreaterThan(0);
  });

  it('renders a degraded session-lost surface after bootstrap succeeds', async () => {
    seedReadyState();
    useAvatarStore.getState().clearAuthSession('shared_session_missing');
    useAvatarStore.getState().setDriverStatus('stopped');
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Desktop session ended')).toBeTruthy();
    expect(screen.getByText(/shared desktop session disappeared/i)).toBeTruthy();
    expect(screen.getAllByText('Reopen the avatar from desktop after signing in again.').length).toBeGreaterThan(0);
    expect(screen.getByText('Binding closed')).toBeTruthy();
    expectNonReadySurface();
  });

  it('renders loading state with pending handoff instead of fake bound status', () => {
    bootstrapAvatarMock.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(screen.getByText('Preparing your desktop companion')).toBeTruthy();
    expect(screen.getByText('Pending handoff')).toBeTruthy();
    expect(screen.getByText('Not bound')).toBeTruthy();
    expectNonReadySurface();
  });

  it('renders runtime blocked startup without showing a bound carrier', async () => {
    bootstrapAvatarMock.mockRejectedValue(new Error('runtime daemon failed hard'));

    render(<App />);

    expect(await screen.findByText('Runtime connection blocked')).toBeTruthy();
    expect(screen.getByText(/did not switch to mock mode/i)).toBeTruthy();
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

    expect(await screen.findByText('Companion stream paused')).toBeTruthy();
    expect(screen.getByText('Driver stopped')).toBeTruthy();
    expectNonReadySurface();
  });

  it('renders driver error state without fake presence or operator defaults', async () => {
    seedReadyState();
    useAvatarStore.getState().setDriverStatus('error');
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    expect(await screen.findByText('Companion stream paused')).toBeTruthy();
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
    expect(screen.queryByText('Bound operator')).toBeNull();
    expect(screen.queryByText('Runtime bound')).toBeNull();
  });
});
