import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListConnectors = vi.fn();
const mockListConnectorModels = vi.fn();
const mockListLocalAssets = vi.fn();
const mockRuntimeRouteListOptions = vi.fn();
let mockRuntimeRouteListOptionsAvailable = true;

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      route: mockRuntimeRouteListOptionsAvailable
        ? {
            listOptions: mockRuntimeRouteListOptions,
          }
        : {},
      connector: {
        listConnectors: mockListConnectors,
        listConnectorModels: mockListConnectorModels,
      },
      local: {
        listLocalAssets: mockListLocalAssets,
      },
    },
  }),
}));

const { buildForgeRuntimeHost } = await import('./forge-runtime-host.js');

describe('buildForgeRuntimeHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeRouteListOptionsAvailable = true;
    mockListLocalAssets.mockResolvedValue({ assets: [] });
  });

  it('delegates route options to runtime route authority without inventory fallback', async () => {
    const snapshot = {
      capability: 'text.generate',
      selected: null,
      local: { models: [] },
      connectors: [
        {
          id: 'conn-codex',
          label: 'Codex Subscription',
          provider: 'openai_codex',
          models: ['gpt-5.4'],
          modelCapabilities: {
            'gpt-5.4': ['text.generate'],
          },
        },
      ],
    };
    mockRuntimeRouteListOptions.mockResolvedValue(snapshot);
    mockListConnectors.mockRejectedValue(new Error('connector inventory must not be called'));
    mockListConnectorModels.mockRejectedValue(new Error('connector model inventory must not be called'));
    mockListLocalAssets.mockRejectedValue(new Error('local inventory must not be called'));

    const host = buildForgeRuntimeHost();
    const options = await host.runtime.route.listOptions({
      modId: 'forge',
      capability: 'text.generate',
    });

    expect(options).toBe(snapshot);
    expect(mockRuntimeRouteListOptions).toHaveBeenCalledWith({
      capability: 'text.generate',
    });
    expect(mockListConnectors).not.toHaveBeenCalled();
    expect(mockListConnectorModels).not.toHaveBeenCalled();
    expect(mockListLocalAssets).not.toHaveBeenCalled();
  });

  it('fails closed when runtime route authority is unavailable', async () => {
    mockRuntimeRouteListOptionsAvailable = false;

    const host = buildForgeRuntimeHost();

    await expect(host.runtime.route.listOptions({
      modId: 'forge',
      capability: 'text.generate',
    })).rejects.toThrow('FORGE_RUNTIME_ROUTE_AUTHORITY_UNAVAILABLE');
  });
});
