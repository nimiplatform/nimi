import { describe, expect, it, vi } from 'vitest';
import {
  AvatarVoiceCaptureStopTimeoutError,
  VOICE_CAPTURE_STOP_SETTLE_TIMEOUT_MS,
  startAvatarVoiceCaptureSession,
} from './voice-capture.js';

describe('startAvatarVoiceCaptureSession', () => {
  it('stops every acquired track when MediaRecorder construction fails', async () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    await expect(startAvatarVoiceCaptureSession({
      getUserMediaImpl: vi.fn(async () => ({
        getTracks: () => [{ stop: firstStop }, { stop: secondStop }],
      })),
      createMediaRecorderImpl: () => {
        throw new Error('media-recorder-construction-failed');
      },
    })).rejects.toThrow('media-recorder-construction-failed');
    expect(firstStop).toHaveBeenCalledOnce();
    expect(secondStop).toHaveBeenCalledOnce();
  });

  it('rolls back the AudioContext and tracks when meter setup fails', async () => {
    const trackStop = vi.fn();
    const contextClose = vi.fn();
    const recorder = {
      state: 'inactive' as const,
      mimeType: 'audio/webm',
      ondataavailable: null,
      onerror: null,
      onstop: null,
      start: vi.fn(),
      stop: vi.fn(),
    };
    await expect(startAvatarVoiceCaptureSession({
      getUserMediaImpl: vi.fn(async () => ({
        getTracks: () => [{ stop: trackStop }],
      })),
      createMediaRecorderImpl: () => recorder,
      createAudioContextImpl: () => ({
        createMediaStreamSource: () => ({ connect() {} }),
        createAnalyser: () => {
          throw new Error('meter-setup-failed');
        },
        close: contextClose,
      }),
      onLevelChange: vi.fn(),
    })).rejects.toThrow('meter-setup-failed');
    expect(contextClose).toHaveBeenCalledOnce();
    expect(trackStop).toHaveBeenCalledOnce();
    expect(recorder.start).not.toHaveBeenCalled();
  });

  it('disposes meter resources and tracks when MediaRecorder.start fails', async () => {
    const trackStop = vi.fn();
    const sourceDisconnect = vi.fn();
    const analyserDisconnect = vi.fn();
    const contextClose = vi.fn();
    const recorder = {
      state: 'inactive' as const,
      mimeType: 'audio/webm',
      ondataavailable: null,
      onerror: null,
      onstop: null,
      start: vi.fn(() => {
        throw new Error('media-recorder-start-failed');
      }),
      stop: vi.fn(),
    };
    await expect(startAvatarVoiceCaptureSession({
      getUserMediaImpl: vi.fn(async () => ({
        getTracks: () => [{ stop: trackStop }],
      })),
      createMediaRecorderImpl: () => recorder,
      createAudioContextImpl: () => ({
        createMediaStreamSource: () => ({
          connect() {},
          disconnect: sourceDisconnect,
        }),
        createAnalyser: () => ({
          fftSize: 32,
          getByteTimeDomainData() {},
          disconnect: analyserDisconnect,
        }),
        close: contextClose,
      }),
      onLevelChange: vi.fn(),
    })).rejects.toThrow('media-recorder-start-failed');
    expect(sourceDisconnect).toHaveBeenCalledOnce();
    expect(analyserDisconnect).toHaveBeenCalledOnce();
    expect(contextClose).toHaveBeenCalledOnce();
    expect(trackStop).toHaveBeenCalledOnce();
  });

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

  it('releases the microphone and meter immediately after requesting Stop while final data settles', async () => {
    const trackStop = vi.fn();
    const contextClose = vi.fn();
    const sourceDisconnect = vi.fn();
    const analyserDisconnect = vi.fn();
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
      createAudioContextImpl: () => ({
        createMediaStreamSource: () => ({
          connect() {},
          disconnect: sourceDisconnect,
        }),
        createAnalyser: () => ({
          fftSize: 32,
          getByteTimeDomainData() {},
          disconnect: analyserDisconnect,
        }),
        close: contextClose,
      }),
      onLevelChange: vi.fn(),
    });

    const resultPromise = session.stop();
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(trackStop).toHaveBeenCalledOnce();
    expect(sourceDisconnect).toHaveBeenCalledOnce();
    expect(analyserDisconnect).toHaveBeenCalledOnce();
    expect(contextClose).toHaveBeenCalledOnce();

    recorder.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
    recorder.onstop?.();
    await expect(resultPromise).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
    });
    expect(trackStop).toHaveBeenCalledOnce();
  });

  it('rejects with a typed bounded failure when MediaRecorder never emits onstop', async () => {
    const trackStop = vi.fn();
    let timeoutHandler: (() => void) | null = null;
    const clearTimeoutImpl = vi.fn();
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
      setTimeoutImpl: (handler, timeoutMs) => {
        expect(timeoutMs).toBe(VOICE_CAPTURE_STOP_SETTLE_TIMEOUT_MS);
        timeoutHandler = handler;
        return 'stop-settle-watchdog';
      },
      clearTimeoutImpl,
    });

    const resultPromise = session.stop();
    expect(trackStop).toHaveBeenCalledOnce();
    expect(timeoutHandler).not.toBeNull();
    (timeoutHandler as (() => void) | null)?.();

    await expect(resultPromise).rejects.toBeInstanceOf(AvatarVoiceCaptureStopTimeoutError);
    await expect(resultPromise).rejects.toMatchObject({
      code: 'AVATAR_VOICE_CAPTURE_STOP_TIMEOUT',
    });
    expect(clearTimeoutImpl).not.toHaveBeenCalled();
  });
});
