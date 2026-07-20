import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, DriverStatus } from '../driver/types.js';
import { useAvatarStore } from './app-store.js';

let driverKind: 'sdk' | 'mock' = 'sdk';
const createDriverMock = vi.fn();
const loadSelectedMockScenarioFixtureMock = vi.fn();
const driverStartMock = vi.fn();
const driverStopMock = vi.fn();
const recordAvatarEvidenceEventuallyMock = vi.fn();

vi.mock('../driver/factory.js', () => ({
  resolveDriverKind: () => driverKind,
  createDriver: (...args: unknown[]) => createDriverMock(...args),
}));

vi.mock('../settings-state.js', () => ({
  readAvatarShellSettings: () => ({ alwaysOnTop: true }),
}));

vi.mock('./app-bootstrap-helpers.js', () => ({
  installAvatarRuntimeBridge: () => ({ installed: false, reason: 'standard-host-preload-required' }),
  loadSelectedMockScenarioFixture: (...args: unknown[]) => loadSelectedMockScenarioFixtureMock(...args),
  readNormalizedString: (value: unknown) => typeof value === 'string' ? value.trim() : '',
}));

vi.mock('./app-bootstrap-first-party-diagnostics.js', () => ({
  runFirstPartyStage: async <T>(_stage: string, operation: () => Promise<T>) => operation(),
  runFirstPartyStageWithTimeout: async <T>(
    _stage: string,
    _timeoutMs: number,
    operation: () => Promise<T>,
  ) => operation(),
  recordDriverStartFailure: vi.fn(),
}));

vi.mock('./device-tier-detector.js', () => ({
  detectDeviceTier: () => ({
    tier: 'A',
    reason: 'test',
    rendererString: 'test renderer',
    webglAvailable: true,
  }),
}));

vi.mock('./tauri-lifecycle.js', () => ({
  isTauriRuntime: () => false,
  onShellReady: vi.fn(),
}));

vi.mock('./tauri-commands.js', () => ({
  setAlwaysOnTop: vi.fn(),
}));

vi.mock('./avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: (...args: unknown[]) => recordAvatarEvidenceEventuallyMock(...args),
}));

function createMockDriver(): AgentDataDriver {
  let status: DriverStatus = 'idle';
  let statusHandler: ((next: DriverStatus) => void) | null = null;
  return {
    kind: 'mock',
    get status() {
      return status;
    },
    getBundle: () => ({}) as AgentDataBundle,
    async start() {
      driverStartMock();
      status = 'running';
      statusHandler?.(status);
    },
    async stop() {
      driverStopMock();
      status = 'stopped';
      statusHandler?.(status);
    },
    onEvent: () => () => {},
    onBundleChange: () => () => {},
    onStatusChange(handler) {
      statusHandler = handler;
      return () => {
        statusHandler = null;
      };
    },
    emit: () => {},
  };
}

describe('bootstrapAvatar', () => {
  beforeEach(() => {
    useAvatarStore.setState(useAvatarStore.getInitialState(), true);
    driverKind = 'sdk';
    createDriverMock.mockReset();
    loadSelectedMockScenarioFixtureMock.mockReset();
    driverStartMock.mockReset();
    driverStopMock.mockReset();
    recordAvatarEvidenceEventuallyMock.mockReset();
    createDriverMock.mockImplementation(() => createMockDriver());
    loadSelectedMockScenarioFixtureMock.mockResolvedValue({
      scenarioId: 'default',
      scenarioSource: 'default.mock.json',
      scenarioJson: '{"scenario_id":"default"}',
      activeWorldId: 'world-mock-default',
      activeUserId: 'user-mock-default',
      modelManifest: null,
    });
  });

  it('fails closed before any renderer account, grant, Realm, or agent bootstrap', async () => {
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(createDriverMock).not.toHaveBeenCalled();
    expect(loadSelectedMockScenarioFixtureMock).not.toHaveBeenCalled();
    expect(handle.driver).toBeNull();
    expect(useAvatarStore.getState().runtime.binding).toEqual({
      status: 'unavailable',
      reason: 'desktop_supervisor_bridge_unavailable',
      reasonCode: 'PROTECTED_ORIGIN_ROLE_MISMATCH',
      accountReasonCode: null,
      actionHint: 'launch_avatar_from_desktop_supervisor',
      stage: 'protected_launch_session',
      source: 'runtime',
      retryable: false,
    });
    expect(useAvatarStore.getState().driver.status).toBe('stopped');
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'avatar.runtime.bind-failed',
      detail: expect.objectContaining({
        runtime_app_id: 'nimi.avatar',
        reason: 'desktop_supervisor_bridge_unavailable',
        error_reason_code: 'PROTECTED_ORIGIN_ROLE_MISMATCH',
      }),
    }));
  });

  it('keeps an admitted mock fixture usable without upgrading it to Runtime authority', async () => {
    driverKind = 'mock';
    const { bootstrapAvatar } = await import('./app-bootstrap.js');

    const handle = await bootstrapAvatar();

    expect(createDriverMock).toHaveBeenCalledWith({
      kind: 'mock',
      scenarioJson: '{"scenario_id":"default"}',
      scenarioSource: 'default.mock.json',
    });
    expect(driverStartMock).toHaveBeenCalledTimes(1);
    expect(useAvatarStore.getState().consume).toMatchObject({
      mode: 'mock',
      authority: 'fixture',
      fixtureId: 'default',
      fixturePlaying: true,
      agentId: 'fixture-agent-default',
    });
    expect(useAvatarStore.getState().driver.status).toBe('running');

    await handle.shutdown();
    expect(driverStopMock).toHaveBeenCalledTimes(1);
  });
});
