import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioPipelineController, VoiceLipsyncStateBus } from '@nimiplatform/kit/features/avatar/headless';
import { activateLipsync, deactivateLipsync, initialVoiceCompanionState,
  setAudioPlaybackState, setMouthOpenY, type VoiceCompanionState } from '../voice-companion-state.js';
import { derivePresenceState } from '../companion-surface/presence-state-machine.js';
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
import { createAvatarVoiceLipsyncPipeline as createVoicePipelineOwner } from './avatar-voice-lipsync.js';
import { setAvatarLocalQuiet } from '../local-quiet-state.js';

const pipelines: ReturnType<typeof createVoicePipelineOwner>[] = [];
function createAvatarVoiceLipsyncPipeline(input: Parameters<typeof createVoicePipelineOwner>[0]) {
  const pipeline = createVoicePipelineOwner(input);
  pipelines.push(pipeline);
  return pipeline;
}
afterEach(() => {
  for (const pipeline of pipelines.splice(0)) pipeline.dispose();
  setAvatarLocalQuiet(false);
});

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

function createAudioPipeline(options: { autoComplete?: boolean } = {}) {
  const listeners = new Set<(snapshot: Record<string, unknown>) => void>();
  let current: Record<string, unknown> = { state: 'idle', audioArtifactId: null };
  const publish = (snapshot: Record<string, unknown>) => {
    current = snapshot;
    for (const listener of listeners) listener(snapshot);
  };
  const playBytes = vi.fn(async (input: { audioSourceId: string; audioMimeType: string }) => {
    publish({ state: 'requested', audioArtifactId: input.audioSourceId, audioMimeType: input.audioMimeType, reason: null });
    if (options.autoComplete === false) return;
    queueMicrotask(() => {
      publish({
          state: 'completed',
          audioArtifactId: input.audioSourceId,
          audioMimeType: input.audioMimeType,
          reason: null,
      });
    });
  });
  return {
    playBytes,
    stop: vi.fn(),
    reset: vi.fn(),
    registerLipsyncSink: vi.fn(() => vi.fn()),
    listenerCount: () => listeners.size,
    subscribe(listener: (snapshot: Record<string, unknown>) => void) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
  };
}

function realAudioPipeline(decode: () => Promise<AudioBuffer> = async () => ({ duration: 1 } as AudioBuffer)) {
  const sources: Array<{ buffer: AudioBuffer | null; onended: (() => void) | null;
    start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const audioPipeline = new AudioPipelineController({ logger: { warn: vi.fn(), error: vi.fn() }, audioContextFactory: () => ({
    destination: {}, decodeAudioData: decode,
    createBufferSource() {
      const source = { buffer: null, onended: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    },
  }) as unknown as AudioContext });
  let listeners = 0;
  const subscribe = audioPipeline.subscribe.bind(audioPipeline);
  vi.spyOn(audioPipeline, 'subscribe').mockImplementation(listener => {
    listeners++;
    const unsubscribe = subscribe(listener);
    let active = true;
    return () => { if (active) { active = false; listeners--; unsubscribe(); } };
  });
  return { audioPipeline, sources, listenerCount: () => listeners };
}

const flushPlayback = () => new Promise(resolve => setTimeout(resolve, 0));
const voiceChunk = (voiceId: string, sequence: number) => event(AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT, {
  voice_id: voiceId, chunk_sequence: sequence, audio_mime_type: 'audio/wav', chunk_bytes: [1], turn_id: `turn-${voiceId}`,
});

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
  it.each(['completed', 'failed'] as const)('clears local speaking presence after the owned playback becomes %s', async (terminal) => {
    const audio = realAudioPipeline(terminal === 'failed'
      ? async () => { throw new Error('decode failed'); } : undefined);
    const stateBus = new VoiceLipsyncStateBus();
    // Wire the actual reducers exactly as App's two subscriptions do. Runtime
    // turn status remains independent; this fixture starts with an idle turn.
    let voice: VoiceCompanionState = { ...initialVoiceCompanionState, availability: 'ready' };
    const unsubscribeBus = stateBus.subscribe(event => {
      if (event.kind === 'activate') voice = activateLipsync(voice, event);
      else if (event.kind === 'deactivate') voice = deactivateLipsync(voice);
      else if (event.kind === 'mouth_open_y') voice = setMouthOpenY(voice, event.value);
      else voice = setAudioPlaybackState(voice, event.state);
    });
    const unsubscribeAudio = audio.audioPipeline.subscribe(snapshot => { voice = setAudioPlaybackState(voice, snapshot.state); });
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver: createDriver(), audioPipeline: audio.audioPipeline, stateBus });
    try {
      pipeline.handleEvent(voiceChunk('terminal', 1));
      await flushPlayback();
      if (terminal === 'completed') {
        expect(voice.lipsyncActive).toBe(true);
        stateBus.publish({ kind: 'mouth_open_y', value: 0.7 });
        audio.sources[0]!.onended?.();
        await flushPlayback();
      }
      expect(voice).toMatchObject({ audioPlaybackState: terminal, lipsyncActive: false, audioArtifactId: null, currentMouthOpenY: 0 });
      const presence = derivePresenceState({ bootstrapReady: true, bindingPresent: true, compositionReady: true, voice });
      expect(presence.stateId).toBe(terminal === 'completed' ? 'idle' : 'muted_or_audio_unavailable');
      expect(presence.interruptVisible).toBe(false);
    } finally { unsubscribeBus(); unsubscribeAudio(); }
  });

  it.each(['started', 'completed'] as const)('does not settle a same-ID replay from the previous %s request', async (previousState) => {
    const audio = realAudioPipeline();
    await audio.audioPipeline.playBytes({ audioSourceId: 'avatar-conversation-voice://replay/chunks/000001',
      audioMimeType: 'audio/wav', bytes: new Uint8Array([1]) });
    if (previousState === 'completed') audio.sources[0]!.onended?.();
    const stateBus = createStateBus();
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver: createDriver(),
      audioPipeline: audio.audioPipeline, stateBus: stateBus as never });
    pipeline.handleEvent(voiceChunk('replay', 1));
    pipeline.handleEvent(voiceChunk('replay', 2));
    await flushPlayback();
    expect(audio.sources).toHaveLength(2);
    expect(audio.sources[1]!.stop).not.toHaveBeenCalled();
    expect(audio.listenerCount()).toBe(1);
    audio.sources[1]!.onended?.();
    await flushPlayback();
    expect(audio.sources).toHaveLength(3);
    expect(stateBus.publish).not.toHaveBeenCalledWith({ kind: 'deactivate' });
    audio.sources[2]!.onended?.();
    await flushPlayback();
    expect(audio.listenerCount()).toBe(0);
    expect(stateBus.publish).toHaveBeenCalledWith({ kind: 'deactivate' });
  });

  it('settles a superseded voice without letting its queued chunk take over the new voice', async () => {
    const audio = realAudioPipeline();
    const stateBus = createStateBus();
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver: createDriver(),
      audioPipeline: audio.audioPipeline, stateBus: stateBus as never });
    pipeline.handleEvent(voiceChunk('old', 1));
    pipeline.handleEvent(voiceChunk('old', 2));
    await flushPlayback();
    pipeline.handleEvent(voiceChunk('new', 1));
    await flushPlayback();
    expect(audio.sources).toHaveLength(2);
    expect(audio.audioPipeline.getSnapshot()).toMatchObject({ state: 'started',
      audioArtifactId: 'avatar-conversation-voice://new/chunks/000001' });
    expect(audio.listenerCount()).toBe(1);
    expect(stateBus.publish).not.toHaveBeenCalledWith({ kind: 'deactivate' });
    audio.sources[1]!.onended?.();
    await flushPlayback();
    expect(audio.listenerCount()).toBe(0);
  });

  it.each(['dispose', 'quiet'] as const)('%s releases every owned waiter even when the supplied pipeline emits no terminal event', async (action) => {
    const audioPipeline = createAudioPipeline({ autoComplete: false });
    const externalUnsubscribe = audioPipeline.subscribe(() => {});
    const pipeline = createAvatarVoiceLipsyncPipeline({ driver: createDriver(),
      audioPipeline: audioPipeline as never, stateBus: createStateBus() as never });
    pipeline.handleEvent(voiceChunk('first', 1));
    pipeline.handleEvent(voiceChunk('second', 1));
    await flushPlayback();
    expect(audioPipeline.listenerCount()).toBe(3);
    if (action === 'dispose') pipeline.dispose();
    else setAvatarLocalQuiet(true);
    await flushPlayback();
    expect(audioPipeline.listenerCount()).toBe(1);
    expect(audioPipeline.playBytes).toHaveBeenCalledTimes(2);
    externalUnsubscribe();
  });

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

  it('immediately stops only the matching active Conversation voice on failure', async () => {
    const audioPipeline = createAudioPipeline({ autoComplete: false });
    const stateBus = createStateBus();
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver: createDriver(),
      audioPipeline: audioPipeline as never,
      stateBus: stateBus as never,
    });
    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT, {
      voice_id: 'voice-active', chunk_sequence: 1,
      audio_mime_type: 'audio/wav', chunk_bytes: [1], turn_id: 'turn-1',
    }));
    await vi.waitFor(() => expect(audioPipeline.playBytes).toHaveBeenCalledOnce());

    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_FAILED_EVENT, {
      voice_id: 'voice-other', reason: 'render-failed',
    }));
    expect(audioPipeline.stop).not.toHaveBeenCalled();

    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_FAILED_EVENT, {
      voice_id: 'voice-active', reason: 'render-failed',
    }));
    expect(audioPipeline.stop).toHaveBeenCalledWith('interrupted');
    expect(stateBus.publish).toHaveBeenCalledWith({ kind: 'deactivate' });
    expect(stateBus.publish).toHaveBeenCalledWith({
      kind: 'audio_playback_state',
      state: 'failed',
    });

    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT, {
      voice_id: 'voice-active', chunk_sequence: 2,
      audio_mime_type: 'audio/wav', chunk_bytes: [2], turn_id: 'turn-1',
    }));
    await Promise.resolve();
    expect(audioPipeline.playBytes).toHaveBeenCalledTimes(1);
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

  it('permanently fences a voice id first observed during Quiet after re-engage', async () => {
    const audioPipeline = createAudioPipeline();
    const stateBus = createStateBus();
    const pipeline = createAvatarVoiceLipsyncPipeline({
      driver: createDriver(),
      audioPipeline: audioPipeline as never,
      stateBus: stateBus as never,
    });
    setAvatarLocalQuiet(true);
    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT, {
      voice_id: 'voice-late',
      chunk_sequence: 1,
      audio_mime_type: 'audio/wav',
      chunk_bytes: [1, 2],
      turn_id: 'turn-quiet',
    }));
    await Promise.resolve();
    expect(audioPipeline.reset).toHaveBeenCalled();
    expect(audioPipeline.playBytes).not.toHaveBeenCalled();
    expect(stateBus.publish).toHaveBeenCalledWith({ kind: 'deactivate' });

    setAvatarLocalQuiet(false);
    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT, {
      voice_id: 'voice-late',
      chunk_sequence: 2,
      audio_mime_type: 'audio/wav',
      chunk_bytes: [3, 4],
      turn_id: 'turn-quiet',
    }));
    await Promise.resolve();
    await Promise.resolve();
    expect(audioPipeline.playBytes).not.toHaveBeenCalled();

    pipeline.handleEvent(event(AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT, {
      voice_id: 'voice-new',
      chunk_sequence: 1,
      audio_mime_type: 'audio/wav',
      chunk_bytes: [5],
      turn_id: 'turn-new',
    }));
    await vi.waitFor(() => expect(audioPipeline.playBytes).toHaveBeenCalledOnce());
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
