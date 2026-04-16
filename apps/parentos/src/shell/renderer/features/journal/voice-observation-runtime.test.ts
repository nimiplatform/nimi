import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import { PARENTOS_AI_SCOPE_REF } from '../settings/parentos-ai-config.js';
import { hasVoiceTranscriptionRuntime, transcribeVoiceObservation } from './voice-observation-runtime.js';

const {
  getPlatformClientMock,
  transcribeMock,
  warmLocalAssetMock,
  loadParentosRuntimeRouteOptionsMock,
} = vi.hoisted(() => ({
  getPlatformClientMock: vi.fn(),
  transcribeMock: vi.fn(),
  warmLocalAssetMock: vi.fn(async () => ({})),
  loadParentosRuntimeRouteOptionsMock: vi.fn(async () => ({
    capability: 'audio.transcribe',
    selected: null,
    resolvedDefault: {
      source: 'local',
      connectorId: '',
      model: 'whisper-large-v3',
      modelId: 'whisper-large-v3',
      localModelId: 'local-whisper-large-v3',
      provider: 'speech',
      engine: 'speech',
      endpoint: 'http://127.0.0.1:1234/v1',
      goRuntimeLocalModelId: 'local-whisper-large-v3',
      goRuntimeStatus: 'active',
    },
    local: {
      defaultEndpoint: 'http://127.0.0.1:1234/v1',
      models: [],
    },
    connectors: [],
  })),
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => getPlatformClientMock(),
}));

vi.mock('../../infra/parentos-runtime-route-options.js', () => ({
  loadParentosRuntimeRouteOptions: loadParentosRuntimeRouteOptionsMock,
}));

describe('voice observation runtime', () => {
  beforeEach(() => {
    transcribeMock.mockReset();
    warmLocalAssetMock.mockReset();
    loadParentosRuntimeRouteOptionsMock.mockClear();
    getPlatformClientMock.mockReset();
    useAppStore.setState({ aiConfig: null });
  });

  it('detects when the local transcription surface is available', async () => {
    getPlatformClientMock.mockReturnValue({
      runtime: {
        appId: 'app.nimi.parentos',
        local: {
          warmLocalAsset: warmLocalAssetMock,
        },
        media: {
          stt: {
            transcribe: transcribeMock,
          },
        },
      },
    });

    await expect(hasVoiceTranscriptionRuntime()).resolves.toBe(true);
  });

  it('uses the typed local STT surface and returns transcript text', async () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'audio.transcribe': {
              source: 'local',
              connectorId: '',
              model: 'whisper-large-v3',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });
    transcribeMock.mockResolvedValue({
      text: '观察到他愿意轮流搭积木。',
      artifacts: [{ artifactId: 'artifact-1', mimeType: 'text/plain', displayName: 'transcript' }],
      trace: { traceId: 'trace-1', modelResolved: 'local-stt', routeDecision: 'local' },
    });
    getPlatformClientMock.mockReturnValue({
      runtime: {
        appId: 'app.nimi.parentos',
        local: {
          warmLocalAsset: warmLocalAssetMock,
        },
        media: {
          stt: {
            transcribe: transcribeMock,
          },
        },
      },
    });

    const result = await transcribeVoiceObservation({
      audioBlob: new Blob(['audio-bytes'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
    });

    expect(transcribeMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'speech/whisper-large-v3',
      route: 'local',
      mimeType: 'audio/webm',
      metadata: expect.objectContaining({
        callerId: 'app.nimi.parentos',
        surfaceId: 'parentos.journal.voice-observation',
      }),
    }));
    expect(warmLocalAssetMock).toHaveBeenCalledWith({
      localAssetId: 'local-whisper-large-v3',
      timeoutMs: 180000,
    });
    expect(result.transcript).toBe('观察到他愿意轮流搭积木。');
    expect(result.trace.routeDecision).toBe('local');
  });

  it('rejects malformed typed outputs that contain no transcript text', async () => {
    transcribeMock.mockResolvedValue({
      text: '   ',
      artifacts: [],
      trace: {},
    });
    getPlatformClientMock.mockReturnValue({
      runtime: {
        appId: 'app.nimi.parentos',
        local: {
          warmLocalAsset: warmLocalAssetMock,
        },
        media: {
          stt: {
            transcribe: transcribeMock,
          },
        },
      },
    });

    await expect(transcribeVoiceObservation({
      audioBlob: new Blob(['audio-bytes'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
    })).rejects.toThrow(/missing transcript text/);
  });
});
