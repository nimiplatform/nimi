import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTextGenerate = vi.fn();
const mockTtsSynthesize = vi.fn();
const mockCreateAudioDirectUpload = vi.fn();
const mockFinalizeResource = vi.fn();
const mockBatchUpsertWorldResourceBindings = vi.fn();
const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      ai: {
        text: {
          generate: mockTextGenerate,
        },
      },
      media: {
        tts: {
          synthesize: mockTtsSynthesize,
        },
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

vi.mock('./world-data-client.js', () => ({
  batchUpsertWorldResourceBindings: mockBatchUpsertWorldResourceBindings,
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

  it('synthesizes, uploads, and binds an agent voice sample', async () => {
    mockTtsSynthesize.mockResolvedValue({
      artifacts: [{
        artifactId: 'voice-artifact-1',
        uri: 'https://artifact.example.com/voice.mp3',
        mimeType: 'audio/mpeg',
      }],
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

    const result = await enrichmentClient.synthesizeAndBindAgentVoiceSample({
      worldId: 'world-1',
      agentId: 'agent-1',
      text: 'State your purpose at the gate.',
    });

    expect(mockTtsSynthesize).toHaveBeenCalledWith(expect.objectContaining({
      model: 'tts-model',
      connectorId: 'connector-tts',
      route: 'local',
      text: 'State your purpose at the gate.',
      audioFormat: 'mp3',
    }));
    expect(mockBatchUpsertWorldResourceBindings).toHaveBeenCalledWith('world-1', {
      bindingUpserts: [{
        objectType: 'RESOURCE',
        objectId: 'resource-a1',
        hostType: 'AGENT',
        hostId: 'agent-1',
        bindingKind: 'PRESENTATION',
        bindingPoint: 'AGENT_VOICE_SAMPLE',
        priority: 0,
      }],
    });
    expect(result).toEqual({
      resourceId: 'resource-a1',
      url: 'https://cdn.example.com/audio.mp3',
      mimeType: 'audio/mpeg',
    });
  });
});
