import type { NimiRuntimeAgentVoiceModule } from '@nimiplatform/sdk/runtime';
import type { AgentEvent } from '../driver/types.js';
import {
  normalizeRuntimeTimelineForAvatar,
  optionalRuntimeDetailText,
  toRuntimeAgentEvent,
  type RuntimeAgentConsumeEvent,
} from './sdk-driver-event-helpers.js';

type RuntimeVoiceModule = Pick<NimiRuntimeAgentVoiceModule, 'subscribeStream'>;

export type NativeVoiceStreamSubscriptionPlan = {
  voiceStreamId: string;
  conversationAnchorId: string;
  turnId: string;
  streamId: string;
  playbackTarget: string;
  fallbackMimeType: string;
  runtimeTimeline: ReturnType<typeof normalizeRuntimeTimelineForAvatar>;
  abortController: AbortController;
};

export function buildNativeVoiceStreamSubscriptionPlan(input: {
  event: RuntimeAgentConsumeEvent;
  runtimeVoice?: RuntimeVoiceModule;
  nativeVoiceStreamSubscriptions: ReadonlySet<string>;
  abortController: AbortController | null;
}): NativeVoiceStreamSubscriptionPlan | null {
  if (!input.runtimeVoice || input.event.eventName !== 'runtime.agent.presentation.voice_stream_chunk_available') {
    return null;
  }
  const detail = input.event.detail as Record<string, unknown>;
  if (detail.finalChunk === true || detail.final_chunk === true) {
    return null;
  }
  if (optionalRuntimeDetailText(detail.audioArtifactId) || optionalRuntimeDetailText(detail.audio_artifact_id)) {
    return null;
  }
  const voiceStreamId = optionalRuntimeDetailText(detail.voiceStreamId)
    ?? optionalRuntimeDetailText(detail.voice_stream_id);
  if (!voiceStreamId || input.nativeVoiceStreamSubscriptions.has(voiceStreamId)) {
    return null;
  }
  const playbackTarget = optionalRuntimeDetailText(detail.playbackTarget)
    ?? optionalRuntimeDetailText(detail.playback_target);
  if (playbackTarget !== 'avatar_autoplay') {
    return null;
  }
  if (!input.abortController || input.abortController.signal.aborted) {
    return null;
  }
  return {
    voiceStreamId,
    conversationAnchorId: input.event.conversationAnchorId,
    turnId: input.event.turnId,
    streamId: input.event.streamId,
    playbackTarget,
    fallbackMimeType: optionalRuntimeDetailText(detail.audioMimeType)
      ?? optionalRuntimeDetailText(detail.audio_mime_type)
      ?? 'audio/wav',
    runtimeTimeline: normalizeRuntimeTimelineForAvatar(input.event),
    abortController: input.abortController,
  };
}

export async function consumeNativeVoiceStream(input: NativeVoiceStreamSubscriptionPlan & {
  runtimeVoice?: RuntimeVoiceModule;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  now: () => number;
  emitAgentEvent: (event: AgentEvent) => void;
  setLastError: (message: string) => void;
}): Promise<void> {
  try {
    const stream = await input.runtimeVoice?.subscribeStream({
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
      conversationAnchorId: input.conversationAnchorId,
      turnId: input.turnId,
      voiceStreamId: input.voiceStreamId,
    }, { signal: input.abortController.signal });
    if (!stream) {
      return;
    }
    for await (const event of stream) {
      if (input.abortController.signal.aborted) {
        return;
      }
      if (event.terminal) {
        return;
      }
      const bytes = bytesFromRuntimeVoiceChunk(event.chunk);
      if (!bytes || bytes.byteLength === 0) {
        continue;
      }
      input.emitAgentEvent(toRuntimeAgentEvent('avatar.speak.native_audio_chunk', {
        voice_stream_id: event.voiceStreamId || input.voiceStreamId,
        chunk_sequence: event.chunkSequence ?? 0,
        audio_mime_type: event.mimeType || input.fallbackMimeType,
        playback_target: event.playbackTarget || input.playbackTarget,
        turn_id: event.turnId || input.turnId,
        stream_id: event.streamId || input.streamId,
        chunk_bytes: bytes,
        ...(input.runtimeTimeline ? { runtime_timeline: input.runtimeTimeline } : {}),
      }, input.now()));
    }
  } catch (error) {
    if (input.abortController.signal.aborted) {
      return;
    }
    const message = nativeVoiceErrorMessage(error);
    input.setLastError(message);
    input.emitAgentEvent(toRuntimeAgentEvent('avatar.speak.native_audio_stream_failed', {
      voice_stream_id: input.voiceStreamId,
      turn_id: input.turnId,
      stream_id: input.streamId,
      reason: message,
      ...(input.runtimeTimeline ? { runtime_timeline: input.runtimeTimeline } : {}),
    }, input.now()));
  }
}

function nativeVoiceErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown avatar sdk driver error');
}

function bytesFromRuntimeVoiceChunk(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  return null;
}
