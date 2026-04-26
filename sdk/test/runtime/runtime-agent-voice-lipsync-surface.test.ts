import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAppConsumeEvent } from '../../src/runtime/runtime-agent-surface-parsers.js';

const TIMELINE_STARTED_AT = '2026-04-25T00:00:00.000Z';

function withRuntimeTimeline(messageType: string, payload: Record<string, unknown>): Record<string, unknown> {
  const channel = messageType === 'runtime.agent.presentation.voice_playback_requested' ? 'voice' : 'lipsync';
  return {
    ...payload,
    timeline: {
      turn_id: payload.turn_id,
      stream_id: payload.stream_id,
      channel,
      offset_ms: 12,
      sequence: 1,
      started_at_wall: TIMELINE_STARTED_AT,
      observed_at_wall: '2026-04-25T00:00:00.012Z',
      timebase_owner: 'runtime',
      projection_rule_id: 'K-AGCORE-051',
      clock_basis: 'monotonic_with_wall_anchor',
      provider_neutral: true,
      app_local_authority: false,
    },
  };
}

test('runtime agent consume surface parses runtime-owned voice and lipsync timeline payloads', () => {
  const voice = parseAppConsumeEvent('runtime.agent.presentation.voice_playback_requested', withRuntimeTimeline('runtime.agent.presentation.voice_playback_requested', {
    agent_id: 'agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: {
      audio_artifact_id: 'artifact-voice-1',
      audio_mime_type: 'audio/wav',
      playback_state: 'requested',
      duration_ms: 1200,
      deadline_offset_ms: 1500,
    },
  }));
  assert.equal(voice.eventName, 'runtime.agent.presentation.voice_playback_requested');
  assert.equal(voice.timeline.channel, 'voice');
  assert.equal(voice.detail.audioArtifactId, 'artifact-voice-1');
  assert.equal(voice.detail.playbackState, 'requested');
  assert.equal(voice.detail.durationMs, 1200);

  const lipsync = parseAppConsumeEvent('runtime.agent.presentation.lipsync_frame_batch', withRuntimeTimeline('runtime.agent.presentation.lipsync_frame_batch', {
    agent_id: 'agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: {
      audio_artifact_id: 'artifact-voice-1',
      frames: [
        { frame_sequence: 1, offset_ms: 0, duration_ms: 80, mouth_open_y: 0.25, audio_level: 0.4 },
        { frame_sequence: 2, offset_ms: 80, duration_ms: 80, mouth_open_y: 0.8, audio_level: 0.7 },
      ],
    },
  }));
  assert.equal(lipsync.eventName, 'runtime.agent.presentation.lipsync_frame_batch');
  assert.equal(lipsync.timeline.channel, 'lipsync');
  assert.equal(lipsync.detail.audioArtifactId, 'artifact-voice-1');
  assert.equal(lipsync.detail.frames.length, 2);
  assert.equal(lipsync.detail.frames[1]?.mouthOpenY, 0.8);
});

test('runtime agent consume surface rejects malformed voice and lipsync timeline payloads', () => {
  const voice = withRuntimeTimeline('runtime.agent.presentation.voice_playback_requested', {
    agent_id: 'agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: {
      audio_artifact_id: 'artifact-voice-1',
      audio_mime_type: 'audio/wav',
      playback_state: 'requested',
    },
  });
  assert.throws(() => parseAppConsumeEvent('runtime.agent.presentation.voice_playback_requested', {
    ...voice,
    timeline: {
      ...(voice.timeline as Record<string, unknown>),
      channel: 'text',
    },
  }), /timeline\.channel must be voice/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.presentation.voice_playback_requested', {
    ...voice,
    detail: {
      audio_mime_type: 'audio/wav',
      playback_state: 'requested',
    },
  }), /requires detail\.audio_artifact_id/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.presentation.voice_playback_requested', {
    ...voice,
    detail: {
      audio_artifact_id: 'artifact-voice-1',
      audio_mime_type: 'audio/wav',
      playback_state: 'provider-timed',
    },
  }), /detail\.playback_state is not an admitted playback state/);

  const lipsync = withRuntimeTimeline('runtime.agent.presentation.lipsync_frame_batch', {
    agent_id: 'agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: {
      audio_artifact_id: 'artifact-voice-1',
      frames: [
        { frame_sequence: 1, offset_ms: 0, duration_ms: 80, mouth_open_y: 0.25, audio_level: 0.4 },
        { frame_sequence: 1, offset_ms: 80, duration_ms: 80, mouth_open_y: 0.8, audio_level: 0.7 },
      ],
    },
  });
  assert.throws(() => parseAppConsumeEvent('runtime.agent.presentation.lipsync_frame_batch', lipsync), /frame_sequence must be monotonic/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.presentation.lipsync_frame_batch', {
    ...lipsync,
    detail: {
      audio_artifact_id: 'artifact-voice-1',
      frames: [
        { frame_sequence: 1, offset_ms: 0, duration_ms: 80, mouth_open_y: 1.5, audio_level: 0.4 },
      ],
    },
  }), /mouth_open_y must be between 0 and 1/);
});
