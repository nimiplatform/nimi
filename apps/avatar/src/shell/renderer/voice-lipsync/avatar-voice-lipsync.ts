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
//     `runtime.artifacts.readBytes` (S-RUNTIME-111).
//   - The Live2D-specific mouth bridge instance is dropped; topic-internal
//     wave_1 lands the Live2D wLipSync driver module for the Cubism
//     `ParamMouthOpenY` / `ParamMouthForm` write path. Wave 0 close gate
//     accepts that the Live2D mouth is dormant until that driver lands.
//
// What this orchestrator still does:
//   - Subscribe to `runtime.agent.presentation.voice_playback_requested`.
//   - Mirror the runtime playback state machine (requested / started /
//     completed / interrupted / canceled / failed) into the avatar voice
//     state bus + the audio pipeline controller.
//   - Stop / interrupt the audio pipeline on `runtime.agent.turn.interrupted`
//     and `runtime.agent.turn.interrupt_ack`.
//
// Optional `backend?: BackendBranch` argument: when supplied, this
// orchestrator registers the backend's BackendAudioConsumer with the audio
// pipeline as its lipsync sink. Topic-internal wave_1 wires this in
// avatar-carrier.ts; wave_0 callers pass nothing (sink stays unregistered;
// audio still plays, mouth stays dormant).

import type { AgentDataDriver, AgentEvent } from '../driver/types.js';
import type { BackendBranch } from '../carrier/backend-branch.js';
import {
  AudioPipelineController,
  getSharedAudioPipelineController,
} from '../audio/audio-pipeline.js';
import {
  getSharedVoiceLipsyncStateBus,
  type VoiceLipsyncStateBus,
} from './voice-lipsync-state-bus.js';
import type { AudioPlaybackState } from '../voice-companion-state.js';

type RuntimeTimelineDetail = {
  turn_id: string;
  stream_id: string;
  channel: 'text' | 'voice' | 'avatar' | 'state' | 'lipsync';
  offset_ms: number;
  sequence: number;
  started_at_wall: string;
  observed_at_wall: string;
  timebase_owner: 'runtime';
  projection_rule_id: 'K-AGCORE-051';
  clock_basis: 'monotonic_with_wall_anchor';
  provider_neutral: true;
  app_local_authority: false;
};

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

function readFiniteNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseRuntimeTimeline(detail: Record<string, unknown>): RuntimeTimelineDetail | null {
  const timeline = readRecord(detail['runtime_timeline']);
  if (!timeline) return null;
  const turnId = readString(timeline, 'turn_id');
  const streamId = readString(timeline, 'stream_id');
  const channel = readString(timeline, 'channel');
  const offsetMs = readFiniteNumber(timeline, 'offset_ms');
  const sequence = readFiniteNumber(timeline, 'sequence');
  const startedAtWall = readString(timeline, 'started_at_wall');
  const observedAtWall = readString(timeline, 'observed_at_wall');
  const timebaseOwner = timeline['timebase_owner'];
  const projectionRuleId = timeline['projection_rule_id'];
  const clockBasis = timeline['clock_basis'];
  const providerNeutral = timeline['provider_neutral'];
  const appLocalAuthority = timeline['app_local_authority'];
  if (
    !turnId ||
    !streamId ||
    (channel !== 'text' && channel !== 'voice' && channel !== 'avatar' && channel !== 'state' && channel !== 'lipsync') ||
    offsetMs === null ||
    sequence === null ||
    offsetMs < 0 ||
    sequence <= 0 ||
    !Number.isInteger(sequence) ||
    !startedAtWall ||
    !observedAtWall ||
    timebaseOwner !== 'runtime' ||
    projectionRuleId !== 'K-AGCORE-051' ||
    clockBasis !== 'monotonic_with_wall_anchor' ||
    providerNeutral !== true ||
    appLocalAuthority !== false
  ) {
    return null;
  }
  if (detail['turn_id'] !== turnId || detail['stream_id'] !== streamId) {
    return null;
  }
  return {
    turn_id: turnId,
    stream_id: streamId,
    channel,
    offset_ms: offsetMs,
    sequence,
    started_at_wall: startedAtWall,
    observed_at_wall: observedAtWall,
    timebase_owner: 'runtime',
    projection_rule_id: 'K-AGCORE-051',
    clock_basis: 'monotonic_with_wall_anchor',
    provider_neutral: true,
    app_local_authority: false,
  };
}

function timelineIdentity(timeline: RuntimeTimelineDetail): string {
  return `${timeline.turn_id}:${timeline.stream_id}`;
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
      turn_id: timeline.turn_id,
      stream_id: timeline.stream_id,
      runtime_timeline: timeline,
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
    const timeline = parseRuntimeTimeline(detail);
    const streamId = timeline?.stream_id ?? readString(detail, 'stream_id');
    const turnId = timeline?.turn_id ?? readString(detail, 'turn_id');
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

  function handleVoicePlaybackRequested(
    event: AgentEvent,
    detail: Record<string, unknown>,
  ): boolean {
    if (event.name !== 'runtime.agent.presentation.voice_playback_requested') {
      return false;
    }
    const state = readString(detail, 'playbackState') ?? readString(detail, 'playback_state');
    if (state === null) return false;
    const timeline = parseRuntimeTimeline(detail);
    const audioArtifactId =
      readString(detail, 'audioArtifactId') ?? readString(detail, 'audio_artifact_id');
    const audioMimeType =
      readString(detail, 'audioMimeType') ?? readString(detail, 'audio_mime_type');

    if (state === 'requested') {
      if (!timeline || timeline.channel !== 'voice' || !audioArtifactId || !audioMimeType) {
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

  return {
    handleEvent(event) {
      if (disposed) return;
      const detail = readRecord(event.detail);
      if (!detail) return;
      if (
        event.name === 'runtime.agent.turn.interrupted' ||
        event.name === 'runtime.agent.turn.interrupt_ack'
      ) {
        handleInterrupt(event, detail);
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
      if (unregisterSink) unregisterSink();
    },
  };
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
    return consumer as import('../carrier/backend-branch.js').BackendAudioConsumer;
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
