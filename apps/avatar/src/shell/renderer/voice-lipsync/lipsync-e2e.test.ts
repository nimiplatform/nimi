// Contract test for the avatar audio + lipsync pipeline defined by
// docs/authority/avatar-embodiment-rationale.md. Exercises:
//
//   1. Mock SDK Runtime instance that resolves `runtime.artifacts.readArtifactBytes`
//      with deterministic .wav-shaped bytes.
//   2. AudioPipelineController consumes those bytes directly (no caller-
//      injected byte fetcher).
//   3. `runtime.agent.presentation.voice_playback_requested` mirrors through
//      the avatar-voice-lipsync orchestrator.
//   4. Same fixture is run against TWO mock backends (live2d and vrm). Each
//      backend's BackendAudioConsumer.attachAudioSource is called once and
//      both transition through the same playback state machine.
//   5. Synthetic-mime fail-close path triggers sink.silent without decode.
//   6. Interrupt path stops audio + state bus deactivates.
//
// Hard-cut surface (no deviations):
//   - no deprecated runtime presentation per-frame mouth-batch consume
//   - no caller-injected audio-bytes fetcher
//   - no Live2D-specific mouth bridge instance

import { describe, expect, it, vi } from 'vitest';
import type {
  AgentDataBundle,
  AgentDataDriver,
  AgentEvent,
  AppOriginEvent,
  DriverStatus,
} from '../driver/types.js';
import { createAvatarVoiceLipsyncPipeline } from './avatar-voice-lipsync.js';
import {
  AudioPipelineController,
  SYNTHETIC_AUDIO_MIME_TYPE,
  VoiceLipsyncStateBus,
  type VoiceLipsyncStateBusEvent,
} from '@nimiplatform/kit/features/avatar/headless';
import type {
  BackendAudioConsumer,
  BackendBranch,
} from '../carrier/backend-branch.js';

const FIXTURE_TURN_ID = 'turn-e2e';
const FIXTURE_STREAM_ID = 'stream-e2e';
const FIXTURE_AUDIO_ARTIFACT = 'artifact-e2e-wav';
const FIXTURE_STARTED_AT = '2026-04-29T00:00:00.000Z';
const FIXTURE_OBSERVED_AT = '2026-04-29T00:00:00.020Z';

function makeRuntimeTimeline(channel: 'voice' | 'lipsync' | 'state', sequence: number): Record<string, unknown> {
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

function makeVoicePlaybackEvent(
  playbackState: 'requested' | 'started' | 'completed' | 'interrupted' | 'canceled' | 'failed',
  audioMimeType = 'audio/wav',
  sequence = 1,
): AgentEvent {
  return {
    event_id: `event-voice-${playbackState}`,
    name: 'runtime.agent.presentation.voice_playback_requested',
    timestamp: '2026-04-29T00:00:00.030Z',
    detail: {
      turn_id: FIXTURE_TURN_ID,
      stream_id: FIXTURE_STREAM_ID,
      runtime_timeline: makeRuntimeTimeline('voice', sequence),
      audio_artifact_id: FIXTURE_AUDIO_ARTIFACT,
      audio_mime_type: audioMimeType,
      playback_state: playbackState,
      playback_target: 'avatar_autoplay',
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

type FakeBufferSource = {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
};

function createFakeAudioContext(): {
  context: AudioContext;
  source: FakeBufferSource;
} {
  const source: FakeBufferSource = {
    buffer: null,
    onended: null,
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
  };
  const context = {
    destination: {} as AudioDestinationNode,
    decodeAudioData: vi.fn(async () => ({ duration: 0.256 } as AudioBuffer)),
    createBufferSource: () => source as unknown as AudioBufferSourceNode,
  } as unknown as AudioContext;
  return { context, source };
}

function createSinkMock(): BackendAudioConsumer & {
  attachAudioSource: ReturnType<typeof vi.fn>;
  detachAudioSource: ReturnType<typeof vi.fn>;
  silent: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
} {
  return {
    attachAudioSource: vi.fn(async () => undefined),
    detachAudioSource: vi.fn(),
    silent: vi.fn(),
    snapshot: vi.fn(() => null),
  } as never;
}

function createBackend(kind: 'live2d' | 'vrm'): BackendBranch & {
  audioConsumer: ReturnType<typeof createSinkMock>;
} {
  const audioConsumer = createSinkMock();
  const Surface = () => null;
  const base = {
    nominalBounds: { width: 360, height: 720, bodyCenterX: 0.5, bodyCenterY: 0.5 },
    projection: {
      applyActivity: vi.fn(),
      applyEmotion: vi.fn(),
      applyMotion: vi.fn(),
      applyExpression: vi.fn(),
      reset: vi.fn(),
    },
    surface: { Component: Surface },
    metadata: () => ({ model_kind: kind }),
    shutdown: vi.fn(),
    audioConsumer,
  };
  if (kind === 'live2d') {
    return {
      kind: 'live2d',
      live2dExtension: { setParameter: vi.fn() },
      ...base,
    } as never;
  }
  return { kind: 'vrm', ...base } as never;
}

function createRuntimeMock(): { runtime: unknown; readArtifactBytes: ReturnType<typeof vi.fn> } {
  // 256-byte deterministic .wav-shaped buffer (header + silent payload).
  const bytes = new ArrayBuffer(256);
  const readArtifactBytes = vi.fn(async (input: { artifactId: string }) => {
    expect(input.artifactId).toBe(FIXTURE_AUDIO_ARTIFACT);
    return { bytes, mimeType: 'audio/wav', sizeBytes: bytes.byteLength };
  });
  return { runtime: { artifacts: { readArtifactBytes } }, readArtifactBytes };
}

describe('Lipsync e2e — voice_playback_requested → audio-pipeline → backend sink', () => {
  it('runs the full path against a Live2D mock backend (real-audio mime; sink attached)', async () => {
    const driver = createDriver();
    const stateBus = new VoiceLipsyncStateBus();
    const fake = createFakeAudioContext();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { runtime } = createRuntimeMock();
    audioPipeline.setRuntime(runtime as never);

    const backend = createBackend('live2d');
    const busEvents: VoiceLipsyncStateBusEvent[] = [];
    stateBus.subscribe((event) => busEvents.push(event));

    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver,
      stateBus,
      audioPipeline,
      backend,
    });

    pipeline.handleEvent(makeVoicePlaybackEvent('requested'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Sink attached exactly once after source.start.
    expect(backend.audioConsumer.attachAudioSource).toHaveBeenCalledTimes(1);
    expect(fake.source.start).toHaveBeenCalledTimes(1);

    // State bus published activate + audio_playback_state(requested) + (started after subscribe).
    const kinds = busEvents.map((e) => e.kind);
    expect(kinds).toContain('activate');
    expect(kinds).toContain('audio_playback_state');

    // Simulate browser onended → completed.
    fake.source.onended?.();
    expect(audioPipeline.getSnapshot().state).toBe('completed');
  });

  it('runs the same fixture against a VRM mock backend with equivalent sink lifecycle', async () => {
    const driver = createDriver();
    const stateBus = new VoiceLipsyncStateBus();
    const fake = createFakeAudioContext();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { runtime } = createRuntimeMock();
    audioPipeline.setRuntime(runtime as never);

    const backend = createBackend('vrm');
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver,
      stateBus,
      audioPipeline,
      backend,
    });

    pipeline.handleEvent(makeVoicePlaybackEvent('requested'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(backend.audioConsumer.attachAudioSource).toHaveBeenCalledTimes(1);
    expect(fake.source.start).toHaveBeenCalledTimes(1);

    fake.source.onended?.();
    expect(audioPipeline.getSnapshot().state).toBe('completed');
  });

  it('synthetic-mime fail-close: sink.silent + completed state, no decode, no source.start', async () => {
    const driver = createDriver();
    const stateBus = new VoiceLipsyncStateBus();
    const fake = createFakeAudioContext();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { runtime, readArtifactBytes } = createRuntimeMock();
    audioPipeline.setRuntime(runtime as never);

    const backend = createBackend('live2d');
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver,
      stateBus,
      audioPipeline,
      backend,
    });

    pipeline.handleEvent(makeVoicePlaybackEvent('requested', SYNTHETIC_AUDIO_MIME_TYPE));
    await Promise.resolve();

    expect(readArtifactBytes).not.toHaveBeenCalled();
    expect(fake.source.start).not.toHaveBeenCalled();
    expect(backend.audioConsumer.attachAudioSource).not.toHaveBeenCalled();
    expect(backend.audioConsumer.silent).toHaveBeenCalled();
    expect(audioPipeline.getSnapshot().state).toBe('completed');
    expect(audioPipeline.getSnapshot().reason).toBe('synthetic_audio_no_playback');
  });

  it('runtime.agent.turn.interrupted halts the audio pipeline and deactivates state bus', async () => {
    const driver = createDriver();
    const stateBus = new VoiceLipsyncStateBus();
    const fake = createFakeAudioContext();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { runtime } = createRuntimeMock();
    audioPipeline.setRuntime(runtime as never);

    const backend = createBackend('live2d');
    const busEvents: VoiceLipsyncStateBusEvent[] = [];
    stateBus.subscribe((event) => busEvents.push(event));

    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver,
      stateBus,
      audioPipeline,
      backend,
    });

    pipeline.handleEvent(makeVoicePlaybackEvent('requested'));
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.source.start).toHaveBeenCalledTimes(1);

    pipeline.handleEvent({
      event_id: 'event-interrupt',
      name: 'runtime.agent.turn.interrupted',
      timestamp: '2026-04-29T00:00:00.080Z',
      detail: {
        turn_id: FIXTURE_TURN_ID,
        stream_id: FIXTURE_STREAM_ID,
        runtime_timeline: makeRuntimeTimeline('state', 2),
      },
    });

    expect(fake.source.stop).toHaveBeenCalled();
    expect(backend.audioConsumer.silent).toHaveBeenCalled();
    expect(busEvents.map((e) => e.kind)).toContain('deactivate');
    expect(driver.emitted.some((e) => e.name === 'avatar.speak.interrupt')).toBe(true);
  });
});
