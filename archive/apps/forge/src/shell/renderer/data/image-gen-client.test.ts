import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTextGenerate = vi.fn();
const mockImageGenerate = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      ai: {
        text: {
          generate: mockTextGenerate,
        },
      },
      media: {
        image: {
          generate: mockImageGenerate,
        },
      },
    },
  }),
}));

vi.mock('@renderer/hooks/use-ai-config.js', () => ({
  getResolvedAiParams: (capability: 'text' | 'image') => capability === 'text'
    ? {
      model: 'gpt-5.4',
      connectorId: 'conn-codex',
      route: 'cloud',
      source: 'cloud',
    }
    : {
      model: 'gpt-image-2',
      connectorId: 'conn-codex',
      route: 'cloud',
      source: 'cloud',
    },
}));

vi.mock('./content-data-client.js', () => ({
  createImageDirectUpload: vi.fn(),
  finalizeResource: vi.fn(),
}));

vi.mock('./agent-data-client.js', () => ({
  updateAgent: vi.fn(),
}));

vi.mock('./world-data-client.js', () => ({
  batchUpsertWorldResourceBindings: vi.fn(),
}));

const imageGenClient = await import('./image-gen-client.js');

describe('image-gen-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes prompt refinement and image generation through the selected connector', async () => {
    mockTextGenerate.mockResolvedValue({
      text: 'PROMPT: cinematic portrait, silver hair, sharp lighting\nNEGATIVE: blurry, watermark',
    });
    mockImageGenerate.mockResolvedValue({
      artifacts: [
        {
          artifactId: 'img-1',
          uri: 'https://cdn.example.com/generated.png',
          mimeType: 'image/png',
        },
      ],
    });

    const result = await imageGenClient.generateEntityImage({
      target: 'agent-avatar',
      agentName: 'Ari',
      agentConcept: 'Border scout',
      userPrompt: 'Keep the portrait stoic and severe.',
    });

    expect(mockTextGenerate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4',
      connectorId: 'conn-codex',
      route: 'cloud',
    }));
    expect(mockImageGenerate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-image-2',
      connectorId: 'conn-codex',
      route: 'cloud',
      prompt: 'cinematic portrait, silver hair, sharp lighting',
      negativePrompt: 'blurry, watermark',
    }));
    expect(result.candidates).toEqual([
      expect.objectContaining({
        id: 'img-1',
        url: 'https://cdn.example.com/generated.png',
      }),
    ]);
  });
});
