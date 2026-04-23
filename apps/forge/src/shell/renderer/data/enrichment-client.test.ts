import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTextGenerate = vi.fn();
const mockExecuteScenario = vi.fn();
const mockCreateAudioDirectUpload = vi.fn();
const mockFinalizeResource = vi.fn();
const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      appId: 'forge-app',
      ai: {
        text: {
          generate: mockTextGenerate,
        },
        executeScenario: mockExecuteScenario,
      },
    },
  }),
}));

vi.mock('@renderer/hooks/use-ai-config.js', () => ({
  getResolvedAiParams: (capability: 'text' | 'tts') => capability === 'text'
    ? {
      model: 'text-model',
      connectorId: 'connector-text',
      route: 'cloud',
      source: 'cloud',
    }
    : {
      model: 'tts-model',
      connectorId: 'connector-tts',
      route: 'local',
      source: 'local',
    },
}));

vi.mock('./content-data-client.js', () => ({
  createAudioDirectUpload: mockCreateAudioDirectUpload,
  finalizeResource: mockFinalizeResource,
}));

const enrichmentClient = await import('./enrichment-client.js');

describe('enrichment-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates structured agent copy with strict JSON parsing', async () => {
    mockTextGenerate.mockResolvedValue({
      text: '{"description":"A capable field scout.","scenario":"She meets users at the frontier gate.","greeting":"State your purpose at the gate."}',
    });

    const result = await enrichmentClient.generateAgentCopyCompletion({
      worldName: 'Frontier',
      worldDescription: 'A cold border world.',
      displayName: 'Ari',
      concept: 'Scout',
      description: '',
      scenario: '',
      greeting: '',
    });

    expect(result).toEqual({
      description: 'A capable field scout.',
      scenario: 'She meets users at the frontier gate.',
      greeting: 'State your purpose at the gate.',
    });
    expect(mockTextGenerate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'text-model',
      connectorId: 'connector-text',
      route: 'cloud',
    }));
  });

  it('fails closed when agent copy completion is not valid JSON', async () => {
    mockTextGenerate.mockResolvedValue({ text: 'not-json' });

    await expect(enrichmentClient.generateAgentCopyCompletion({
      worldName: 'Frontier',
      worldDescription: '',
      displayName: 'Ari',
      concept: 'Scout',
      description: '',
      scenario: '',
      greeting: '',
    })).rejects.toThrow('FORGE_AGENT_ENRICHMENT_JSON_REQUIRED');
  });

  it('synthesizes and uploads an agent voice sample without direct bind side effects', async () => {
    mockExecuteScenario.mockResolvedValue({
      output: {
        output: {
          oneofKind: 'speechSynthesize',
          speechSynthesize: {
            artifacts: [{
              artifactId: 'voice-artifact-1',
              uri: 'https://artifact.example.com/voice.mp3',
              mimeType: 'audio/mpeg',
            }],
          },
        },
      },
    });
    mockCreateAudioDirectUpload.mockResolvedValue({
      uploadUrl: 'https://upload.example.com/audio',
      resourceId: 'resource-a1',
    });
    mockFinalizeResource.mockResolvedValue({
      url: 'https://cdn.example.com/audio.mp3',
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://artifact.example.com/voice.mp3') {
        return {
          ok: true,
          blob: async () => new Blob(['voice-bytes'], { type: 'audio/mpeg' }),
        };
      }
      if (String(input) === 'https://upload.example.com/audio') {
        return { ok: true };
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    const result = await enrichmentClient.synthesizeAgentVoiceSample({
      text: 'State your purpose at the gate.',
    });

    expect(mockExecuteScenario).toHaveBeenCalledWith(expect.objectContaining({
      head: expect.objectContaining({
        modelId: 'tts-model',
        connectorId: 'connector-tts',
      }),
      scenarioType: expect.anything(),
      spec: expect.objectContaining({
        spec: expect.objectContaining({
          oneofKind: 'speechSynthesize',
          speechSynthesize: expect.objectContaining({
            text: 'State your purpose at the gate.',
            audioFormat: 'mp3',
          }),
        }),
      }),
    }));
    expect(result).toEqual({
      resourceId: 'resource-a1',
      url: 'https://cdn.example.com/audio.mp3',
      mimeType: 'audio/mpeg',
    });
  });
});
