import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRuntimeBridgeStatusMock = vi.fn();
const loadParentosRuntimeRouteOptionsMock = vi.fn();
const logRendererEventMock = vi.fn();

vi.mock('@nimiplatform/nimi-kit/shell/renderer/bridge', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDaemonStatus: getRuntimeBridgeStatusMock,
  };
});

vi.mock('../../infra/parentos-runtime-route-options.js', () => ({
  loadParentosRuntimeRouteOptions: loadParentosRuntimeRouteOptionsMock,
}));

vi.mock('../../infra/telemetry/renderer-log.js', () => ({
  describeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error || '') }),
  logRendererEvent: logRendererEventMock,
}));

const {
  probeParentosAISettingsAvailability,
} = await import('./parentos-ai-settings-availability.js');

describe('parentos-ai-settings-availability', () => {
  beforeEach(() => {
    getRuntimeBridgeStatusMock.mockReset();
    loadParentosRuntimeRouteOptionsMock.mockReset();
    logRendererEventMock.mockReset();
  });

  it('reports daemon-unavailable when runtime bridge is not running', async () => {
    getRuntimeBridgeStatusMock.mockResolvedValue({
      running: false,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
      lastError: 'daemon down',
    });

    const availability = await probeParentosAISettingsAvailability();

    expect(availability).toEqual(expect.objectContaining({
      kind: 'daemon-unavailable',
      detail: 'daemon down',
    }));
  });

  it('reports route-options-failed when the route snapshot probe throws', async () => {
    getRuntimeBridgeStatusMock.mockResolvedValue({
      running: true,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
    });
    loadParentosRuntimeRouteOptionsMock.mockRejectedValue(new Error('snapshot failed'));

    const availability = await probeParentosAISettingsAvailability();

    expect(availability).toEqual(expect.objectContaining({
      kind: 'route-options-failed',
      detail: 'snapshot failed',
    }));
  });

  it('reports ready when daemon and route snapshot probe both succeed', async () => {
    getRuntimeBridgeStatusMock.mockResolvedValue({
      running: true,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
    });
    loadParentosRuntimeRouteOptionsMock.mockResolvedValue({
      capability: 'text.generate',
      selected: null,
      local: {
        models: [],
      },
      connectors: [],
    });

    const availability = await probeParentosAISettingsAvailability();

    expect(availability).toEqual(expect.objectContaining({
      kind: 'ready',
    }));
  });
});
