import { describe, expect, it, vi } from 'vitest';
import { startAvatarVoiceCaptureSession } from './voice-capture.js';

describe('startAvatarVoiceCaptureSession', () => {
  it('deterministically rejects stop after MediaRecorder fails before stop is requested', async () => {
    const trackStop = vi.fn();
    const recorder = {
      state: 'recording' as const,
      mimeType: 'audio/webm',
      ondataavailable: null as ((event: { data: Blob }) => void) | null,
      onerror: null as ((event: { error?: unknown }) => void) | null,
      onstop: null as (() => void) | null,
      start: vi.fn(),
      stop: vi.fn(),
    };
    const session = await startAvatarVoiceCaptureSession({
      getUserMediaImpl: vi.fn(async () => ({
        getTracks: () => [{ stop: trackStop }],
      })),
      createMediaRecorderImpl: () => recorder,
      isTypeSupportedImpl: () => true,
    });
    const earlyError = new Error('recorder device failed');
    recorder.onerror?.({ error: earlyError });

    await expect(session.stop()).rejects.toBe(earlyError);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalledOnce();
  });
});
