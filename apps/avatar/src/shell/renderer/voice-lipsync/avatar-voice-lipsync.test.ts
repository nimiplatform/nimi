// Wave 0 of topic 2026-04-30-avatar-vrm-backend-branch admit.
//
// Avatar voice-lipsync orchestrator test. The hard-cut surface:
//   - The deprecated runtime presentation per-frame mouth-batch consume
//     path is deleted (event ignored entirely; absence enforced by the
//     SdkDriver type union, not by a runtime guard in this orchestrator).
//   - voice_playback_requested still routes to audioPipeline.play().
//   - Optional `backend?: BackendBranch` argument registers the backend's
//     audioConsumer as the lipsync sink.
//   - Interrupt / cancel state still stops the audio pipeline.
//
// Tests no longer assert per-frame projection writes or per-frame avatar
// driver emit; per-frame mouth movement is now driven by the wLipSync sink
// in the surface useFrame loop (covered by the wLipSync e2e test in
// lipsync-e2e.test.ts).

import { describe, expect, it, vi } from 'vitest';
import type {
  AgentDataBundle,
  AgentDataDriver,
  AgentEvent,
  AppOriginEvent,
  DriverStatus,
} from '../driver/types.js';
import { createAvatarVoiceLipsyncPipeline } from './avatar-voice-lipsync.js';
import { AudioPipelineController } from '@nimiplatform/kit/features/avatar/headless';
import type { BackendBranch } from '@nimiplatform/kit/features/avatar/headless';

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

function createRuntimeMock(readBytes = vi.fn(async () => ({
  bytes: new ArrayBuffer(64),
  mimeType: 'audio/wav',
  sizeBytes: 64,
}))) {
  return {
    artifacts: { readBytes },
  } as never;
}

function createBackendMock(): BackendBranch & { audioConsumer: { attachAudioSource: ReturnType<typeof vi.fn>; detachAudioSource: ReturnType<typeof vi.fn>; silent: ReturnType<typeof vi.fn>; snapshot: ReturnType<typeof vi.fn> } } {
  const audioConsumer = {
    attachAudioSource: vi.fn(async () => undefined),
    detachAudioSource: vi.fn(),
    silent: vi.fn(),
    snapshot: vi.fn(() => null),
  };
  const Surface = () => null;
  return {
    kind: 'live2d',
    nominalBounds: { width: 400, height: 600, bodyCenterX: 0.5, bodyCenterY: 0.5 },
    projection: {
      applyActivity: vi.fn(),
      applyEmotion: vi.fn(),
      applyMotion: vi.fn(),
      applyExpression: vi.fn(),
      reset: vi.fn(),
    },
    surface: { Component: Surface },
    metadata: () => ({}),
    shutdown: vi.fn(),
    live2dExtension: { setParameter: vi.fn() },
    audioConsumer,
  } as never;
}

function createRuntimeTimeline(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    channel: 'voice',
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

function createVoicePlaybackRequestedEvent(detail: Record<string, unknown> = {}): AgentEvent {
  return {
    event_id: 'event-vpr-1',
    name: 'runtime.agent.presentation.voice_playback_requested',
    timestamp: '2026-04-25T00:00:00.020Z',
    detail: {
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      runtime_timeline: createRuntimeTimeline(),
      audioArtifactId: 'artifact-1',
      audioMimeType: 'audio/wav',
      playbackState: 'requested',
      ...detail,
    },
  };
}

describe('avatar-voice-lipsync orchestrator (wave 0 hard-cut)', () => {
  it('routes voice_playback_requested → audioPipeline.play and updates state bus', async () => {
    const driver = createDriver();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    audioPipeline.setRuntime(createRuntimeMock());
    const playSpy = vi.spyOn(audioPipeline, 'play');
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, audioPipeline });

    pipeline.handleEvent(createVoicePlaybackRequestedEvent());

    expect(playSpy).toHaveBeenCalledWith({
      audioArtifactId: 'artifact-1',
      audioMimeType: 'audio/wav',
    });
    // Pipeline does NOT emit avatar.speak.start / .end / .lipsync.frame anymore;
    // those originate from runtime now (or are deprecated in
    // avatar-event-contract.md).
    expect(driver.emitted).toEqual([]);
  });

  it('registers backend.audioConsumer as the lipsync sink when backend supplied', () => {
    const driver = createDriver();
    const backend = createBackendMock();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const registerSpy = vi.spyOn(audioPipeline, 'registerLipsyncSink');
    createAvatarVoiceLipsyncPipeline({ driver, audioPipeline, backend });

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0]?.[0]).toBe(backend.audioConsumer);
  });

  it('throws when backend is supplied without a valid audioConsumer (fail-close, no silent stub)', () => {
    const driver = createDriver();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const malformedBackend = {
      kind: 'live2d',
      nominalBounds: { width: 0, height: 0, bodyCenterX: 0, bodyCenterY: 0 },
      projection: {} as never,
      surface: { Component: () => null },
      metadata: () => ({}),
      shutdown: () => {},
      live2dExtension: { setParameter: () => {} },
      // audioConsumer missing intentionally
    } as never;

    expect(() =>
      createAvatarVoiceLipsyncPipeline({ driver, audioPipeline, backend: malformedBackend }),
    ).toThrow(/audioConsumer missing/);
  });

  // Wave 0 hard-cut: the deprecated per-frame mouth-batch presentation event
  // is no longer in the SdkDriver event union; typecheck enforces absence at
  // compile time. A runtime fixture for "ignores X" is intentionally NOT
  // included here so the hard-cut grep gate stays at 0 hits.

  it('runtime.agent.turn.interrupted stops audio pipeline and emits avatar.speak.interrupt', () => {
    const driver = createDriver();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const stopSpy = vi.spyOn(audioPipeline, 'stop');
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, audioPipeline });

    pipeline.handleEvent({
      event_id: 'event-interrupt',
      name: 'runtime.agent.turn.interrupted',
      timestamp: '2026-04-25T00:00:00.050Z',
      detail: {
        turn_id: 'turn-1',
        stream_id: 'stream-1',
        runtime_timeline: createRuntimeTimeline({ channel: 'state', sequence: 2 }),
      },
    });

    expect(stopSpy).toHaveBeenCalledWith('interrupted');
    expect(driver.emitted.map((event) => event.name)).toEqual(['avatar.speak.interrupt']);
  });

  it('voice_playback_requested with playbackState=canceled stops the audio pipeline', () => {
    const driver = createDriver();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const stopSpy = vi.spyOn(audioPipeline, 'stop');
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver, audioPipeline });

    pipeline.handleEvent({
      event_id: 'event-cancel',
      name: 'runtime.agent.presentation.voice_playback_requested',
      timestamp: '2026-04-25T00:00:00.030Z',
      detail: {
        turn_id: 'turn-1',
        stream_id: 'stream-1',
        runtime_timeline: createRuntimeTimeline({ sequence: 3 }),
        audioArtifactId: 'artifact-1',
        audioMimeType: 'audio/wav',
        playbackState: 'canceled',
      },
    });

    expect(stopSpy).toHaveBeenCalledWith('interrupted');
    expect(driver.emitted.map((event) => event.name)).toEqual(['avatar.speak.interrupt']);
  });
});
