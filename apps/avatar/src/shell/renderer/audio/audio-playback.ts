// Wave 3 — WebAudio playback controller for runtime-emitted voice artifacts.
//
// The avatar renderer consumes `runtime.agent.presentation.voice_playback_requested`
// events; runtime owns the lifecycle (`requested → started → completed | interrupted | failed`)
// and the renderer mirrors it 1:1 here. This module is a single
// per-renderer instance because the browser AudioContext is a per-document
// singleton; constructing more than one wastes resources and the platform
// rejects creating one without a user gesture, so reuse is mandatory.
//
// Fail-close contract (K-AGCORE-051): when the runtime-supplied
// `audio_mime_type` is the synthetic frame-only marker
// (`application/x-nimi-synthetic-lipsync`), this controller MUST NOT attempt
// audio decode/playback. It logs a single `synthetic_audio_no_playback`
// warning, pushes `playbackState='completed'` so consumers move forward
// (lipsync frames are still authoritative for mouth movement), and returns.

export type AudioPlaybackState =
  | 'idle'
  | 'requested'
  | 'started'
  | 'completed'
  | 'interrupted'
  | 'failed';

export type AudioPlaybackSnapshot = {
  state: AudioPlaybackState;
  audioArtifactId: string | null;
  audioMimeType: string | null;
  reason: string | null;
};

export const SYNTHETIC_AUDIO_MIME_TYPE = 'application/x-nimi-synthetic-lipsync';

const PLAYABLE_MIME_PREFIXES = ['audio/'];

export type AudioPlaybackPlayInput = {
  audioArtifactId: string;
  audioMimeType: string;
  durationMs?: number;
  fetchBytes?: () => Promise<ArrayBuffer>;
};

export type AudioPlaybackListener = (snapshot: AudioPlaybackSnapshot) => void;

type AudioPlaybackLogger = Pick<typeof console, 'warn' | 'error'>;

type AudioPlaybackOptions = {
  audioContextFactory?: () => AudioContext | null;
  logger?: AudioPlaybackLogger;
};

const idleSnapshot: AudioPlaybackSnapshot = Object.freeze({
  state: 'idle',
  audioArtifactId: null,
  audioMimeType: null,
  reason: null,
});

export class AudioPlaybackController {
  private listeners = new Set<AudioPlaybackListener>();
  private snapshot: AudioPlaybackSnapshot = idleSnapshot;
  private context: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private playId = 0;
  private readonly contextFactory: () => AudioContext | null;
  private readonly logger: AudioPlaybackLogger;

  constructor(options: AudioPlaybackOptions = {}) {
    this.contextFactory = options.audioContextFactory ?? defaultAudioContextFactory;
    this.logger = options.logger ?? console;
  }

  getSnapshot(): AudioPlaybackSnapshot {
    return this.snapshot;
  }

  subscribe(listener: AudioPlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async play(input: AudioPlaybackPlayInput): Promise<void> {
    const audioArtifactId = input.audioArtifactId.trim();
    const audioMimeType = input.audioMimeType.trim();
    if (!audioArtifactId || !audioMimeType) {
      this.publish({
        state: 'failed',
        audioArtifactId: audioArtifactId || null,
        audioMimeType: audioMimeType || null,
        reason: 'missing_audio_identity',
      });
      return;
    }

    // Stop any in-flight playback before starting a new one.
    this.cancelCurrentSource();
    const playId = ++this.playId;

    this.publish({
      state: 'requested',
      audioArtifactId,
      audioMimeType,
      reason: null,
    });

    if (audioMimeType === SYNTHETIC_AUDIO_MIME_TYPE) {
      // Fail-close: synthetic mime is frames-only. Skip audio entirely; lipsync
      // frame batch remains the authoritative mouth driver. This is INTENTIONAL
      // and not an error path — log once at warn so the operator can confirm
      // synthetic vs real-TTS routing without burying real failures.
      this.logger.warn('synthetic_audio_no_playback', {
        audio_artifact_id: audioArtifactId,
        audio_mime_type: audioMimeType,
      });
      this.publish({
        state: 'completed',
        audioArtifactId,
        audioMimeType,
        reason: 'synthetic_audio_no_playback',
      });
      return;
    }

    if (!isPlayableMimeType(audioMimeType)) {
      this.logger.warn('unsupported_audio_mime_type', {
        audio_artifact_id: audioArtifactId,
        audio_mime_type: audioMimeType,
      });
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'unsupported_audio_mime_type',
      });
      return;
    }

    if (!input.fetchBytes) {
      this.logger.warn('audio_fetch_bytes_unavailable', {
        audio_artifact_id: audioArtifactId,
        audio_mime_type: audioMimeType,
      });
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'audio_fetch_bytes_unavailable',
      });
      return;
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await input.fetchBytes();
    } catch (err) {
      this.logger.warn('audio_fetch_bytes_failed', {
        audio_artifact_id: audioArtifactId,
        error: errorMessage(err),
      });
      if (this.playId !== playId) return;
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'audio_fetch_bytes_failed',
      });
      return;
    }

    if (this.playId !== playId) return;

    const context = this.ensureContext();
    if (!context) {
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'audio_context_unavailable',
      });
      return;
    }

    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(bytes.slice(0));
    } catch (err) {
      this.logger.warn('audio_decode_failed', {
        audio_artifact_id: audioArtifactId,
        error: errorMessage(err),
      });
      if (this.playId !== playId) return;
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'audio_decode_failed',
      });
      return;
    }
    if (this.playId !== playId) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.currentSource = source;
    source.onended = () => {
      if (this.playId !== playId) return;
      this.currentSource = null;
      // If the snapshot is already `interrupted` / `failed`, do not overwrite.
      if (this.snapshot.state === 'started') {
        this.publish({
          state: 'completed',
          audioArtifactId,
          audioMimeType,
          reason: null,
        });
      }
    };
    try {
      source.start();
    } catch (err) {
      this.logger.warn('audio_start_failed', {
        audio_artifact_id: audioArtifactId,
        error: errorMessage(err),
      });
      this.currentSource = null;
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'audio_start_failed',
      });
      return;
    }
    this.publish({
      state: 'started',
      audioArtifactId,
      audioMimeType,
      reason: null,
    });
  }

  stop(reason: 'interrupted' | 'completed' = 'interrupted'): void {
    this.cancelCurrentSource();
    if (this.snapshot.state === 'idle' || this.snapshot.state === 'completed' || this.snapshot.state === 'interrupted' || this.snapshot.state === 'failed') {
      return;
    }
    this.publish({
      ...this.snapshot,
      state: reason,
    });
  }

  reset(): void {
    this.cancelCurrentSource();
    this.publish(idleSnapshot);
  }

  private cancelCurrentSource(): void {
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
      } catch {
        // Already stopped or never started.
      }
      this.currentSource = null;
    }
    this.playId += 1;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const created = this.contextFactory();
    if (!created) return null;
    this.context = created;
    return created;
  }

  private publish(snapshot: AudioPlaybackSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function isPlayableMimeType(mime: string): boolean {
  return PLAYABLE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function defaultAudioContextFactory(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!ctor) return null;
  try {
    return new ctor();
  } catch {
    return null;
  }
}

let sharedController: AudioPlaybackController | null = null;

export function getSharedAudioPlaybackController(): AudioPlaybackController {
  if (!sharedController) {
    sharedController = new AudioPlaybackController();
  }
  return sharedController;
}

export function resetSharedAudioPlaybackControllerForTesting(): void {
  sharedController = null;
}
