// Contract test for the avatar audio + lipsync pipeline defined by
// .nimi/spec/avatar/embodiment-surface.authority.yaml. Exercises:
//
//   1. Canonical Conversation voice bytes enter the Avatar-owned playback port.
//   2. AudioPipelineController consumes those bytes directly.
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
import { AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT } from './avatar-conversation-voice.js';
import {
  AudioPipelineController,
  SYNTHETIC_AUDIO_MIME_TYPE,
  VoiceLipsyncStateBus,
  type BackendAudioConsumer,
  type VoiceLipsyncStateBusEvent,
} from '@nimiplatform/kit/features/avatar/headless';
import type { BackendBranch } from '../carrier/backend-branch.js';

const FIXTURE_TURN_ID = 'turn-e2e';
const FIXTURE_STREAM_ID = 'stream-e2e';
const FIXTURE_AUDIO_BYTES = new Uint8Array(256);

function makeConversationVoiceChunkEvent(
  audioMimeType = 'audio/wav',
): AgentEvent {
  return {
    event_id: 'event-conversation-voice',
    name: AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT,
    timestamp: '2026-04-29T00:00:00.030Z',
    detail: {
      turn_id: FIXTURE_TURN_ID,
      voice_id: 'voice-e2e',
      chunk_sequence: 1,
      audio_mime_type: audioMimeType,
      chunk_bytes: FIXTURE_AUDIO_BYTES,
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

describe('Lipsync e2e — Conversation voice → audio-pipeline → backend sink', () => {
  it('runs the full path against a Live2D mock backend (real-audio mime; sink attached)', async () => {
    const driver = createDriver();
    const stateBus = new VoiceLipsyncStateBus();
    const fake = createFakeAudioContext();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const backend = createBackend('live2d');
    const busEvents: VoiceLipsyncStateBusEvent[] = [];
    stateBus.subscribe((event) => busEvents.push(event));

    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver,
      stateBus,
      audioPipeline,
      backend,
    });

    pipeline.handleEvent(makeConversationVoiceChunkEvent());
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

  it('runs the same fixture against a VRM mock backend with equivalent sink ownership', async () => {
    const driver = createDriver();
    const stateBus = new VoiceLipsyncStateBus();
    const fake = createFakeAudioContext();
    const audioPipeline = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const backend = createBackend('vrm');
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver,
      stateBus,
      audioPipeline,
      backend,
    });

    pipeline.handleEvent(makeConversationVoiceChunkEvent());
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
    const backend = createBackend('live2d');
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver,
      stateBus,
      audioPipeline,
      backend,
    });

    pipeline.handleEvent(makeConversationVoiceChunkEvent(SYNTHETIC_AUDIO_MIME_TYPE));
    await vi.waitFor(() => expect(audioPipeline.getSnapshot().state).toBe('completed'));

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
    const backend = createBackend('live2d');
    const busEvents: VoiceLipsyncStateBusEvent[] = [];
    stateBus.subscribe((event) => busEvents.push(event));

    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver,
      stateBus,
      audioPipeline,
      backend,
    });

    pipeline.handleEvent(makeConversationVoiceChunkEvent());
    await vi.waitFor(() => expect(fake.source.start).toHaveBeenCalledTimes(1));

    pipeline.handleEvent({
      event_id: 'event-interrupt',
      name: 'runtime.agent.turn.interrupted',
      timestamp: '2026-04-29T00:00:00.080Z',
      detail: {
        turn_id: FIXTURE_TURN_ID,
        stream_id: FIXTURE_STREAM_ID,
      },
    });

    expect(fake.source.stop).toHaveBeenCalled();
    expect(backend.audioConsumer.silent).toHaveBeenCalled();
    expect(busEvents.map((e) => e.kind)).toContain('deactivate');
    expect(driver.emitted.some((e) => e.name === 'avatar.speak.interrupt')).toBe(true);
  });
});
