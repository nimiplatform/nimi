import { describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, AgentEvent, AppOriginEvent, DriverStatus } from '../driver/types.js';
import type { EmbodimentProjectionApi } from '../nas/embodiment-projection-api.js';
import { AVATAR_MOUTH_OPEN_SIGNAL, createAvatarVoiceLipsyncPipeline } from './avatar-voice-lipsync.js';

function createDriver(): AgentDataDriver & { emitted: AppOriginEvent[] } {
  const emitted: AppOriginEvent[] = [];
  return {
    kind: 'sdk',
    status: 'running' as DriverStatus,
    async start() {},
    async stop() {},
    getBundle: () => ({}) as AgentDataBundle,
    onEvent() {
      return () => {};
    },
    onBundleChange() {
      return () => {};
    },
    onStatusChange() {
      return () => {};
    },
    emit(event) {
      emitted.push(event);
    },
    emitted,
  };
}

function createProjection() {
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

function createRuntimeTimeline(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    channel: 'text',
    offset_ms: 0,
    sequence: 1,
    started_at_wall: '2026-04-25T00:00:00.000Z',
    observed_at_wall: '2026-04-25T00:00:00.010Z',
    timebase_owner: 'runtime',
    projection_rule_id: 'K-AGCORE-051',
    clock_basis: 'monotonic_with_wall_anchor',
    provider_neutral: true,
    app_local_authority: false,
    ...overrides,
  };
}

function createVoiceEvent(detail: Record<string, unknown> = {}): AgentEvent {
  return {
    event_id: 'event-1',
    name: 'runtime.agent.turn.text_delta',
    timestamp: '2026-04-25T00:00:00.020Z',
    detail: {
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      runtime_timeline: createRuntimeTimeline(),
      voice_timing: {
        adapter_id: 'runtime.voice.timeline-levels',
        frames: [
          { offset_ms: 0, mouth_open_y: 0.1 },
          { offset_ms: 80, mouth_open_y: 0.75 },
          { offset_ms: 160, mouth_open_y: 0.25 },
        ],
      },
      ...detail,
    },
  };
}

function createRuntimeLipsyncFrameBatchEvent(detail: Record<string, unknown> = {}): AgentEvent {
  return {
    event_id: 'event-lipsync-1',
    name: 'runtime.agent.presentation.lipsync_frame_batch',
    timestamp: '2026-04-25T00:00:00.020Z',
    detail: {
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      runtime_timeline: createRuntimeTimeline({ channel: 'lipsync', sequence: 2 }),
      audioArtifactId: 'artifact-1',
      frames: [
        { frameSequence: 1, offsetMs: 0, durationMs: 80, mouthOpenY: 0.16, audioLevel: 0.12 },
        { frameSequence: 2, offsetMs: 80, durationMs: 90, mouthOpenY: 0.88, audioLevel: 0.7 },
        { frameSequence: 3, offsetMs: 170, durationMs: 70, mouthOpenY: 0.24, audioLevel: 0.18 },
      ],
      ...detail,
    },
  };
}

describe('Avatar voice lipsync pipeline', () => {
  it('writes computed voice timing frames to Live2D ParamMouthOpenY and emits Avatar speak cues', () => {
    const driver = createDriver();
    const { projection, setSignal } = createProjection();
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, projection });

    pipeline.handleEvent(createVoiceEvent());

    expect(setSignal).toHaveBeenCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0.1, 1);
    expect(setSignal).toHaveBeenCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0.75, 1);
    expect(setSignal).toHaveBeenCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0.25, 1);
    expect(setSignal).toHaveBeenLastCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0, 1);
    expect(driver.emitted.map((event) => event.name)).toEqual([
      'avatar.speak.start',
      'avatar.lipsync.frame',
      'avatar.lipsync.frame',
      'avatar.lipsync.frame',
      'avatar.speak.end',
    ]);
  });

  it('consumes runtime-owned lipsync frame batches as Live2D mouth projection input', () => {
    const driver = createDriver();
    const { projection, setSignal } = createProjection();
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, projection });

    pipeline.handleEvent(createRuntimeLipsyncFrameBatchEvent());

    expect(setSignal).toHaveBeenCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0.16, 1);
    expect(setSignal).toHaveBeenCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0.88, 1);
    expect(setSignal).toHaveBeenCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0.24, 1);
    expect(setSignal).toHaveBeenLastCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0, 1);
    expect(driver.emitted.find((event) => event.name === 'avatar.speak.start')?.detail).toEqual(
      expect.objectContaining({
        audio_artifact_id: 'artifact-1',
        voice_adapter_id: 'runtime.voice.runtime-agent-lipsync-frame-batch',
        runtime_timeline: expect.objectContaining({
          channel: 'lipsync',
          timebase_owner: 'runtime',
          app_local_authority: false,
        }),
      }),
    );
  });

  it('fails closed when runtime timeline identity is missing, mismatched, app-local, or voice frames are placeholder constant values', () => {
    const driver = createDriver();
    const { projection, setSignal } = createProjection();
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, projection });

    pipeline.handleEvent(createVoiceEvent({ runtime_timeline: undefined }));
    pipeline.handleEvent(createVoiceEvent({ runtime_timeline: createRuntimeTimeline({ stream_id: 'other-stream' }) }));
    pipeline.handleEvent(createVoiceEvent({ runtime_timeline: createRuntimeTimeline({ app_local_authority: true }) }));
    pipeline.handleEvent(createVoiceEvent({ runtime_timeline: createRuntimeTimeline({ sequence: 0 }) }));
    pipeline.handleEvent(createVoiceEvent({ runtime_timeline: createRuntimeTimeline({ clock_basis: 'wall_clock_only' }) }));
    pipeline.handleEvent(createVoiceEvent({
      voice_timing: {
        adapter_id: 'runtime.voice.timeline-levels',
        frames: [
          { offset_ms: 0, mouth_open_y: 0.4 },
          { offset_ms: 50, mouth_open_y: 0.4 },
        ],
      },
    }));
    pipeline.handleEvent(createVoiceEvent({
      voice_timing: {
        adapter_id: 'runtime.voice.timeline-levels',
        frames: [
          { offset_ms: 80, mouth_open_y: 0.7 },
          { offset_ms: 40, mouth_open_y: 0.2 },
        ],
      },
    }));
    pipeline.handleEvent(createRuntimeLipsyncFrameBatchEvent({
      runtime_timeline: createRuntimeTimeline({ channel: 'voice' }),
    }));

    expect(setSignal).not.toHaveBeenCalled();
    expect(driver.emitted).toEqual([]);
  });

  it('rejects provider-hardcoded voice adapters and prevents late writes after interruption', () => {
    const driver = createDriver();
    const { projection, setSignal } = createProjection();
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, projection });

    pipeline.handleEvent(createVoiceEvent({
      voice_timing: {
        adapter_id: 'runtime.voice.openai.tts',
        frames: [
          { offset_ms: 0, mouth_open_y: 0.1 },
          { offset_ms: 50, mouth_open_y: 0.6 },
        ],
      },
    }));
    pipeline.handleEvent({
      event_id: 'event-interrupt',
      name: 'runtime.agent.turn.interrupted',
      timestamp: '2026-04-25T00:00:00.050Z',
      detail: {
        turn_id: 'turn-1',
        stream_id: 'stream-1',
        runtime_timeline: createRuntimeTimeline({ sequence: 2 }),
      },
    });
    pipeline.handleEvent(createVoiceEvent());

    expect(setSignal).toHaveBeenCalledTimes(1);
    expect(setSignal).toHaveBeenCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0, 1);
    expect(driver.emitted.map((event) => event.name)).toEqual(['avatar.speak.interrupt']);
  });

  it('cancels runtime lipsync writes after runtime voice playback cancellation', () => {
    const driver = createDriver();
    const { projection, setSignal } = createProjection();
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, projection });

    pipeline.handleEvent({
      event_id: 'event-cancel',
      name: 'runtime.agent.presentation.voice_playback_requested',
      timestamp: '2026-04-25T00:00:00.030Z',
      detail: {
        turn_id: 'turn-1',
        stream_id: 'stream-1',
        runtime_timeline: createRuntimeTimeline({ channel: 'voice', sequence: 3 }),
        audioArtifactId: 'artifact-1',
        playbackState: 'canceled',
      },
    });
    pipeline.handleEvent(createRuntimeLipsyncFrameBatchEvent());

    expect(setSignal).toHaveBeenCalledTimes(1);
    expect(setSignal).toHaveBeenCalledWith(AVATAR_MOUTH_OPEN_SIGNAL, 0, 1);
    expect(driver.emitted.map((event) => event.name)).toEqual(['avatar.speak.interrupt']);
  });
});
