// Avatar-owned playback/lipsync composition. Runtime owns only the common
// semantic Conversation/Embodiment facts upstream; decoder clock, local
// playback, backend audio analysis, and mouth parameters remain here.

import type { BackendAudioConsumer } from '@nimiplatform/kit/features/avatar/headless';
import {
  AudioPipelineController,
  getSharedAudioPipelineController,
  getSharedVoiceLipsyncStateBus,
  type AudioPlaybackState,
  type VoiceLipsyncStateBus,
} from '@nimiplatform/kit/features/avatar/headless';
import type { BackendBranch } from '../carrier/backend-branch.js';
import type { AgentDataDriver, AgentEvent } from '../driver/types.js';
import {
  AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT,
  AVATAR_CONVERSATION_VOICE_FAILED_EVENT,
  avatarConversationVoiceSourceId,
} from './avatar-conversation-voice.js';

type VoiceBytesInput = {
  audioSourceId: string;
  audioMimeType: string;
  bytes: Uint8Array | ArrayBuffer;
};

type ConversationVoiceChunkInput = VoiceBytesInput & {
  voiceId: string;
  chunkSequence: number;
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

export function createAvatarVoiceLipsyncPipeline(input: {
  driver: AgentDataDriver;
  stateBus?: VoiceLipsyncStateBus;
  audioPipeline?: AudioPipelineController;
  backend?: BackendBranch;
}): AvatarVoiceLipsyncPipeline {
  const canceled = new Set<string>();
  const playbackChains = new Map<string, Promise<void>>();
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
    const turnId = readString(detail, 'turn_id');
    if (!turnId) return;
    for (const identity of playbackChains.keys()) canceled.add(identity);
    audioPipeline.stop('interrupted');
    stateBus.publish({ kind: 'deactivate' });
    publishPlaybackState('interrupted');
    input.driver.emit({
      name: 'avatar.speak.interrupt',
      detail: {
        turn_id: turnId,
        stream_id: readString(detail, 'stream_id') ?? turnId,
        source_event_name: event.name,
      },
    });
  }

  function playVoiceBytesAndWait(voiceInput: VoiceBytesInput): Promise<AudioPlaybackState> {
    return new Promise((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => {};
      const settle = (state: AudioPlaybackState) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(state);
      };
      unsubscribe = audioPipeline.subscribe((snapshot) => {
        if (snapshot.audioArtifactId !== voiceInput.audioSourceId) return;
        if (snapshot.state === 'completed'
          || snapshot.state === 'failed'
          || snapshot.state === 'interrupted') {
          settle(snapshot.state);
        }
      });
      void audioPipeline.playBytes(voiceInput).catch(() => settle('failed'));
    });
  }

  function enqueueConversationVoiceChunk(
    identity: string,
    voiceInput: ConversationVoiceChunkInput,
  ): void {
    const previous = playbackChains.get(identity) ?? Promise.resolve();
    let next: Promise<void>;
    next = previous
      .catch(() => undefined)
      .then(async () => {
        if (disposed || canceled.has(identity)) return;
        stateBus.publish({ kind: 'activate', audioArtifactId: voiceInput.audioSourceId });
        publishPlaybackState('requested');
        await playVoiceBytesAndWait({
          audioSourceId: voiceInput.audioSourceId,
          audioMimeType: voiceInput.audioMimeType,
          bytes: voiceInput.bytes,
        });
      })
      .finally(() => {
        if (playbackChains.get(identity) === next) playbackChains.delete(identity);
      });
    playbackChains.set(identity, next);
  }

  function handleConversationVoiceChunk(
    event: AgentEvent,
    detail: Record<string, unknown>,
  ): boolean {
    if (event.name !== AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT) return false;
    const voiceId = readString(detail, 'voice_id') ?? readString(detail, 'voiceId');
    const audioMimeType = readString(detail, 'audio_mime_type') ?? readString(detail, 'audioMimeType');
    const bytes = readBytes(detail['chunk_bytes'] ?? detail['chunkBytes']);
    const chunkSequence = Number(detail['chunk_sequence'] ?? detail['chunkSequence'] ?? 0);
    if (!voiceId || !audioMimeType || !bytes
      || !Number.isSafeInteger(chunkSequence) || chunkSequence <= 0) return true;
    enqueueConversationVoiceChunk(`conversation:${voiceId}`, {
      audioSourceId: avatarConversationVoiceSourceId(voiceId, chunkSequence),
      audioMimeType,
      bytes,
      voiceId,
      chunkSequence,
    });
    return true;
  }

  function handleConversationVoiceFailure(
    event: AgentEvent,
    detail: Record<string, unknown>,
  ): boolean {
    if (event.name !== AVATAR_CONVERSATION_VOICE_FAILED_EVENT) return false;
    const voiceId = readString(detail, 'voice_id') ?? readString(detail, 'voiceId');
    if (!voiceId) return true;
    canceled.add(`conversation:${voiceId}`);
    console.warn(
      `[avatar:voice] Conversation voice ${voiceId} failed: ${readString(detail, 'reason') ?? 'conversation_voice_failed'}`,
    );
    return true;
  }

  return {
    handleEvent(event) {
      if (disposed) return;
      const detail = readRecord(event.detail);
      if (!detail) return;
      if (handleConversationVoiceChunk(event, detail)) return;
      if (handleConversationVoiceFailure(event, detail)) return;
      if (event.name === 'runtime.agent.turn.interrupted'
        || event.name === 'runtime.agent.turn.interrupt_ack') {
        handleInterrupt(event, detail);
      }
    },
    dispose() {
      disposed = true;
      audioPipeline.stop('interrupted');
      stateBus.publish({ kind: 'deactivate' });
      publishPlaybackState('idle');
      canceled.clear();
      playbackChains.clear();
      unregisterSink?.();
    },
  };
}

function readBytes(value: unknown): Uint8Array | ArrayBuffer | null {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  return null;
}

function getBackendAudioConsumer(backend: BackendBranch): BackendAudioConsumer {
  const consumer = (backend as unknown as { audioConsumer?: unknown }).audioConsumer;
  if (consumer && typeof consumer === 'object'
    && typeof (consumer as { attachAudioSource?: unknown }).attachAudioSource === 'function'
    && typeof (consumer as { detachAudioSource?: unknown }).detachAudioSource === 'function'
    && typeof (consumer as { silent?: unknown }).silent === 'function'
    && typeof (consumer as { snapshot?: unknown }).snapshot === 'function') {
    return consumer as BackendAudioConsumer;
  }
  throw new Error(
    'avatar-voice-lipsync: backend.audioConsumer missing (mounted BackendSurface wiring required)',
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
