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

export type AgentVoiceCaptureResult = {
  bytes: Uint8Array;
  mimeType: string;
};

export type AgentVoiceCaptureSession = {
  stop: () => Promise<AgentVoiceCaptureResult>;
  cancel: () => void;
};

type AgentVoiceCaptureAutoStopHandle = {
  dispose: () => void;
};

type StartAgentVoiceCaptureSessionDeps = {
  getUserMediaImpl?: (constraints: MediaStreamConstraints) => Promise<MediaStreamLike>;
  createMediaRecorderImpl?: (
    stream: MediaStreamLike,
    options?: { mimeType?: string },
  ) => MediaRecorderLike;
  isTypeSupportedImpl?: (mimeType: string) => boolean;
  autoStopMode?: 'manual' | 'silence';
  silenceWindowMs?: number;
  silenceThreshold?: number;
  createSilenceAutoStopHandleImpl?: (input: {
    stream: MediaStreamLike;
    requestStop: () => void;
    silenceWindowMs: number;
    silenceThreshold: number;
    createAudioContextImpl?: () => AudioContextLike;
    setTimeoutImpl?: (handler: () => void, timeoutMs: number) => unknown;
    clearTimeoutImpl?: (timerId: unknown) => void;
    nowImpl?: () => number;
  }) => AgentVoiceCaptureAutoStopHandle;
  createAudioContextImpl?: () => AudioContextLike;
  setTimeoutImpl?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeoutImpl?: (timerId: unknown) => void;
  nowImpl?: () => number;
};

const PREFERRED_VOICE_CAPTURE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
] as const;
const DEFAULT_SILENCE_WINDOW_MS = 1400;
const DEFAULT_SILENCE_THRESHOLD = 0.02;
const SILENCE_POLL_INTERVAL_MS = 120;

function createAbortError(): Error {
  const error = new Error('Voice capture aborted.');
  error.name = 'AbortError';
  return error;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveCreateAudioContext(
  deps: StartAgentVoiceCaptureSessionDeps,
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

function resolveGetUserMedia(
  deps: StartAgentVoiceCaptureSessionDeps,
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
  deps: StartAgentVoiceCaptureSessionDeps,
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

function resolveCaptureMimeType(
  deps: StartAgentVoiceCaptureSessionDeps,
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

function createSilenceAutoStopHandle(input: {
  stream: MediaStreamLike;
  requestStop: () => void;
  silenceWindowMs: number;
  silenceThreshold: number;
  createAudioContextImpl?: () => AudioContextLike;
  setTimeoutImpl?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeoutImpl?: (timerId: unknown) => void;
  nowImpl?: () => number;
}): AgentVoiceCaptureAutoStopHandle {
  const createAudioContext = input.createAudioContextImpl || null;
  if (!createAudioContext) {
    throw new Error('Hands-free is unavailable because silence detection is not supported.');
  }
  const audioContext = createAudioContext();
  const source = audioContext.createMediaStreamSource(input.stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  void audioContext.resume?.();

  const setTimer = input.setTimeoutImpl || ((handler: () => void, timeoutMs: number) => setTimeout(handler, timeoutMs));
  const clearTimer = input.clearTimeoutImpl || ((timerId: unknown) => clearTimeout(timerId as ReturnType<typeof setTimeout>));
  const now = input.nowImpl || (() => Date.now());
  const samples = new Uint8Array(analyser.fftSize);
  let observedSpeech = false;
  let lastSpeechAtMs = now();
  let disposed = false;
  let timerId: unknown = null;

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
    source.disconnect?.();
    analyser.disconnect?.();
    void audioContext.close?.();
  };

  const poll = () => {
    if (disposed) {
      return;
    }
    try {
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const nowMs = now();
      if (rms >= input.silenceThreshold) {
        observedSpeech = true;
        lastSpeechAtMs = nowMs;
      } else if (observedSpeech && nowMs - lastSpeechAtMs >= input.silenceWindowMs) {
        dispose();
        input.requestStop();
        return;
      }
      timerId = setTimer(poll, SILENCE_POLL_INTERVAL_MS);
    } catch {
      dispose();
      input.requestStop();
    }
  };

  timerId = setTimer(poll, SILENCE_POLL_INTERVAL_MS);
  return { dispose };
}

export async function startAgentVoiceCaptureSession(
  deps: StartAgentVoiceCaptureSessionDeps = {},
): Promise<AgentVoiceCaptureSession> {
  const getUserMedia = resolveGetUserMedia(deps);
  const createMediaRecorder = resolveCreateMediaRecorder(deps);
  const stream = await getUserMedia({ audio: true });
  const preferredMimeType = resolveCaptureMimeType(deps);
  const recorder = createMediaRecorder(
    stream,
    preferredMimeType ? { mimeType: preferredMimeType } : undefined,
  );
  const chunks: Blob[] = [];
  let settled = false;
  let canceled = false;
  let stopPromise: Promise<AgentVoiceCaptureResult> | null = null;
  let resolveStop: ((value: AgentVoiceCaptureResult) => void) | null = null;
  let rejectStop: ((reason?: unknown) => void) | null = null;
  let autoStopHandle: AgentVoiceCaptureAutoStopHandle | null = null;

  const ensureStopPromise = () => {
    if (!stopPromise) {
      stopPromise = new Promise<AgentVoiceCaptureResult>((resolve, reject) => {
        resolveStop = resolve;
        rejectStop = reject;
      });
    }
    return stopPromise;
  };

  const requestStop = () => {
    if (canceled) {
      return;
    }
    const pendingStop = ensureStopPromise();
    if (recorder.state === 'inactive') {
      recorder.onstop?.();
      return;
    }
    recorder.stop();
    return pendingStop;
  };

  const cleanup = () => {
    autoStopHandle?.dispose();
    autoStopHandle = null;
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    stopTracks(stream);
  };

  const settle = (handler: () => void) => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    handler();
  };

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.onerror = (event) => {
    settle(() => {
      rejectStop?.(event.error || new Error('Voice capture failed.'));
    });
  };
  recorder.onstop = () => {
    void (async () => {
      if (canceled) {
        settle(() => {
          rejectStop?.(createAbortError());
        });
        return;
      }
      try {
        const combined = new Blob(chunks, {
          type: normalizeText(recorder.mimeType) || preferredMimeType || 'audio/webm',
        });
        const mimeType = normalizeText(combined.type) || normalizeText(recorder.mimeType) || preferredMimeType || 'audio/webm';
        const bytes = new Uint8Array(await combined.arrayBuffer());
        if (bytes.length === 0) {
          throw new Error('Voice capture produced no audio data.');
        }
        settle(() => {
          resolveStop?.({
            bytes,
            mimeType,
          });
        });
      } catch (error) {
        settle(() => {
          rejectStop?.(error);
        });
      }
    })();
  };

  if (deps.autoStopMode === 'silence') {
    const silenceWindowMs = deps.silenceWindowMs || DEFAULT_SILENCE_WINDOW_MS;
    const silenceThreshold = deps.silenceThreshold || DEFAULT_SILENCE_THRESHOLD;
    const buildAutoStopHandle = deps.createSilenceAutoStopHandleImpl || createSilenceAutoStopHandle;
    try {
      autoStopHandle = buildAutoStopHandle({
        stream,
        requestStop,
        silenceWindowMs,
        silenceThreshold,
        createAudioContextImpl: resolveCreateAudioContext(deps) || undefined,
        setTimeoutImpl: deps.setTimeoutImpl,
        clearTimeoutImpl: deps.clearTimeoutImpl,
        nowImpl: deps.nowImpl,
      });
    } catch (error) {
      stopTracks(stream);
      throw error;
    }
  }

  recorder.start();

  return {
    stop: () => {
      if (canceled) {
        return Promise.reject(createAbortError());
      }
      return requestStop() || ensureStopPromise();
    },
    cancel: () => {
      if (settled || canceled) {
        return;
      }
      canceled = true;
      if (recorder.state !== 'inactive') {
        recorder.stop();
        return;
      }
      settle(() => {
        rejectStop?.(createAbortError());
      });
    },
  };
}
