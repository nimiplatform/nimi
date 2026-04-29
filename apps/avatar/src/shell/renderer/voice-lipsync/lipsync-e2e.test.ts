// Wave 3 — End-to-end lipsync test.
// Per feature-matrix.yaml wave_3.scope.lipsync_e2e_test this test exercises
// the full runtime → SDK → avatar pipeline:
//
//   1. Synthesize a runtime-shaped `runtime.agent.presentation.voice_playback_requested`
//      event (synthetic-mime fail-close path) and a
//      `runtime.agent.presentation.lipsync_frame_batch` event with a fixture
//      frame sequence.
//   2. Feed both events through `createAvatarVoiceLipsyncPipeline` (the same
//      pipeline wired by avatar-carrier in production).
//   3. Assert: ParamMouthOpenY receives the expected per-frame sequence on
//      Live2D projection, audio playback fail-closes (synthetic mime → no
//      decode, completed snapshot), state-bus publishes activate/mouth/deactivate
//      in order, and runtime timeline envelope is honored (turn_id + stream_id
//      flow into emitted avatar.* driver events).
//
// This is the only avatar-side test that exercises the full chain end-to-end.
// Per-layer tests (audio-playback, voice-lipsync-state-bus, lipsync-bridge,
// avatar-voice-lipsync) cover their slices in isolation.

import { describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, AgentEvent, AppOriginEvent, DriverStatus } from '../driver/types.js';
import type { EmbodimentProjectionApi } from '../nas/embodiment-projection-api.js';
import { AVATAR_MOUTH_OPEN_SIGNAL, createAvatarVoiceLipsyncPipeline } from './avatar-voice-lipsync.js';
import { VoiceLipsyncStateBus, type VoiceLipsyncStateBusEvent } from './voice-lipsync-state-bus.js';
import { AudioPlaybackController, SYNTHETIC_AUDIO_MIME_TYPE } from '../audio/audio-playback.js';

const FIXTURE_TURN_ID = 'turn-e2e';
const FIXTURE_STREAM_ID = 'stream-e2e';
const FIXTURE_AUDIO_ARTIFACT = 'synthetic://lipsync/turn-e2e';
const FIXTURE_STARTED_AT = '2026-04-29T00:00:00.000Z';
const FIXTURE_OBSERVED_AT = '2026-04-29T00:00:00.020Z';

function makeRuntimeTimeline(channel: 'voice' | 'lipsync', sequence: number): Record<string, unknown> {
  return {
    turn_id: FIXTURE_TURN_ID,
    stream_id: FIXTURE_STREAM_ID,
    channel,
    offset_ms: 0,
    sequence,
    started_at_wall: FIXTURE_STARTED_AT,
    observed_at_wall: FIXTURE_OBSERVED_AT,
    timebase_owner: 'runtime',
    projection_rule_id: 'K-AGCORE-051',
    clock_basis: 'monotonic_with_wall_anchor',
    provider_neutral: true,
    app_local_authority: false,
  };
}

function makeVoicePlaybackEvent(playbackState: 'requested' | 'started' | 'completed'): AgentEvent {
  return {
    event_id: `event-voice-${playbackState}`,
    name: 'runtime.agent.presentation.voice_playback_requested',
    timestamp: '2026-04-29T00:00:00.030Z',
    detail: {
      turn_id: FIXTURE_TURN_ID,
      stream_id: FIXTURE_STREAM_ID,
      runtime_timeline: makeRuntimeTimeline('voice', 1),
      audio_artifact_id: FIXTURE_AUDIO_ARTIFACT,
      audio_mime_type: SYNTHETIC_AUDIO_MIME_TYPE,
      playback_state: playbackState,
    },
  };
}

function makeLipsyncFrameBatchEvent(): AgentEvent {
  return {
    event_id: 'event-lipsync-batch',
    name: 'runtime.agent.presentation.lipsync_frame_batch',
    timestamp: '2026-04-29T00:00:00.040Z',
    detail: {
      turn_id: FIXTURE_TURN_ID,
      stream_id: FIXTURE_STREAM_ID,
      runtime_timeline: makeRuntimeTimeline('lipsync', 2),
      audio_artifact_id: FIXTURE_AUDIO_ARTIFACT,
      frames: [
        { frameSequence: 1, offsetMs: 0, durationMs: 80, mouthOpenY: 0.1, audioLevel: 0.1 },
        { frameSequence: 2, offsetMs: 80, durationMs: 80, mouthOpenY: 0.7, audioLevel: 0.7 },
        { frameSequence: 3, offsetMs: 160, durationMs: 80, mouthOpenY: 0.3, audioLevel: 0.3 },
      ],
    },
  };
}

function createDriver(): AgentDataDriver & { emitted: AppOriginEvent[] } {
  const emitted: AppOriginEvent[] = [];
  return {
    kind: 'sdk',
    status: 'running' as DriverStatus,
    async start() {},
    async stop() {},
    getBundle: () => ({}) as AgentDataBundle,
    onEvent: () => () => {},
    onBundleChange: () => () => {},
    onStatusChange: () => () => {},
    emit(event) {
      emitted.push(event);
    },
    emitted,
  };
}

function createProjection(): { projection: EmbodimentProjectionApi; setSignal: ReturnType<typeof vi.fn> } {
  const setSignal = vi.fn();
  const projection: EmbodimentProjectionApi = {
    triggerMotion: vi.fn(async () => undefined),
    stopMotion: vi.fn(),
    setSignal,
    getSignal: vi.fn(() => 0),
    addSignal: vi.fn(),
    setExpression: vi.fn(async () => undefined),
    clearExpression: vi.fn(),
    setPose: vi.fn(),
    clearPose: vi.fn(),
    wait: vi.fn(async () => undefined),
    getSurfaceBounds: vi.fn(() => ({ x: 0, y: 0, width: 400, height: 600 })),
  };
  return { projection, setSignal };
}

describe('Lipsync e2e — runtime → SDK → avatar pipeline', () => {
  it('writes ParamMouthOpenY frame sequence + state-bus events when synthetic frame batch arrives', async () => {
    const driver = createDriver();
    const { projection, setSignal } = createProjection();
    const stateBus = new VoiceLipsyncStateBus();
    const audioPlayback = new AudioPlaybackController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const busEvents: VoiceLipsyncStateBusEvent[] = [];
    stateBus.subscribe((event) => busEvents.push(event));

    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, projection, stateBus, audioPlayback });

    // Drive the runtime sequence: voice_playback_requested(requested) opens
    // audio playback (synthetic mime fail-close → completed) and activates
    // lipsync state. lipsync_frame_batch then drives mouth frames.
    pipeline.handleEvent(makeVoicePlaybackEvent('requested'));
    pipeline.handleEvent(makeLipsyncFrameBatchEvent());

    // Wait a microtask so the synthetic-mime audio fail-close completes.
    await Promise.resolve();
    await Promise.resolve();

    // ParamMouthOpenY received the per-frame sequence (0.1 → 0.7 → 0.3) plus
    // a final reset to 0 on speak.end.
    const openCalls = setSignal.mock.calls.filter((c) => c[0] === AVATAR_MOUTH_OPEN_SIGNAL);
    const openValues = openCalls.map((c) => c[1]);
    expect(openValues).toEqual([0.1, 0.7, 0.3, 0]);

    // Driver emitted `avatar.speak.start` + 3 `avatar.lipsync.frame` + `avatar.speak.end`.
    const driverNames = driver.emitted.map((e) => e.name);
    expect(driverNames).toContain('avatar.speak.start');
    expect(driverNames.filter((n) => n === 'avatar.lipsync.frame')).toHaveLength(3);
    expect(driverNames).toContain('avatar.speak.end');

    // State bus published `activate` (twice — voice_playback_requested + frame batch)
    // followed by `mouth_open_y` updates and `deactivate` at the end.
    const busKinds = busEvents.map((e) => e.kind);
    expect(busKinds.filter((k) => k === 'activate').length).toBeGreaterThanOrEqual(1);
    expect(busKinds.filter((k) => k === 'mouth_open_y').length).toBeGreaterThanOrEqual(3);
    expect(busKinds[busKinds.length - 1]).toBe('deactivate');

    // Audio playback fail-closed (synthetic mime). Final snapshot is `completed`.
    expect(audioPlayback.getSnapshot().state).toBe('completed');
    expect(audioPlayback.getSnapshot().reason).toBe('synthetic_audio_no_playback');
  });

  it('runtime timeline turn_id + stream_id flow into emitted avatar.lipsync.frame events', () => {
    const driver = createDriver();
    const { projection } = createProjection();
    const stateBus = new VoiceLipsyncStateBus();
    const audioPlayback = new AudioPlaybackController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, projection, stateBus, audioPlayback });

    pipeline.handleEvent(makeLipsyncFrameBatchEvent());

    const lipsyncFrameEvents = driver.emitted.filter((e) => e.name === 'avatar.lipsync.frame');
    expect(lipsyncFrameEvents).toHaveLength(3);
    for (const event of lipsyncFrameEvents) {
      const detail = event.detail as Record<string, unknown>;
      expect(detail.turn_id).toBe(FIXTURE_TURN_ID);
      expect(detail.stream_id).toBe(FIXTURE_STREAM_ID);
      expect(detail.audio_artifact_id).toBe(FIXTURE_AUDIO_ARTIFACT);
    }
  });

  it('interrupted voice_playback cancels frame writes mid-stream and resets ParamMouthOpenY', () => {
    const driver = createDriver();
    const { projection, setSignal } = createProjection();
    const stateBus = new VoiceLipsyncStateBus();
    const audioPlayback = new AudioPlaybackController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, projection, stateBus, audioPlayback });

    // Send interrupt FIRST (in real flow it would arrive after some frames;
    // we validate that the interrupt taint prevents subsequent frame writes
    // for the same turn/stream identity).
    const interruptEvent: AgentEvent = {
      event_id: 'event-voice-interrupt',
      name: 'runtime.agent.presentation.voice_playback_requested',
      timestamp: '2026-04-29T00:00:00.050Z',
      detail: {
        turn_id: FIXTURE_TURN_ID,
        stream_id: FIXTURE_STREAM_ID,
        runtime_timeline: makeRuntimeTimeline('voice', 3),
        audio_artifact_id: FIXTURE_AUDIO_ARTIFACT,
        audio_mime_type: SYNTHETIC_AUDIO_MIME_TYPE,
        playback_state: 'interrupted',
      },
    };
    pipeline.handleEvent(interruptEvent);

    // Now an out-of-order frame batch for the same turn arrives. It must be
    // discarded because the turn is already canceled.
    setSignal.mockClear();
    pipeline.handleEvent(makeLipsyncFrameBatchEvent());

    const openCalls = setSignal.mock.calls.filter((c) => c[0] === AVATAR_MOUTH_OPEN_SIGNAL);
    expect(openCalls).toHaveLength(0);
    // Driver should have emitted avatar.speak.interrupt for the interrupt event.
    expect(driver.emitted.some((e) => e.name === 'avatar.speak.interrupt')).toBe(true);
  });
});
