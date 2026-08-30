import { resolveAgentVoicePlaybackAmplitude } from '@nimiplatform/kit/features/avatar/headless';

type MediaStreamTrackLike = {
  stop: () => void;
};

type MediaStreamLike = {
  getTracks: () => readonly MediaStreamTrackLike[];
};

type MediaStreamSourceLike = {
  connect: (node: AnalyserLike) => void;
  disconnect?: () => void;
};

type AnalyserLike = {
  fftSize: number;
  getByteTimeDomainData: (data: Uint8Array) => void;
  disconnect?: () => void;
};

type AudioContextLike = {
  state?: string;
  createAnalyser: () => AnalyserLike;
  createMediaStreamSource: (stream: MediaStreamLike) => MediaStreamSourceLike;
  resume?: () => Promise<void> | void;
  close?: () => Promise<void> | void;
};

type MediaRecorderLike = {
  state: 'inactive' | 'recording' | 'paused';
  mimeType?: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onerror: ((event: { error?: unknown }) => void) | null;
  onstop: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type AvatarVoiceCaptureResult = {
  bytes: Uint8Array;
  mimeType: string;
};

export type AvatarVoiceCaptureSession = {
  stop: () => Promise<AvatarVoiceCaptureResult>;
  cancel: () => void;
};

export class AvatarVoiceCaptureStopTimeoutError extends Error {
  readonly code = 'AVATAR_VOICE_CAPTURE_STOP_TIMEOUT' as const;

  constructor() {
    super('Voice capture did not finish after the recorder was stopped.');
    this.name = 'AvatarVoiceCaptureStopTimeoutError';
  }
}

type StartAvatarVoiceCaptureSessionDeps = {
  onLevelChange?: (amplitude: number) => void;
  getUserMediaImpl?: (constraints: MediaStreamConstraints) => Promise<MediaStreamLike>;
  createMediaRecorderImpl?: (
    stream: MediaStreamLike,
    options?: { mimeType?: string },
  ) => MediaRecorderLike;
  isTypeSupportedImpl?: (mimeType: string) => boolean;
  createAudioContextImpl?: () => AudioContextLike;
  setTimeoutImpl?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeoutImpl?: (timerId: unknown) => void;
};

const PREFERRED_VOICE_CAPTURE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
] as const;
const LEVEL_POLL_INTERVAL_MS = 120;
export const VOICE_CAPTURE_STOP_SETTLE_TIMEOUT_MS = 5_000;

function createAbortError(): Error {
  const error = new Error('Voice capture aborted.');
  error.name = 'AbortError';
  return error;
}

function resolveGetUserMedia(
  deps: StartAvatarVoiceCaptureSessionDeps,
): (constraints: MediaStreamConstraints) => Promise<MediaStreamLike> {
  if (deps.getUserMediaImpl) {
    return deps.getUserMediaImpl;
  }
  const mediaDevices = typeof navigator !== 'undefined'
    ? navigator.mediaDevices
    : undefined;
  if (!mediaDevices?.getUserMedia) {
    throw new Error('Voice input is unavailable because microphone capture is not supported.');
  }
  return mediaDevices.getUserMedia.bind(mediaDevices) as (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStreamLike>;
}

function resolveCreateMediaRecorder(
  deps: StartAvatarVoiceCaptureSessionDeps,
): (
  stream: MediaStreamLike,
  options?: { mimeType?: string },
) => MediaRecorderLike {
  if (deps.createMediaRecorderImpl) {
    return deps.createMediaRecorderImpl;
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Voice input is unavailable because MediaRecorder is not supported.');
  }
  return (
    stream: MediaStreamLike,
    options?: { mimeType?: string },
  ) => new MediaRecorder(stream as MediaStream, options) as MediaRecorderLike;
}

function resolveCreateAudioContext(
  deps: StartAvatarVoiceCaptureSessionDeps,
): (() => AudioContextLike) | null {
  if (deps.createAudioContextImpl) {
    return deps.createAudioContextImpl;
  }
  const contextCtor = typeof globalThis !== 'undefined'
    ? (
      globalThis.AudioContext
      || (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    )
    : null;
  return contextCtor
    ? () => new contextCtor() as unknown as AudioContextLike
    : null;
}

function resolveCaptureMimeType(
  deps: StartAvatarVoiceCaptureSessionDeps,
): string | undefined {
  const isTypeSupported = deps.isTypeSupportedImpl
    || (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? MediaRecorder.isTypeSupported.bind(MediaRecorder)
      : null);
  if (!isTypeSupported) {
    return undefined;
  }
  for (const candidate of PREFERRED_VOICE_CAPTURE_MIME_TYPES) {
    if (isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function stopTracks(stream: MediaStreamLike | null) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function createLevelMeterHandle(input: {
  stream: MediaStreamLike;
  onLevelChange?: (amplitude: number) => void;
  createAudioContextImpl?: () => AudioContextLike;
  setTimeoutImpl?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeoutImpl?: (timerId: unknown) => void;
}): { dispose: () => void } {
  if (!input.onLevelChange) {
    return { dispose() {} };
  }
  const createAudioContext = input.createAudioContextImpl || null;
  if (!createAudioContext) {
    input.onLevelChange(0);
    return { dispose() {} };
  }
  let audioContext: AudioContextLike | null = null;
  let source: MediaStreamSourceLike | null = null;
  let analyser: AnalyserLike | null = null;
  try {
    audioContext = createAudioContext();
    source = audioContext.createMediaStreamSource(input.stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    void audioContext.resume?.();
  } catch (error) {
    source?.disconnect?.();
    analyser?.disconnect?.();
    void audioContext?.close?.();
    input.onLevelChange(0);
    throw error;
  }

  const samples = new Uint8Array(analyser.fftSize);
  const setTimer = input.setTimeoutImpl || ((handler: () => void, timeoutMs: number) => setTimeout(handler, timeoutMs));
  const clearTimer = input.clearTimeoutImpl || ((timerId: unknown) => clearTimeout(timerId as ReturnType<typeof setTimeout>));
  let timerId: unknown = null;
  let disposed = false;

  const poll = () => {
    if (disposed) {
      return;
    }
    try {
      analyser!.getByteTimeDomainData(samples);
      input.onLevelChange?.(resolveAgentVoicePlaybackAmplitude(samples));
    } finally {
      timerId = setTimer(poll, LEVEL_POLL_INTERVAL_MS);
    }
  };

  poll();

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (timerId !== null) {
        clearTimer(timerId);
      }
      input.onLevelChange?.(0);
      source?.disconnect?.();
      analyser?.disconnect?.();
      void audioContext?.close?.();
    },
  };
}

export async function startAvatarVoiceCaptureSession(
  deps: StartAvatarVoiceCaptureSessionDeps = {},
): Promise<AvatarVoiceCaptureSession> {
  const getUserMedia = resolveGetUserMedia(deps);
  const createMediaRecorder = resolveCreateMediaRecorder(deps);
  const stream = await getUserMedia({ audio: true });
  let levelMeter: { dispose: () => void } | null = null;
  let recorder: MediaRecorderLike;
  let captureMimeType: string | undefined;
  try {
    captureMimeType = resolveCaptureMimeType(deps);
    recorder = createMediaRecorder(
      stream,
      captureMimeType ? { mimeType: captureMimeType } : undefined,
    );
    levelMeter = createLevelMeterHandle({
      stream,
      onLevelChange: deps.onLevelChange,
      createAudioContextImpl: resolveCreateAudioContext(deps) || undefined,
      setTimeoutImpl: deps.setTimeoutImpl,
      clearTimeoutImpl: deps.clearTimeoutImpl,
    });
  } catch (error) {
    levelMeter?.dispose();
    stopTracks(stream);
    throw error;
  }
  const chunks: Blob[] = [];
  let settled = false;
  let stopped = false;
  let rejectStop: ((error: unknown) => void) | null = null;
  let resolveStop: ((result: AvatarVoiceCaptureResult) => void) | null = null;
  let recorderError: unknown | null = null;
  let stopSettleTimer: unknown = null;
  let resourcesReleased = false;
  const setTimer = deps.setTimeoutImpl
    || ((handler: () => void, timeoutMs: number) => setTimeout(handler, timeoutMs));
  const clearTimer = deps.clearTimeoutImpl
    || ((timerId: unknown) => clearTimeout(timerId as ReturnType<typeof setTimeout>));

  const cleanup = () => {
    if (resourcesReleased) return;
    resourcesReleased = true;
    levelMeter?.dispose();
    stopTracks(stream);
  };

  const clearStopSettleTimer = () => {
    if (stopSettleTimer === null) return;
    clearTimer(stopSettleTimer);
    stopSettleTimer = null;
  };

  const rejectCapture = (error: unknown) => {
    if (settled) return;
    settled = true;
    clearStopSettleTimer();
    cleanup();
    rejectStop?.(error);
  };

  const resolveCapture = (result: AvatarVoiceCaptureResult) => {
    if (settled) return;
    settled = true;
    clearStopSettleTimer();
    cleanup();
    resolveStop?.(result);
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.onerror = (event) => {
    if (settled) {
      return;
    }
    recorderError = event.error || new Error('Voice capture failed.');
    rejectCapture(recorderError);
  };
  recorder.onstop = () => {
    if (settled) {
      return;
    }
    void (async () => {
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || captureMimeType || 'audio/webm' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        resolveCapture({
          bytes,
          mimeType: blob.type || recorder.mimeType || captureMimeType || 'audio/webm',
        });
      } catch (error) {
        rejectCapture(error);
      }
    })();
  };
  try {
    recorder.start();
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    stop() {
      if (stopped) {
        return Promise.reject(new Error('Voice capture session has already been stopped.'));
      }
      stopped = true;
      if (recorderError !== null) {
        return Promise.reject(recorderError);
      }
      return new Promise<AvatarVoiceCaptureResult>((resolve, reject) => {
        resolveStop = resolve;
        rejectStop = reject;
        stopSettleTimer = setTimer(() => {
          stopSettleTimer = null;
          rejectCapture(new AvatarVoiceCaptureStopTimeoutError());
        }, VOICE_CAPTURE_STOP_SETTLE_TIMEOUT_MS);
        try {
          recorder.stop();
        } catch (error) {
          rejectCapture(error);
        } finally {
          // MediaRecorder has already been asked to flush its final data. The
          // microphone, meter and AudioContext are no longer needed while the
          // queued dataavailable/onstop events settle.
          cleanup();
        }
      });
    },
    cancel() {
      if (settled) {
        cleanup();
        return;
      }
      stopped = true;
      rejectCapture(createAbortError());
      try {
        if (recorder.state === 'recording' || recorder.state === 'paused') {
          recorder.stop();
        }
      } catch {
        // Ignore recorder teardown failures after abort.
      }
    },
  };
}
