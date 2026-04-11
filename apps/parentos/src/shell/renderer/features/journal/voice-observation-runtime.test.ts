import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import { hasVoiceTranscriptionRuntime, transcribeVoiceObservation } from './voice-observation-runtime.js';

const getPlatformClientMock = vi.fn();
const transcribeMock = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => getPlatformClientMock(),
}));

describe('voice observation runtime', () => {
  beforeEach(() => {
    transcribeMock.mockReset();
    getPlatformClientMock.mockReset();
    useAppStore.setState({ aiConfig: null });
  });

  it('detects when the local transcription surface is available', async () => {
    getPlatformClientMock.mockReturnValue({
      runtime: {
        appId: 'app.nimi.parentos',
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
    transcribeMock.mockResolvedValue({
      text: '观察到他愿意轮流搭积木。',
      artifacts: [{ artifactId: 'artifact-1', mimeType: 'text/plain', displayName: 'transcript' }],
      trace: { traceId: 'trace-1', modelResolved: 'local-stt', routeDecision: 'local' },
    });
    getPlatformClientMock.mockReturnValue({
      runtime: {
        appId: 'app.nimi.parentos',
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
      model: 'auto',
      route: 'local',
      mimeType: 'audio/webm',
      metadata: expect.objectContaining({
        callerId: 'app.nimi.parentos',
        surfaceId: 'parentos.journal.voice-observation',
      }),
    }));
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
