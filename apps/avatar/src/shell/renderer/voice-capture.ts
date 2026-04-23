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

function resolveAmplitude(samples: Uint8Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let total = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    total += normalized * normalized;
  }
  return Math.max(0, Math.min(1, Math.sqrt(total / samples.length) * 3.2));
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
  const audioContext = createAudioContext();
  const source = audioContext.createMediaStreamSource(input.stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  void audioContext.resume?.();

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
      analyser.getByteTimeDomainData(samples);
      input.onLevelChange?.(resolveAmplitude(samples));
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
      source.disconnect?.();
      analyser.disconnect?.();
      void audioContext.close?.();
    },
  };
}

export async function startAvatarVoiceCaptureSession(
  deps: StartAvatarVoiceCaptureSessionDeps = {},
): Promise<AvatarVoiceCaptureSession> {
  const getUserMedia = resolveGetUserMedia(deps);
  const createMediaRecorder = resolveCreateMediaRecorder(deps);
  const stream = await getUserMedia({ audio: true });
  const captureMimeType = resolveCaptureMimeType(deps);
  const recorder = createMediaRecorder(
    stream,
    captureMimeType ? { mimeType: captureMimeType } : undefined,
  );
  const levelMeter = createLevelMeterHandle({
    stream,
    onLevelChange: deps.onLevelChange,
    createAudioContextImpl: resolveCreateAudioContext(deps) || undefined,
    setTimeoutImpl: deps.setTimeoutImpl,
    clearTimeoutImpl: deps.clearTimeoutImpl,
  });
  const chunks: Blob[] = [];
  let settled = false;
  let stopped = false;
  let rejectStop: ((error: unknown) => void) | null = null;
  let resolveStop: ((result: AvatarVoiceCaptureResult) => void) | null = null;

  const cleanup = () => {
    levelMeter.dispose();
    stopTracks(stream);
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
    settled = true;
    cleanup();
    rejectStop?.(event.error || new Error('Voice capture failed.'));
  };
  recorder.onstop = () => {
    if (settled) {
      return;
    }
    settled = true;
    void (async () => {
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || captureMimeType || 'audio/webm' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        cleanup();
        resolveStop?.({
          bytes,
          mimeType: blob.type || recorder.mimeType || captureMimeType || 'audio/webm',
        });
      } catch (error) {
        cleanup();
        rejectStop?.(error);
      }
    })();
  };
  recorder.start();

  return {
    stop() {
      if (stopped) {
        return Promise.reject(new Error('Voice capture session has already been stopped.'));
      }
      stopped = true;
      return new Promise<AvatarVoiceCaptureResult>((resolve, reject) => {
        resolveStop = resolve;
        rejectStop = reject;
        try {
          recorder.stop();
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    },
    cancel() {
      if (settled || stopped) {
        cleanup();
        return;
      }
      stopped = true;
      settled = true;
      cleanup();
      rejectStop?.(createAbortError());
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
