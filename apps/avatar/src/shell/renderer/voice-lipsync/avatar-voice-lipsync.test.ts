import { describe, expect, it, vi } from 'vitest';
import type {
  AgentDataBundle,
  AgentDataDriver,
  AgentEvent,
  AppOriginEvent,
  DriverStatus,
} from '../driver/types.js';
import type { BackendBranch } from '../carrier/backend-branch.js';
import {
  AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT,
  AVATAR_CONVERSATION_VOICE_FAILED_EVENT,
} from './avatar-conversation-voice.js';
import { createAvatarVoiceLipsyncPipeline } from './avatar-voice-lipsync.js';

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
    emit: (event) => { emitted.push(event); },
    emitted,
  };
}

function createAudioPipeline() {
  const listeners = new Set<(snapshot: Record<string, unknown>) => void>();
  const playBytes = vi.fn(async (input: { audioSourceId: string; audioMimeType: string }) => {
    queueMicrotask(() => {
      for (const listener of listeners) {
        listener({
          state: 'completed',
          audioArtifactId: input.audioSourceId,
          audioMimeType: input.audioMimeType,
          reason: null,
        });
      }
    });
  });
  return {
    playBytes,
    stop: vi.fn(),
    registerLipsyncSink: vi.fn(() => vi.fn()),
    subscribe(listener: (snapshot: Record<string, unknown>) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createStateBus() {
  return { publish: vi.fn() };
}

function event(name: string, detail: Record<string, unknown>): AgentEvent {
  return {
    event_id: 'event-1',
    name,
    timestamp: '2026-08-29T00:00:00.000Z',
    detail,
  };
}

function createBackendMock(): BackendBranch & { audioConsumer: Record<string, unknown> } {
  const audioConsumer = {
    attachAudioSource: vi.fn(async () => undefined),
    detachAudioSource: vi.fn(),
    silent: vi.fn(),
    snapshot: vi.fn(() => null),
  };
  return {
    kind: 'live2d',
    nominalBounds: { width: 400, height: 600, bodyCenterX: 0.5, bodyCenterY: 0.5 },
    projection: {
      applyActivity: vi.fn(), applyEmotion: vi.fn(), applyMotion: vi.fn(),
      applyExpression: vi.fn(), reset: vi.fn(),
    },
    surface: { Component: () => null },
    metadata: () => ({}),
    shutdown: vi.fn(),
    live2dExtension: { setParameter: vi.fn() },
    audioConsumer,
  } as never;
}

describe('Avatar Conversation voice lipsync owner', () => {
  it('plays canonical Conversation bytes through an Avatar-owned source identity', async () => {
    const audioPipeline = createAudioPipeline();
    const stateBus = createStateBus();
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver: createDriver(),
      audioPipeline: audioPipeline as never,
      stateBus: stateBus as never,
    });
    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT, {
      voice_id: 'voice-1',
      chunk_sequence: 1,
      audio_mime_type: 'audio/wav',
      chunk_bytes: Uint8Array.from([1, 2, 3]),
      turn_id: 'turn-1',
    }));
    await vi.waitFor(() => expect(audioPipeline.playBytes).toHaveBeenCalledOnce());
    expect(audioPipeline.playBytes).toHaveBeenCalledWith({
      audioSourceId: 'avatar-conversation-voice://voice-1/chunks/000001',
      audioMimeType: 'audio/wav',
      bytes: Uint8Array.from([1, 2, 3]),
    });
    expect(stateBus.publish).toHaveBeenCalledWith({
      kind: 'activate',
      audioArtifactId: 'avatar-conversation-voice://voice-1/chunks/000001',
    });
  });

  it('does not consume an unrelated presentation event', async () => {
    const audioPipeline = createAudioPipeline();
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver: createDriver(),
      audioPipeline: audioPipeline as never,
      stateBus: createStateBus() as never,
    });
    pipeline.handleEvent(event('retired.presentation.voice', {
      audio_artifact_id: 'artifact-legacy',
      audio_mime_type: 'audio/wav',
    }));
    await Promise.resolve();
    expect(audioPipeline.playBytes).not.toHaveBeenCalled();
  });

  it('fences a failed Conversation voice before queued playback', async () => {
    const audioPipeline = createAudioPipeline();
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver: createDriver(),
      audioPipeline: audioPipeline as never,
      stateBus: createStateBus() as never,
    });
    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_FAILED_EVENT, {
      voice_id: 'voice-failed', reason: 'render-failed',
    }));
    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT, {
      voice_id: 'voice-failed', chunk_sequence: 1,
      audio_mime_type: 'audio/wav', chunk_bytes: [1], turn_id: 'turn-1',
    }));
    await Promise.resolve();
    await Promise.resolve();
    expect(audioPipeline.playBytes).not.toHaveBeenCalled();
  });

  it('interrupts local playback and emits only an Avatar-owned interrupt cue', () => {
    const driver = createDriver();
    const audioPipeline = createAudioPipeline();
    const stateBus = createStateBus();
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver,
      audioPipeline: audioPipeline as never,
      stateBus: stateBus as never,
    });
    pipeline.handleEvent(event('runtime.agent.turn.interrupted', {
      turn_id: 'turn-1', stream_id: 'turn-1', reason: 'user-interrupt',
    }));
    expect(audioPipeline.stop).toHaveBeenCalledWith('interrupted');
    expect(driver.emitted).toEqual([{
      name: 'avatar.speak.interrupt',
      detail: {
        turn_id: 'turn-1', stream_id: 'turn-1',
        source_event_name: 'runtime.agent.turn.interrupted',
      },
    }]);
  });

  it('binds and releases the backend-owned audio consumer', () => {
    const backend = createBackendMock();
    const audioPipeline = createAudioPipeline();
    const unregister = vi.fn();
    audioPipeline.registerLipsyncSink.mockReturnValue(unregister);
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver: createDriver(), backend,
      audioPipeline: audioPipeline as never,
      stateBus: createStateBus() as never,
    });
    expect(audioPipeline.registerLipsyncSink).toHaveBeenCalledWith(backend.audioConsumer);
    pipeline.dispose();
    expect(unregister).toHaveBeenCalledOnce();
  });
});
