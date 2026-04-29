// Wave 2 — Avatar shell visual snapshot tests.
// Per feature-matrix.yaml wave_2.scope.snapshot_visual_tests this file freezes
// the rendered structure of the three composition states (ready / degraded
// runtime / relaunch pending) so that BEM class drift, token migration, or
// i18n key rename is caught at CI.
//
// Snapshots are container.firstChild HTML — that is the avatar-root + its
// child surfaces with all data-testid + className anchors. Live2D canvas is
// mocked to null (tested separately via carrier-visual-acceptance-contract).

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { useAvatarStore } from './app-shell/app-store.js';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';

const bootstrapAvatarMock = vi.fn<() => Promise<BootstrapHandle>>();

vi.mock('./app-shell/app-bootstrap.js', () => ({
  bootstrapAvatar: () => bootstrapAvatarMock(),
}));

vi.mock('./app-shell/avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: vi.fn(),
}));

vi.mock('./app-shell/tauri-commands.js', () => ({
  startWindowDrag: vi.fn(),
  setIgnoreCursorEvents: vi.fn(),
  constrainWindowToVisibleArea: vi.fn(),
  setAlwaysOnTop: vi.fn(async () => undefined),
}));

vi.mock('./app-shell/tauri-lifecycle.js', () => ({
  isTauriRuntime: () => false,
  onLaunchContextUpdated: () => Promise.resolve(() => {}),
}));

vi.mock('./shell-reload.js', () => ({
  reloadAvatarShell: vi.fn(),
}));

vi.mock('./live2d/Live2DCarrierVisualSurface.js', () => ({
  Live2DCarrierVisualSurface: () => null,
}));

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
    startVoiceCapture: vi.fn(),
    submitVoiceCaptureTurn: vi.fn(),
    interruptTurn: vi.fn(async () => {}),
    requestTextTurn: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  } as unknown as BootstrapHandle;
}

function seedReady(): void {
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
    launchSource: 'desktop-avatar-launcher',
  });
  useAvatarStore.getState().setDriverStatus('running');
}

function seedDegradedRuntimeUnavailable(): void {
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
  useAvatarStore.getState().setLaunchContext({
    agentId: 'agent-product-01',
    avatarInstanceId: 'avatar-instance-01',
    launchSource: 'desktop-avatar-launcher',
  });
  useAvatarStore.getState().setDriverStatus('stopped');
}

beforeEach(() => {
  useAvatarStore.setState(useAvatarStore.getInitialState(), true);
  bootstrapAvatarMock.mockReset();
  bootstrapAvatarMock.mockResolvedValue(createBootstrapHandle());
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Avatar shell visual snapshots', () => {
  it('ready surface (embodiment-stage + companion-surface)', async () => {
    const { container, findByTestId } = render(<App />);
    act(() => {
      seedReady();
    });
    await findByTestId('avatar-companion-surface');
    expect(container.firstChild).toMatchSnapshot();
  });

  it('degraded surface — runtime unavailable', async () => {
    const { container, findByTestId } = render(<App />);
    act(() => {
      seedDegradedRuntimeUnavailable();
    });
    await findByTestId('avatar-degraded-surface');
    expect(container.firstChild).toMatchSnapshot();
  });

  it('degraded surface — relaunch pending (rejects bootstrap fatal flow)', async () => {
    bootstrapAvatarMock.mockRejectedValueOnce(
      new Error('untyped bootstrap failure during snapshot test'),
    );
    const { container, findByTestId } = render(<App />);
    await findByTestId('avatar-degraded-surface');
    expect(container.firstChild).toMatchSnapshot();
  });
});
