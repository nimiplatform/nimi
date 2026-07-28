// App.tsx shell composition integration tests.
// Per rules rule.nimi.avatar.embodiment.r021 and r022, the shell renders one of:
// embodiment-stage under ready, or degraded-surface
// under loading / degraded:* / error:* / relaunch-pending.

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

function seedMockDriverWithRuntimeBinding(): void {
  useAvatarStore.getState().markShellReady({ width: 360, height: 640 });
  useAvatarStore.getState().setConsumeMode({
    mode: 'mock',
    authority: 'fixture',
    fixtureId: 'default',
    fixturePlaying: true,
  });
  useAvatarStore.getState().setLaunchContext(launchContext());
  useAvatarStore.getState().setRuntimeBinding({
    avatarInstanceId: 'avatar-instance-01',
    conversationAnchorId: 'anchor-01',
    agentId: 'local-agent:owner-product:agent-product-01',
    worldId: 'world-mock-default',
  });
  useAvatarStore.getState().setDriverStatus('running');
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
    agentId: 'fixture-agent-default',
    worldId: 'world-mock-default',
  });
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

  it('keeps mock driver selection inside the standard ready lifecycle', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedMockDriverWithRuntimeBinding();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
    });
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition')).toBe('ready');
  });

  it('does not let mock driver selection bypass the Runtime binding', async () => {
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedMockDriverWithoutRuntimeBinding();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-degraded-surface')).toBeTruthy();
    });
    expect(screen.queryByTestId('avatar-embodiment-stage')).toBeNull();
    expect(screen.queryByTestId('avatar-companion-surface')).toBeNull();
    expect(screen.getByTestId('avatar-root').getAttribute('data-composition'))
      .toBe('degraded_runtime_unavailable');
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
    setTauriRuntime(true);
    bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());

    render(<App />);

    act(() => {
      seedReadyState();
    });

    await waitFor(() => {
      expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
    });

    await waitFor(() => {
      expect(hasLaunchContextUpdatedHandler()).toBe(true);
    });

    act(() => {
      emitLaunchContextUpdated({
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
