export interface VoiceRecordingResult {
  blob: Blob;
  mimeType: string;
  previewUrl: string;
  /** Snapshot of amplitude samples (0-1) captured during recording, low-frequency. */
  levelSamples: number[];
  /** Recording duration in milliseconds. */
  durationMs: number;
}

export interface VoiceRecordingSession {
  stop: () => Promise<VoiceRecordingResult>;
  cancel: () => void;
  /** Returns current input amplitude in [0, 1]. Returns 0 if analyser is unavailable. */
  getLevel: () => number;
  /** Returns elapsed recording time in milliseconds. */
  getDurationMs: () => number;
}

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

function pickRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  return PREFERRED_MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

export function supportsVoiceRecording() {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof MediaRecorder !== 'undefined';
}

export async function startVoiceRecording(): Promise<VoiceRecordingSession> {
  if (!supportsVoiceRecording()) {
    throw new Error('voice recording is unavailable in this environment');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickRecordingMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  let settled = false;

  // ── Live amplitude analyser (best-effort; degrades gracefully) ──
  type AudioCtxCtor = typeof AudioContext;
  const audioCtxCtor: AudioCtxCtor | undefined = typeof window !== 'undefined'
    ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext)
    : undefined;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let analyserBuffer: Uint8Array | null = null;
  if (audioCtxCtor) {
    try {
      audioCtx = new audioCtxCtor();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserBuffer = new Uint8Array(analyser.fftSize);
    } catch {
      // Fall back to zero-level UI without breaking recording.
      audioCtx = null;
      analyser = null;
      analyserBuffer = null;
    }
  }

  const startedAt = Date.now();
  const levelSamples: number[] = [];
  // Sample roughly every 80 ms so a 60 s recording captures ~750 points;
  // we down-sample for the static preview waveform later.
  const SAMPLE_INTERVAL_MS = 80;
  const sampleTimer = window.setInterval(() => {
    levelSamples.push(getLevel());
  }, SAMPLE_INTERVAL_MS);

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.start();

  const stopTracks = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  const teardownAnalyser = () => {
    window.clearInterval(sampleTimer);
    if (audioCtx) {
      audioCtx.close().catch(() => { /* no-op */ });
      audioCtx = null;
    }
    analyser = null;
    analyserBuffer = null;
  };

  function getLevel(): number {
    if (!analyser || !analyserBuffer) return 0;
    // getByteTimeDomainData is widely typed as Uint8Array<ArrayBuffer>; the cast
    // is safe because analyserBuffer was sized via analyser.fftSize.
    analyser.getByteTimeDomainData(analyserBuffer as unknown as Uint8Array<ArrayBuffer>);
    let sumSquares = 0;
    for (let i = 0; i < analyserBuffer.length; i++) {
      const v = (analyserBuffer[i]! - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / analyserBuffer.length);
    // Light boost so quiet speech still moves the waveform.
    return Math.min(1, rms * 2.2);
  }

  return {
    getLevel,
    getDurationMs: () => Date.now() - startedAt,
    stop: () => new Promise<VoiceRecordingResult>((resolve, reject) => {
      recorder.addEventListener('stop', () => {
        if (settled) {
          return;
        }
        settled = true;
        const durationMs = Date.now() - startedAt;
        teardownAnalyser();
        stopTracks();
        const finalMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: finalMimeType });
        if (blob.size === 0) {
          reject(new Error('voice recording completed without audio data'));
          return;
        }
        resolve({
          blob,
          mimeType: finalMimeType,
          previewUrl: URL.createObjectURL(blob),
          levelSamples: levelSamples.slice(),
          durationMs,
        });
      }, { once: true });
      recorder.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          teardownAnalyser();
          stopTracks();
          reject(new Error('voice recording failed'));
        }
      }, { once: true });
      recorder.stop();
    }),
    cancel: () => {
      if (settled) {
        return;
      }
      settled = true;
      teardownAnalyser();
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      stopTracks();
    },
  };
}

export function revokeVoicePreviewUrl(url: string | null) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}
