// Wave 0 of topic 2026-04-30-avatar-vrm-backend-branch admit (design-05 §
// "avatar-voice-lipsync.ts 重构"; design-09 §"kill list").
//
// Wave 0 hard-cut surface:
//   - The deprecated runtime presentation per-frame mouth-batch consume
//     path is deleted. Per-frame mouth movement now flows through
//     `BackendAudioConsumer.snapshot()` in the surface useFrame loop,
//     written by the wLipSync driver. Avatar app no longer subscribes to
//     that runtime event (platform-side emit deprecation is a separate
//     topic).
//   - The caller-injected audio-bytes fetcher is removed. Audio
//     bytes are read directly by AudioPipelineController via
//     `runtime.artifacts.readArtifactBytes` (S-RUNTIME-111).
//   - The Live2D-specific mouth bridge instance is dropped; topic-internal
//     wave_1 lands the Live2D wLipSync driver module for the Cubism
//     `ParamMouthOpenY` / `ParamMouthForm` write path. Wave 0 close gate
//     accepts that the Live2D mouth is dormant until that driver lands.
//
// What this orchestrator still does:
//   - Subscribe to `runtime.agent.presentation.voice_playback_requested`,
//     ordered `voice_stream_chunk_available`, and `voice_playback_terminal`
//     events.
//   - Mirror the runtime playback state machine (requested / started /
//     completed / interrupted / canceled / failed) into the avatar voice
//     state bus + the audio pipeline controller.
//   - Stop / interrupt the audio pipeline on Runtime-owned voice terminal
//     projection. Chat-turn interrupt remains a compatibility stop signal only.
//
// Optional `backend?: BackendBranch` argument: when supplied, this
// orchestrator registers the backend's BackendAudioConsumer with the audio
// pipeline as its lipsync sink. Topic-internal wave_1 wires this in
// avatar-carrier.ts; wave_0 callers pass nothing (sink stays unregistered;
// audio still plays, mouth stays dormant).

import type { AgentDataDriver, AgentEvent } from '../driver/types.js';
import {
  parseNimiRuntimeAgentTimeline,
  type NimiRuntimeAgentTimelineEnvelope,
} from '@nimiplatform/sdk/runtime';
import type { BackendAudioConsumer, BackendBranch } from '../carrier/backend-branch.js';
import {
  AudioPipelineController,
  getSharedAudioPipelineController,
  getSharedVoiceLipsyncStateBus,
  type AudioPlaybackState,
  type VoiceLipsyncStateBus,
} from '@nimiplatform/kit/features/avatar/headless';
import { recordAvatarEvidenceEventually } from '../app-shell/avatar-evidence.js';

type RuntimeTimelineDetail = NimiRuntimeAgentTimelineEnvelope;
type VoicePlaybackInput = {
  audioArtifactId: string;
  audioMimeType: string;
};
type VoiceBytesInput = {
  audioSourceId: string;
  audioMimeType: string;
  bytes: Uint8Array | ArrayBuffer;
};
type NativeVoiceChunkInput = VoiceBytesInput & {
  voiceStreamId: string;
  chunkSequence: number;
};

const AVATAR_AUTOPLAY_TARGET = 'avatar_autoplay';

export type AvatarVoiceLipsyncPipeline = {
  handleEvent(event: AgentEvent): void;
  dispose(): void;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readBoolean(record: Record<string, unknown>, camelKey: string, snakeKey: string): boolean | null {
  const value = record[camelKey] ?? record[snakeKey];
  return typeof value === 'boolean' ? value : null;
}

function readPlaybackTarget(detail: Record<string, unknown>): string | null {
  return readString(detail, 'playbackTarget') ?? readString(detail, 'playback_target');
}

function parseRuntimeTimeline(
  detail: Record<string, unknown>,
  messageType: string,
): RuntimeTimelineDetail | null {
  const turnId = readString(detail, 'turn_id');
  const streamId = readString(detail, 'stream_id');
  if (!turnId || !streamId) {
    return null;
  }
  try {
    return parseNimiRuntimeAgentTimeline(
      detail['runtime_timeline'],
      messageType,
      turnId,
      streamId,
    );
  } catch {
    return null;
  }
}

function timelineIdentity(timeline: RuntimeTimelineDetail): string {
  return `${timeline.turnId}:${timeline.streamId}`;
}

function toRuntimeTimelineDetail(timeline: RuntimeTimelineDetail): Record<string, unknown> {
  return {
    turn_id: timeline.turnId,
    stream_id: timeline.streamId,
    channel: timeline.channel,
    offset_ms: timeline.offsetMs,
    sequence: timeline.sequence,
    started_at_wall: timeline.startedAtWall,
    observed_at_wall: timeline.observedAtWall,
    timebase_owner: timeline.timebaseOwner,
    projection_rule_id: timeline.projectionRuleId,
    clock_basis: timeline.clockBasis,
    provider_neutral: timeline.providerNeutral,
    app_local_authority: timeline.appLocalAuthority,
  };
}

function emitDriverEvent(
  driver: AgentDataDriver,
  name: string,
  timeline: RuntimeTimelineDetail,
  detail: Record<string, unknown> = {},
): void {
  driver.emit({
    name,
    detail: {
      ...detail,
      turn_id: timeline.turnId,
      stream_id: timeline.streamId,
      runtime_timeline: toRuntimeTimelineDetail(timeline),
    },
  });
}

export function createAvatarVoiceLipsyncPipeline(input: {
  driver: AgentDataDriver;
  stateBus?: VoiceLipsyncStateBus;
  audioPipeline?: AudioPipelineController;
  backend?: BackendBranch;
}): AvatarVoiceLipsyncPipeline {
  const canceled = new Set<string>();
  const streamingPlaybackChains = new Map<string, Promise<void>>();
  const streamingTimelines = new Set<string>();
  let disposed = false;
  const stateBus = input.stateBus ?? getSharedVoiceLipsyncStateBus();
  const audioPipeline = input.audioPipeline ?? getSharedAudioPipelineController();
  const unregisterSink = input.backend
    ? audioPipeline.registerLipsyncSink(getBackendAudioConsumer(input.backend))
    : null;

  function publishPlaybackState(state: AudioPlaybackState): void {
    stateBus.publish({ kind: 'audio_playback_state', state });
  }

  function handleInterrupt(event: AgentEvent, detail: Record<string, unknown>): void {
    const timeline = parseRuntimeTimeline(detail, event.name);
    const streamId = timeline?.streamId ?? readString(detail, 'stream_id');
    const turnId = timeline?.turnId ?? readString(detail, 'turn_id');
    if (!streamId || !turnId) return;
    canceled.add(`${turnId}:${streamId}`);
    audioPipeline.stop('interrupted');
    stateBus.publish({ kind: 'deactivate' });
    publishPlaybackState('interrupted');
    if (timeline) {
      emitDriverEvent(input.driver, 'avatar.speak.interrupt', timeline, {
        source_event_name: event.name,
      });
    }
  }

  function playVoiceArtifactAndWait(voiceInput: VoicePlaybackInput): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => {};
      const settle = () => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve();
      };
      unsubscribe = audioPipeline.subscribe((snapshot) => {
        if (snapshot.audioArtifactId !== voiceInput.audioArtifactId) return;
        if (
          snapshot.state === 'completed' ||
          snapshot.state === 'failed' ||
          snapshot.state === 'interrupted'
        ) {
          settle();
        }
      });
      void audioPipeline.play(voiceInput).catch(() => {
        settle();
      });
    });
  }

  function playVoiceBytesAndWait(voiceInput: VoiceBytesInput): Promise<AudioPlaybackState> {
    return new Promise((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => {};
      const settle = (state: AudioPlaybackState) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(state);
      };
      unsubscribe = audioPipeline.subscribe((snapshot) => {
        if (snapshot.audioArtifactId !== voiceInput.audioSourceId) return;
        if (
          snapshot.state === 'completed' ||
          snapshot.state === 'failed' ||
          snapshot.state === 'interrupted'
        ) {
          settle(snapshot.state);
        }
      });
      void audioPipeline.playBytes(voiceInput).catch(() => {
        settle('failed');
      });
    });
  }

  function enqueueStreamingChunk(
    timeline: RuntimeTimelineDetail,
    voiceInput: VoicePlaybackInput,
  ): void {
    const identity = timelineIdentity(timeline);
    streamingTimelines.add(identity);
    const previous = streamingPlaybackChains.get(identity) ?? Promise.resolve();
    let next: Promise<void>;
    next = previous
      .catch(() => undefined)
      .then(async () => {
        if (disposed || canceled.has(identity)) return;
        stateBus.publish({ kind: 'activate', audioArtifactId: voiceInput.audioArtifactId });
        publishPlaybackState('requested');
        await playVoiceArtifactAndWait(voiceInput);
      })
      .finally(() => {
        if (streamingPlaybackChains.get(identity) === next) {
          streamingPlaybackChains.delete(identity);
        }
      });
    streamingPlaybackChains.set(identity, next);
  }

  function enqueueNativeAudioChunk(
    identity: string,
    voiceInput: NativeVoiceChunkInput,
  ): void {
    const previous = streamingPlaybackChains.get(identity) ?? Promise.resolve();
    let next: Promise<void>;
    next = previous
      .catch(() => undefined)
      .then(async () => {
        if (disposed || canceled.has(identity)) return;
        stateBus.publish({ kind: 'activate', audioArtifactId: voiceInput.audioSourceId });
        publishPlaybackState('requested');
        const playbackState = await playVoiceBytesAndWait({
          audioSourceId: voiceInput.audioSourceId,
          audioMimeType: voiceInput.audioMimeType,
          bytes: voiceInput.bytes,
        });
        recordAvatarEvidenceEventually({
          kind: playbackState === 'completed'
            ? 'avatar.audio.native_stream_chunk_played'
            : 'avatar.audio.native_stream_chunk_failed',
          detail: {
            voice_stream_id: voiceInput.voiceStreamId,
            chunk_sequence: voiceInput.chunkSequence,
            audio_source_id: voiceInput.audioSourceId,
            audio_mime_type: voiceInput.audioMimeType,
            byte_length: voiceInput.bytes.byteLength,
            playback_state: playbackState,
          },
        });
      })
      .finally(() => {
        if (streamingPlaybackChains.get(identity) === next) {
          streamingPlaybackChains.delete(identity);
        }
      });
    streamingPlaybackChains.set(identity, next);
  }

  function handleNativeAudioChunk(
    event: AgentEvent,
    detail: Record<string, unknown>,
  ): boolean {
    if (event.name !== 'avatar.speak.native_audio_chunk') {
      return false;
    }
    const voiceStreamId = readString(detail, 'voice_stream_id') ?? readString(detail, 'voiceStreamId');
    const audioMimeType = readString(detail, 'audio_mime_type') ?? readString(detail, 'audioMimeType');
    const bytes = readBytes(detail['chunk_bytes'] ?? detail['chunkBytes']);
    const chunkSequence = Number(detail['chunk_sequence'] ?? detail['chunkSequence'] ?? 0);
    if (!voiceStreamId || !audioMimeType || !bytes || !Number.isFinite(chunkSequence) || chunkSequence <= 0) {
      return true;
    }
    const sourceId = `runtime-agent-voice-stream://${voiceStreamId}/chunks/${String(chunkSequence).padStart(6, '0')}`;
    enqueueNativeAudioChunk(`native:${voiceStreamId}`, {
      audioSourceId: sourceId,
      audioMimeType,
      bytes,
      voiceStreamId,
      chunkSequence,
    });
    return true;
  }

  function handleNativeAudioStreamFailed(
    event: AgentEvent,
    detail: Record<string, unknown>,
  ): boolean {
    if (event.name !== 'avatar.speak.native_audio_stream_failed') {
      return false;
    }
    const voiceStreamId = readString(detail, 'voice_stream_id') ?? readString(detail, 'voiceStreamId');
    if (!voiceStreamId) {
      return true;
    }
    recordAvatarEvidenceEventually({
      kind: 'avatar.audio.native_stream_subscription_failed',
      detail: {
        voice_stream_id: voiceStreamId,
        turn_id: readString(detail, 'turn_id') ?? readString(detail, 'turnId') ?? null,
        stream_id: readString(detail, 'stream_id') ?? readString(detail, 'streamId') ?? null,
        reason: readString(detail, 'reason') ?? 'native_audio_stream_failed',
      },
    });
    return true;
  }

  function handleVoicePlaybackRequested(
    event: AgentEvent,
    detail: Record<string, unknown>,
  ): boolean {
    if (event.name !== 'runtime.agent.presentation.voice_playback_requested') {
      return false;
    }
    const state = readString(detail, 'playbackState') ?? readString(detail, 'playback_state');
    if (state === null) return false;
    const timeline = parseRuntimeTimeline(detail, event.name);
    const audioArtifactId =
      readString(detail, 'audioArtifactId') ?? readString(detail, 'audio_artifact_id');
    const audioMimeType =
      readString(detail, 'audioMimeType') ?? readString(detail, 'audio_mime_type');
    const playbackTarget = readPlaybackTarget(detail);
    if (playbackTarget !== AVATAR_AUTOPLAY_TARGET) {
      return true;
    }

    if (state === 'requested') {
      if (!timeline || timeline.channel !== 'voice' || !audioArtifactId || !audioMimeType) {
        return true;
      }
      if (streamingTimelines.has(timelineIdentity(timeline))) {
        return true;
      }
      stateBus.publish({ kind: 'activate', audioArtifactId });
      void audioPipeline.play({ audioArtifactId, audioMimeType });
      publishPlaybackState('requested');
      return true;
    }

    if (state === 'started') {
      publishPlaybackState('started');
      return true;
    }

    if (state === 'completed') {
      publishPlaybackState('completed');
      return true;
    }

    if (state === 'interrupted' || state === 'canceled' || state === 'failed') {
      if (!timeline || timeline.channel !== 'voice') return true;
      canceled.add(timelineIdentity(timeline));
      streamingTimelines.delete(timelineIdentity(timeline));
      audioPipeline.stop('interrupted');
      stateBus.publish({ kind: 'deactivate' });
      publishPlaybackState(state === 'failed' ? 'failed' : 'interrupted');
      emitDriverEvent(input.driver, 'avatar.speak.interrupt', timeline, {
        source_event_name: event.name,
        playback_state: state,
        audio_artifact_id: audioArtifactId,
      });
      return true;
    }

    return false;
  }

  function handleVoiceStreamChunkAvailable(
    event: AgentEvent,
    detail: Record<string, unknown>,
  ): boolean {
    if (event.name !== 'runtime.agent.presentation.voice_stream_chunk_available') {
      return false;
    }
    if (readPlaybackTarget(detail) !== AVATAR_AUTOPLAY_TARGET) {
      return true;
    }
    const finalChunk = readBoolean(detail, 'finalChunk', 'final_chunk') ?? false;
    if (finalChunk) {
      return true;
    }
    const timeline = parseRuntimeTimeline(detail, event.name);
    const audioArtifactId =
      readString(detail, 'audioArtifactId') ?? readString(detail, 'audio_artifact_id');
    const audioMimeType =
      readString(detail, 'audioMimeType') ?? readString(detail, 'audio_mime_type');
    const voiceStreamId =
      readString(detail, 'voiceStreamId') ?? readString(detail, 'voice_stream_id');
    const chunkTransportRef =
      readString(detail, 'chunkTransportRef') ?? readString(detail, 'chunk_transport_ref');
    if (!timeline || timeline.channel !== 'voice') {
      return true;
    }
    if (!audioArtifactId || !audioMimeType) {
      if (voiceStreamId && chunkTransportRef) {
        recordAvatarEvidenceEventually({
          kind: 'avatar.audio.native_stream_projection_received',
          detail: {
            voice_stream_id: voiceStreamId,
            chunk_transport_ref: chunkTransportRef,
            chunk_sequence: Number(detail['chunk_sequence'] ?? detail['chunkSequence'] ?? 0),
            turn_id: timeline.turnId,
            stream_id: timeline.streamId,
            playback_target: readPlaybackTarget(detail),
          },
        });
        streamingTimelines.add(timelineIdentity(timeline));
        publishPlaybackState('requested');
        emitDriverEvent(input.driver, 'avatar.speak.stream_chunk_available', timeline, {
          source_event_name: event.name,
          voice_stream_id: voiceStreamId,
          chunk_transport_ref: chunkTransportRef,
        });
      }
      return true;
    }
    enqueueStreamingChunk(timeline, { audioArtifactId, audioMimeType });
    return true;
  }

  function handleVoicePlaybackTerminal(
    event: AgentEvent,
    detail: Record<string, unknown>,
  ): boolean {
    if (event.name !== 'runtime.agent.presentation.voice_playback_terminal') {
      return false;
    }
    if (readPlaybackTarget(detail) !== AVATAR_AUTOPLAY_TARGET) {
      return true;
    }
    const timeline = parseRuntimeTimeline(detail, event.name);
    if (!timeline || timeline.channel !== 'voice') {
      return true;
    }
    const identity = timelineIdentity(timeline);
    streamingTimelines.delete(identity);
    const state =
      readString(detail, 'voicePlaybackState') ?? readString(detail, 'voice_playback_state');
    if (state === 'completed') {
      publishPlaybackState('completed');
      return true;
    }
    if (state === 'interrupted' || state === 'canceled' || state === 'failed') {
      canceled.add(identity);
      const terminalVoiceStreamId =
        readString(detail, 'voiceStreamId') ?? readString(detail, 'voice_stream_id');
      if (terminalVoiceStreamId) {
        canceled.add(`native:${terminalVoiceStreamId}`);
      }
      audioPipeline.stop('interrupted');
      stateBus.publish({ kind: 'deactivate' });
      publishPlaybackState(state === 'failed' ? 'failed' : 'interrupted');
      emitDriverEvent(input.driver, 'avatar.speak.interrupt', timeline, {
        source_event_name: event.name,
        playback_state: state,
        voice_stream_id: terminalVoiceStreamId,
        terminal_reason: readString(detail, 'terminalReason') ?? readString(detail, 'terminal_reason'),
      });
      return true;
    }
    return true;
  }

  return {
    handleEvent(event) {
      if (disposed) return;
      const detail = readRecord(event.detail);
      if (!detail) return;
      if (handleNativeAudioChunk(event, detail)) {
        return;
      }
      if (handleNativeAudioStreamFailed(event, detail)) {
        return;
      }
      if (
        event.name === 'runtime.agent.turn.interrupted' ||
        event.name === 'runtime.agent.turn.interrupt_ack'
      ) {
        handleInterrupt(event, detail);
        return;
      }
      if (handleVoiceStreamChunkAvailable(event, detail)) {
        return;
      }
      if (handleVoicePlaybackTerminal(event, detail)) {
        return;
      }
      handleVoicePlaybackRequested(event, detail);
    },
    dispose() {
      disposed = true;
      audioPipeline.stop('interrupted');
      stateBus.publish({ kind: 'deactivate' });
      publishPlaybackState('idle');
      canceled.clear();
      streamingPlaybackChains.clear();
      streamingTimelines.clear();
      if (unregisterSink) unregisterSink();
    },
  };
}

function readBytes(value: unknown): Uint8Array | ArrayBuffer | null {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return value;
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  return null;
}

function getBackendAudioConsumer(backend: BackendBranch) {
  // Wave_1 (topic-internal) attaches BackendAudioConsumer onto BackendBranch
  // via surface lifecycle; wave_0 admits the carrier-branch types but the
  // factory + surface mount aren't built yet. This helper reads the consumer
  // off the backend if the field is present, else throws — never returns
  // a stub: silent stubs hide wiring drift.
  const consumer = (backend as unknown as { audioConsumer?: unknown }).audioConsumer;
  if (
    consumer &&
    typeof consumer === 'object' &&
    typeof (consumer as { attachAudioSource?: unknown }).attachAudioSource === 'function' &&
    typeof (consumer as { detachAudioSource?: unknown }).detachAudioSource === 'function' &&
    typeof (consumer as { silent?: unknown }).silent === 'function' &&
    typeof (consumer as { snapshot?: unknown }).snapshot === 'function'
  ) {
    return consumer as BackendAudioConsumer;
  }
  throw new Error(
    'avatar-voice-lipsync: backend.audioConsumer missing (BackendAudioConsumer) — wave_1 carrier wiring required',
  );
}

export function wireAvatarVoiceLipsync(input: {
  driver: AgentDataDriver;
  stateBus?: VoiceLipsyncStateBus;
  audioPipeline?: AudioPipelineController;
  backend?: BackendBranch;
}): () => void {
  const pipeline = createAvatarVoiceLipsyncPipeline(input);
  const unwire = input.driver.onEvent((event) => pipeline.handleEvent(event));
  return () => {
    unwire();
    pipeline.dispose();
  };
}
