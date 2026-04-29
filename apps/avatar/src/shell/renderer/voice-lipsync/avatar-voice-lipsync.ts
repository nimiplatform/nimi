import type { AgentDataDriver, AgentEvent } from '../driver/types.js';
import type { EmbodimentProjectionApi } from '../nas/embodiment-projection-api.js';
import {
  AudioPlaybackController,
  getSharedAudioPlaybackController,
  type AudioPlaybackPlayInput,
} from '../audio/audio-playback.js';
import {
  getSharedVoiceLipsyncStateBus,
  type VoiceLipsyncStateBus,
} from './voice-lipsync-state-bus.js';
import type { AudioPlaybackState } from '../voice-companion-state.js';

export const AVATAR_MOUTH_OPEN_SIGNAL = 'ParamMouthOpenY';

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

type VoiceFrame = {
  offsetMs: number;
  mouthOpenY: number;
};

type VoiceTiming = {
  adapterId: string;
  audioArtifactId?: string;
  frames: VoiceFrame[];
};

export type AvatarVoiceLipsyncPipeline = {
  handleEvent(event: AgentEvent): void;
  dispose(): void;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
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
  if (!timeline) {
    return null;
  }
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

function normalizeFrame(value: unknown): VoiceFrame | null {
  const frame = readRecord(value);
  if (!frame) {
    return null;
  }
  const offsetMs = readFiniteNumber(frame, 'offset_ms') ?? readFiniteNumber(frame, 'offsetMs');
  const mouthOpenY = readFiniteNumber(frame, 'mouth_open_y') ?? readFiniteNumber(frame, 'mouthOpenY');
  if (offsetMs === null || mouthOpenY === null || offsetMs < 0 || mouthOpenY < 0 || mouthOpenY > 1) {
    return null;
  }
  return { offsetMs, mouthOpenY };
}

function parseVoiceTiming(detail: Record<string, unknown>): VoiceTiming | null {
  const payload = readRecord(detail['payload']);
  const timing = readRecord(detail['voice_timing']) ?? readRecord(payload?.['voice_timing']);
  if (!timing) {
    return null;
  }
  const adapterId = readString(timing, 'adapter_id') ?? readString(timing, 'adapterId');
  if (!adapterId || !isProviderNeutralAdapterId(adapterId)) {
    return null;
  }
  const rawFrames = timing['frames'];
  if (!Array.isArray(rawFrames)) {
    return null;
  }
  const frames = rawFrames.map(normalizeFrame);
  if (frames.some((frame) => !frame)) {
    return null;
  }
  const normalized = frames as VoiceFrame[];
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (!previous || !current || previous.offsetMs >= current.offsetMs) {
      return null;
    }
  }
  const uniqueMouthValues = new Set(normalized.map((frame) => frame.mouthOpenY));
  if (normalized.length < 2 || uniqueMouthValues.size < 2) {
    return null;
  }
  return { adapterId, frames: normalized };
}

function parseRuntimeLipsyncFrameBatch(
  detail: Record<string, unknown>,
  timeline: RuntimeTimelineDetail,
): VoiceTiming | null {
  if (timeline.channel !== 'lipsync') {
    return null;
  }
  const audioArtifactId = readString(detail, 'audioArtifactId') ?? readString(detail, 'audio_artifact_id');
  if (!audioArtifactId) {
    return null;
  }
  const rawFrames = detail['frames'];
  if (!Array.isArray(rawFrames)) {
    return null;
  }
  const frames = rawFrames.map(normalizeFrame);
  if (frames.some((frame) => !frame)) {
    return null;
  }
  const normalized = frames as VoiceFrame[];
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (!previous || !current || previous.offsetMs >= current.offsetMs) {
      return null;
    }
  }
  if (normalized.length === 0) {
    return null;
  }
  return {
    adapterId: 'runtime.voice.runtime-agent-lipsync-frame-batch',
    audioArtifactId,
    frames: normalized,
  };
}

function isProviderNeutralAdapterId(adapterId: string): boolean {
  if (!adapterId.startsWith('runtime.voice.')) {
    return false;
  }
  return !/(^|[.:/])(openai|elevenlabs|minimax|bytedance|google|azure|aws|anthropic|local)([.:/]|$)/i.test(adapterId);
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
  projection: EmbodimentProjectionApi;
  mouthSignalId?: string;
  stateBus?: VoiceLipsyncStateBus;
  audioPlayback?: AudioPlaybackController;
  fetchAudioBytes?: (audioArtifactId: string) => Promise<ArrayBuffer>;
}): AvatarVoiceLipsyncPipeline {
  const canceled = new Set<string>();
  let disposed = false;
  const mouthSignalId = input.mouthSignalId ?? AVATAR_MOUTH_OPEN_SIGNAL;
  const stateBus = input.stateBus ?? getSharedVoiceLipsyncStateBus();
  const audioPlayback = input.audioPlayback ?? getSharedAudioPlaybackController();
  const fetchAudioBytes = input.fetchAudioBytes;

  function resetMouth(): void {
    input.projection.setSignal(mouthSignalId, 0, 1);
  }

  function publishPlaybackState(state: AudioPlaybackState): void {
    stateBus.publish({ kind: 'audio_playback_state', state });
  }

  function handleInterrupt(event: AgentEvent, detail: Record<string, unknown>): void {
    const timeline = parseRuntimeTimeline(detail);
    const streamId = timeline?.stream_id ?? readString(detail, 'stream_id');
    const turnId = timeline?.turn_id ?? readString(detail, 'turn_id');
    if (!streamId || !turnId) {
      return;
    }
    canceled.add(`${turnId}:${streamId}`);
    audioPlayback.stop('interrupted');
    resetMouth();
    stateBus.publish({ kind: 'deactivate' });
    publishPlaybackState('interrupted');
    if (timeline) {
      emitDriverEvent(input.driver, 'avatar.speak.interrupt', timeline, {
        source_event_name: event.name,
      });
    }
  }

  function handleRuntimePlaybackState(event: AgentEvent, detail: Record<string, unknown>): boolean {
    if (event.name !== 'runtime.agent.presentation.voice_playback_requested') {
      return false;
    }
    const state = readString(detail, 'playbackState') ?? readString(detail, 'playback_state');
    if (state === null) {
      return false;
    }
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
      const playInput: AudioPlaybackPlayInput = { audioArtifactId, audioMimeType };
      if (fetchAudioBytes) {
        playInput.fetchBytes = () => fetchAudioBytes(audioArtifactId);
      }
      // Audio controller pushes `started/completed/failed` snapshots to its
      // own subscribers; the App-shell mirror subscribes there. Errors are
      // swallowed because the controller already publishes a `failed` state.
      void audioPlayback.play(playInput);
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
      if (!timeline || timeline.channel !== 'voice') {
        return true;
      }
      canceled.add(timelineIdentity(timeline));
      audioPlayback.stop('interrupted');
      resetMouth();
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

  function handleVoiceEvent(event: AgentEvent, detail: Record<string, unknown>): void {
    const timeline = parseRuntimeTimeline(detail);
    if (!timeline) {
      return;
    }
    const voiceTiming = event.name === 'runtime.agent.presentation.lipsync_frame_batch'
      ? parseRuntimeLipsyncFrameBatch(detail, timeline)
      : parseVoiceTiming(detail);
    if (!voiceTiming) {
      return;
    }
    const identity = timelineIdentity(timeline);
    if (canceled.has(identity)) {
      return;
    }
    if (voiceTiming.audioArtifactId) {
      stateBus.publish({ kind: 'activate', audioArtifactId: voiceTiming.audioArtifactId });
    }
    emitDriverEvent(input.driver, 'avatar.speak.start', timeline, {
      source_event_name: event.name,
      voice_adapter_id: voiceTiming.adapterId,
      audio_artifact_id: voiceTiming.audioArtifactId ?? null,
      frame_count: voiceTiming.frames.length,
    });
    for (const frame of voiceTiming.frames) {
      if (canceled.has(identity) || disposed) {
        resetMouth();
        stateBus.publish({ kind: 'mouth_open_y', value: 0 });
        stateBus.publish({ kind: 'deactivate' });
        return;
      }
      input.projection.setSignal(mouthSignalId, frame.mouthOpenY, 1);
      stateBus.publish({ kind: 'mouth_open_y', value: frame.mouthOpenY });
      emitDriverEvent(input.driver, 'avatar.lipsync.frame', timeline, {
        source_event_name: event.name,
        audio_artifact_id: voiceTiming.audioArtifactId ?? null,
        offset_ms: frame.offsetMs,
        mouth_open_y: frame.mouthOpenY,
      });
    }
    resetMouth();
    stateBus.publish({ kind: 'mouth_open_y', value: 0 });
    stateBus.publish({ kind: 'deactivate' });
    emitDriverEvent(input.driver, 'avatar.speak.end', timeline, {
      source_event_name: event.name,
      voice_adapter_id: voiceTiming.adapterId,
      audio_artifact_id: voiceTiming.audioArtifactId ?? null,
    });
  }

  return {
    handleEvent(event) {
      if (disposed) {
        return;
      }
      const detail = readRecord(event.detail);
      if (!detail) {
        return;
      }
      if (event.name === 'runtime.agent.turn.interrupted' || event.name === 'runtime.agent.turn.interrupt_ack') {
        handleInterrupt(event, detail);
        return;
      }
      if (handleRuntimePlaybackState(event, detail)) {
        return;
      }
      handleVoiceEvent(event, detail);
    },
    dispose() {
      disposed = true;
      audioPlayback.stop('interrupted');
      resetMouth();
      stateBus.publish({ kind: 'mouth_open_y', value: 0 });
      stateBus.publish({ kind: 'deactivate' });
      publishPlaybackState('idle');
      canceled.clear();
    },
  };
}

export function wireAvatarVoiceLipsync(input: {
  driver: AgentDataDriver;
  projection: EmbodimentProjectionApi;
  mouthSignalId?: string;
  stateBus?: VoiceLipsyncStateBus;
  audioPlayback?: AudioPlaybackController;
  fetchAudioBytes?: (audioArtifactId: string) => Promise<ArrayBuffer>;
}): () => void {
  const pipeline = createAvatarVoiceLipsyncPipeline(input);
  const unwire = input.driver.onEvent((event) => pipeline.handleEvent(event));
  return () => {
    unwire();
    pipeline.dispose();
  };
}
