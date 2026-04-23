import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListConnectors = vi.fn();
const mockListConnectorModels = vi.fn();
const mockListLocalAssets = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
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
    mockListLocalAssets.mockResolvedValue({ assets: [] });
  });

  it('preserves openai_codex and openai_compatible providers in cloud route options', async () => {
    mockListConnectors.mockResolvedValue({
      connectors: [
        {
          connectorId: 'conn-codex',
          provider: 'openai_codex',
          label: 'Codex Subscription',
          kind: 2,
        },
        {
          connectorId: 'conn-qwen',
          provider: 'openai_compatible',
          label: 'Qwen OAuth',
          kind: 2,
        },
      ],
    });
    mockListConnectorModels.mockImplementation(async ({ connectorId }: { connectorId: string }) => {
      if (connectorId === 'conn-codex') {
        return {
          models: [
            {
              modelId: 'gpt-image-2',
              available: true,
              capabilities: ['image.generate'],
            },
            {
              modelId: 'gpt-5.4',
              available: true,
              capabilities: ['text.generate'],
            },
          ],
        };
      }
      if (connectorId === 'conn-qwen') {
        return {
          models: [
            {
              modelId: 'qwen-max',
              available: true,
              capabilities: ['text.generate'],
            },
          ],
        };
      }
      return { models: [] };
    });

    const host = buildForgeRuntimeHost();
    const imageOptions = await host.runtime.route.listOptions({
      modId: 'forge',
      capability: 'image.generate',
    });
    const textOptions = await host.runtime.route.listOptions({
      modId: 'forge',
      capability: 'text.generate',
    });

    expect(imageOptions.connectors).toEqual([
      expect.objectContaining({
        id: 'conn-codex',
        label: 'Codex Subscription',
        provider: 'openai_codex',
        models: ['gpt-image-2'],
      }),
    ]);
    expect(textOptions.connectors).toEqual([
      expect.objectContaining({
        id: 'conn-codex',
        provider: 'openai_codex',
        models: ['gpt-5.4'],
      }),
      expect.objectContaining({
        id: 'conn-qwen',
        provider: 'openai_compatible',
        models: ['qwen-max'],
      }),
    ]);
  });
});
