// Wave 1 — App.tsx three-surface integration tests.
// Per app-shell-contract.md NAV-SHELL-COMPOSITION-* the shell renders exactly
// one of: (embodiment-stage + companion-surface) under ready / fixture_active,
// or degraded-surface under loading / degraded:* / error:* / relaunch-pending.

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
let launchContextUpdatedHandler:
  | ((payload: { agentId: string; avatarInstanceId: string | null; launchSource: string | null }) => void)
  | null = null;

function launchContext(overrides: Partial<{
  agentId: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
}> = {}) {
  return {
    agentId: 'agent-product-01',
    avatarInstanceId: 'avatar-instance-01',
    launchSource: 'desktop-avatar-launcher',
    ...overrides,
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
    carrier: { backendSession: null, shutdown: vi.fn() },
    getVoiceInputAvailability: vi.fn(async () => ({ available: true, reason: null })),
    startVoiceCapture: vi.fn(async () => ({
      stop: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm' })),
      cancel: vi.fn(),
    })),
    submitVoiceCaptureTurn: vi.fn(async () => ({ transcript: 'voice hello' })),
    interruptTurn: vi.fn(async () => {}),
    requestTextTurn: vi.fn(async () => {}),
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
    agentId: 'agent-product-01',
    worldId: 'world-01',
  });
  useAvatarStore.getState().setLaunchContext(launchContext());
  useAvatarStore.getState().setDriverStatus('running');
}

function seedFixtureState(): void {
  useAvatarStore.getState().markShellReady({ width: 360, height: 640 });
  useAvatarStore.getState().setConsumeMode({
    mode: 'mock',
    authority: 'fixture',
    fixtureId: 'default',
    fixturePlaying: true,
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
    reason: 'runtime_scoped_binding: APP_GRANT_INVALID',
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

beforeEach(() => {
  useAvatarStore.setState(useAvatarStore.getInitialState(), true);
  bootstrapAvatarMock.mockReset();
  startWindowDragMock.mockReset();
  setIgnoreCursorEventsMock.mockReset();
  constrainWindowToVisibleAreaMock.mockReset();
  setAlwaysOnTopMock.mockReset();
  setAlwaysOnTopMock.mockResolvedValue(undefined);
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

describe('App composition state machine', () => {
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

  it('mounts embodiment-stage + companion-surface (mutually visible) under ready composition', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
      expect(screen.getByTestId('avatar-companion-surface')).toBeTruthy();
    });
    expect(screen.queryByTestId('avatar-degraded-surface')).toBeNull();
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition')).toBe('ready');
  });

  it('mounts ready surfaces under fixture_active composition', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedFixtureState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
      expect(screen.getByTestId('avatar-companion-surface')).toBeTruthy();
    });
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition')).toBe('fixture_active');
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
    });
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition')).toBe('error_bootstrap_fatal');
  });

  it('flips to relaunch_pending and unmounts ready surfaces when desktop pushes a new launch context', async () => {
    tauriRuntime = true;
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
    });

    await waitFor(() => {
      expect(launchContextUpdatedHandler).not.toBeNull();
    });

    act(() => {
      launchContextUpdatedHandler?.({
        agentId: 'agent-product-02',
        avatarInstanceId: 'avatar-instance-02',
        launchSource: 'desktop-avatar-launcher',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-degraded-surface')).toBeTruthy();
    });
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition')).toBe('relaunch_pending');
    expect(screen.queryByTestId('avatar-embodiment-stage')).toBeNull();
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
  });

  it('reload button triggers shell reload from degraded surface', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedDegradedRuntime();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-degraded-reload')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('avatar-degraded-reload'));

    expect(reloadAvatarShellMock).toHaveBeenCalledTimes(1);
  });
});

describe('Companion surface interactions (ready)', () => {
  it('composer Enter submits a bounded text turn through bootstrapHandle', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-companion-composer')).toBeTruthy();
    });

    const textarea = screen
      .getByTestId('avatar-companion-composer')
      .querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'hello agent' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(handle.requestTextTurn).toHaveBeenCalledWith({
        agentId: 'agent-product-01',
        conversationAnchorId: 'anchor-01',
        text: 'hello agent',
      });
    });
  });

  it('mic button triggers startVoiceCapture in idle state', async () => {
    const handle = createBootstrapHandle();
    bootstrapAvatarMock.mockResolvedValue(handle);

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-companion-mic')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('avatar-companion-mic'));

    await waitFor(() => {
      expect(handle.startVoiceCapture).toHaveBeenCalledTimes(1);
    });
    const firstCall = (handle.startVoiceCapture as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall?.[0]).toMatchObject({
      agentId: 'agent-product-01',
      conversationAnchorId: 'anchor-01',
    });
  });

  it('settings cog toggles the popover', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-companion-surface')).toBeTruthy();
    });

    expect(screen.queryByTestId('avatar-settings-popover')).toBeNull();

    const cog = screen
      .getByTestId('avatar-companion-surface')
      .querySelector('.avatar-companion-surface__settings') as HTMLButtonElement;
    fireEvent.click(cog);

    await waitFor(() => {
      expect(screen.getByTestId('avatar-settings-popover')).toBeTruthy();
    });

    fireEvent.click(cog);
    await waitFor(() => {
      expect(screen.queryByTestId('avatar-settings-popover')).toBeNull();
    });
  });
});
