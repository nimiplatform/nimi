// Wave 0 of topic 2026-04-30-avatar-vrm-backend-branch admit (design-05).
//
// AudioPipelineController consumes `runtime.agent.presentation.voice_playback_requested`
// events through SDK Runtime artifacts; runtime owns the lifecycle
// (`requested → started → completed | interrupted | failed`) and this
// controller mirrors it 1:1 for avatar surfaces.
//
// Wave 0 hard-cut (B2.A+):
//   - The caller-injected byte fetcher is removed. Bytes are read
//     from `runtime.artifacts.readBytes({ artifactId, expectedMimePrefix:
//     'audio/' })` (S-RUNTIME-111; admitted by this topic).
//   - `registerLipsyncSink(consumer)` connects a per-backend lipsync sink.
//     The pipeline attaches the active
//     AudioBufferSourceNode to the registered sink in the same lifecycle
//     window where it connects the source to speaker output.
//   - Synthetic mime path:  sink.silent() + publishState('completed').
//   - All other failure paths: sink.silent() + publishState('failed', reasonCode).
//
// AudioContext is a per-document singleton; constructing more than one is
// wasteful and the platform refuses to create one without a user gesture, so
// reuse is mandatory.

import type { Runtime } from '@nimiplatform/sdk/runtime/browser';

export type AvatarAudioPipelineSinkSnapshot = {
  weights: Record<'A' | 'E' | 'I' | 'O' | 'U' | 'S', number>;
  volume: number;
} | null;

export interface AvatarAudioPipelineSink {
  attachAudioSource(source: AudioBufferSourceNode, context: AudioContext): Promise<void>;
  detachAudioSource(): void;
  silent(): void;
  snapshot(): AvatarAudioPipelineSinkSnapshot;
}

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

export type AudioPipelinePlayInput = {
  audioArtifactId: string;
  audioMimeType: string;
  durationMs?: number;
};

export type AudioPipelineListener = (snapshot: AudioPlaybackSnapshot) => void;

type AudioPipelineLogger = Pick<typeof console, 'warn' | 'error'>;

type AudioPipelineOptions = {
  audioContextFactory?: () => AudioContext | null;
  logger?: AudioPipelineLogger;
};

const idleSnapshot: AudioPlaybackSnapshot = Object.freeze({
  state: 'idle',
  audioArtifactId: null,
  audioMimeType: null,
  reason: null,
});

export class AudioPipelineController {
  private listeners = new Set<AudioPipelineListener>();
  private snapshot: AudioPlaybackSnapshot = idleSnapshot;
  private context: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private playId = 0;
  private runtime: Runtime | null = null;
  private sink: AvatarAudioPipelineSink | null = null;
  private readonly contextFactory: () => AudioContext | null;
  private readonly logger: AudioPipelineLogger;

  constructor(options: AudioPipelineOptions = {}) {
    this.contextFactory = options.audioContextFactory ?? defaultAudioContextFactory;
    this.logger = options.logger ?? console;
  }

  /** Bootstrap calls this once after constructing the SDK Runtime instance.
   *  Idempotent; subsequent calls are ignored to keep a single Runtime
   *  authority over `play()` requests. */
  setRuntime(runtime: Runtime): void {
    if (!this.runtime) {
      this.runtime = runtime;
    }
  }

  /** Register a backend lipsync sink. One sink at a time (mutually exclusive
   *  by design — only one BackendBranch is active per carrier). Returns an
   *  unregister fn that detaches + clears the sink slot if still current. */
  registerLipsyncSink(consumer: AvatarAudioPipelineSink): () => void {
    if (this.sink && this.sink !== consumer) {
      this.sink.detachAudioSource();
    }
    this.sink = consumer;
    if (this.currentSource && this.context) {
      void consumer.attachAudioSource(this.currentSource, this.context).catch((err) => {
        this.logger.warn('audio_sink_attach_failed_on_register', {
          error: errorMessage(err),
        });
      });
    }
    return () => {
      if (this.sink === consumer) {
        consumer.detachAudioSource();
        this.sink = null;
      }
    };
  }

  getSnapshot(): AudioPlaybackSnapshot {
    return this.snapshot;
  }

  subscribe(listener: AudioPipelineListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async play(input: AudioPipelinePlayInput): Promise<void> {
    const audioArtifactId = input.audioArtifactId.trim();
    const audioMimeType = input.audioMimeType.trim();
    const audioMimeTypeKey = audioMimeType.toLowerCase();
    if (!audioArtifactId || !audioMimeType) {
      this.sink?.silent();
      this.publish({
        state: 'failed',
        audioArtifactId: audioArtifactId || null,
        audioMimeType: audioMimeType || null,
        reason: 'missing_audio_identity',
      });
      return;
    }

    this.cancelCurrentSource();
    const playId = ++this.playId;

    this.publish({
      state: 'requested',
      audioArtifactId,
      audioMimeType,
      reason: null,
    });

    if (audioMimeTypeKey === SYNTHETIC_AUDIO_MIME_TYPE) {
      // Wave 0 hard-cut: synthetic mime is silent voice + silent mouth. The
      // consumer state machine still progresses to `completed` so upstream
      // lifecycle is not stuck. K-AGCORE-053 admits this fail-close.
      this.logger.warn('synthetic_audio_no_playback_no_lipsync', {
        audio_artifact_id: audioArtifactId,
        audio_mime_type: audioMimeType,
      });
      this.sink?.silent();
      this.publish({
        state: 'completed',
        audioArtifactId,
        audioMimeType,
        reason: 'synthetic_audio_no_playback',
      });
      return;
    }

    if (!isPlayableMimeType(audioMimeTypeKey)) {
      this.logger.warn('unsupported_audio_mime_type', {
        audio_artifact_id: audioArtifactId,
        audio_mime_type: audioMimeType,
      });
      this.sink?.silent();
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'unsupported_mime',
      });
      return;
    }

    if (!this.runtime) {
      this.logger.warn('audio_pipeline_no_runtime', {
        audio_artifact_id: audioArtifactId,
      });
      this.sink?.silent();
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'no_runtime',
      });
      return;
    }

    let result: { bytes: ArrayBuffer; mimeType: string; sizeBytes: number };
    try {
      result = await this.runtime.artifacts.readBytes({
        artifactId: audioArtifactId,
        expectedMimePrefix: 'audio/',
      });
    } catch (err) {
      const reasonCode = readReasonCode(err);
      this.logger.warn('audio_artifact_read_failed', {
        audio_artifact_id: audioArtifactId,
        reason_code: reasonCode,
        error: errorMessage(err),
      });
      if (this.playId !== playId) return;
      this.sink?.silent();
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: reasonCode,
      });
      return;
    }
    if (this.playId !== playId) return;

    const context = this.ensureContext();
    if (!context) {
      this.sink?.silent();
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'no_audio_context',
      });
      return;
    }

    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(result.bytes.slice(0));
    } catch (err) {
      this.logger.warn('audio_decode_failed', {
        audio_artifact_id: audioArtifactId,
        error: errorMessage(err),
      });
      if (this.playId !== playId) return;
      this.sink?.silent();
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'decode_failed',
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
      this.sink?.detachAudioSource();
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
      this.sink?.silent();
      this.publish({
        state: 'failed',
        audioArtifactId,
        audioMimeType,
        reason: 'start_failed',
      });
      return;
    }

    this.publish({
      state: 'started',
      audioArtifactId,
      audioMimeType,
      reason: null,
    });

    if (this.sink) {
      // attachAudioSource is async (lazy createWLipSyncNode on first call).
      // Failure inside the sink is bounded: lipsync goes silent, audio
      // playback continues unimpeded.
      void this.sink.attachAudioSource(source, context).catch((err) => {
        this.logger.warn('audio_sink_attach_failed', {
          audio_artifact_id: audioArtifactId,
          error: errorMessage(err),
        });
        this.sink?.silent();
      });
    }
  }

  stop(reason: 'interrupted' | 'completed' = 'interrupted'): void {
    this.cancelCurrentSource();
    if (
      this.snapshot.state === 'idle' ||
      this.snapshot.state === 'completed' ||
      this.snapshot.state === 'interrupted' ||
      this.snapshot.state === 'failed'
    ) {
      return;
    }
    this.sink?.silent();
    this.publish({
      ...this.snapshot,
      state: reason,
    });
  }

  reset(): void {
    this.cancelCurrentSource();
    this.sink?.silent();
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
      this.sink?.detachAudioSource();
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

function readReasonCode(error: unknown): string {
  if (error && typeof error === 'object' && 'reasonCode' in error) {
    const value = (error as { reasonCode?: unknown }).reasonCode;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return 'fetch_failed';
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

let sharedController: AudioPipelineController | null = null;

export function getSharedAudioPipelineController(): AudioPipelineController {
  if (!sharedController) {
    sharedController = new AudioPipelineController();
  }
  return sharedController;
}

export function resetSharedAudioPipelineControllerForTesting(): void {
  sharedController = null;
}
