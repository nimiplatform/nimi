import { getSharedAudioPipelineController } from '@nimiplatform/kit/features/avatar';

export type ZhiyuVoiceStreamSubscribeInput = {
  readonly agentId: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly voiceStreamId: string;
  readonly cursor?: string;
};

export type ZhiyuVoiceStreamEvent = {
  readonly voiceStreamId: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly streamId: string;
  readonly messageId: string;
  readonly chunkSequence: string;
  readonly chunk: Uint8Array;
  readonly mimeType: string;
  readonly voiceOutputMode: unknown;
  readonly playbackTarget: string;
  readonly terminal: boolean;
  readonly voicePlaybackState: unknown;
  readonly terminalReason: string;
  readonly replayTruncated: boolean;
};

export type ZhiyuVoiceStreamPage = {
  readonly cursor: string;
  readonly events: readonly ZhiyuVoiceStreamEvent[];
};

export type ZhiyuVoicePlaybackState =
  | 'idle'
  | 'active'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'canceled'
  | 'text_only';

export type ZhiyuVoicePlaybackAction =
  | 'none'
  | 'subscribe_stream'
  | 'replay_artifact';

export type ZhiyuVoicePlaybackProjectionInput = {
  readonly voiceOutputMode?: unknown;
  readonly voicePlaybackState?: unknown;
  readonly voiceAudioArtifactId?: unknown;
  readonly voiceAudioMimeType?: unknown;
  readonly voiceStreamId?: unknown;
};

export type ZhiyuVoicePlaybackRunInput = ZhiyuVoicePlaybackProjectionInput & {
  readonly agentId?: unknown;
  readonly conversationAnchorId?: unknown;
  readonly turnId?: unknown;
};

export type ZhiyuVoicePlaybackProjection = {
  readonly state: ZhiyuVoicePlaybackState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly outputMode: string;
  readonly playbackState: string;
  readonly audioArtifactId: string;
  readonly audioMimeType: string;
  readonly voiceStreamId: string;
  readonly playbackAction: ZhiyuVoicePlaybackAction;
  readonly violation: boolean;
};

export type ZhiyuVoicePlaybackControllerDeps = {
  readonly subscribeStream: (
    input: ZhiyuVoiceStreamSubscribeInput,
  ) => Promise<ZhiyuVoiceStreamPage | AsyncIterable<ZhiyuVoiceStreamEvent>>;
  readonly readArtifactBytes: (artifactId: string) => Promise<{
    readonly bytes?: Uint8Array;
    readonly mimeType?: string;
  }>;
  readonly playAudioBytes: (
    bytes: Uint8Array,
    mimeType: string,
    audioSourceId: string,
  ) => Promise<void> | void;
};

export function projectZhiyuVoicePlayback(
  input: ZhiyuVoicePlaybackProjectionInput,
): ZhiyuVoicePlaybackProjection {
  const outputMode = normalizeVoiceText(input.voiceOutputMode);
  const playbackState = normalizeVoiceText(input.voicePlaybackState);
  const audioArtifactId = normalizeVoiceText(input.voiceAudioArtifactId);
  const audioMimeType = normalizeVoiceText(input.voiceAudioMimeType);
  const voiceStreamId = normalizeVoiceText(input.voiceStreamId);

  if (!outputMode && !playbackState && !audioArtifactId && !voiceStreamId) {
    return voicePlaybackProjection({
      state: 'idle',
      reasonCode: 'runtime-voice-no-current-output',
      actionHint: 'wait_runtime_voice_projection',
      outputMode,
      playbackState,
      audioArtifactId,
      audioMimeType,
      voiceStreamId,
      playbackAction: 'none',
      violation: false,
    });
  }

  if (outputMode === 'simulated_stream') {
    return voicePlaybackViolation({
      reasonCode: 'runtime-voice-simulated-stream-not-admitted',
      actionHint: 'inspect_runtime_voice_truth',
      outputMode,
      playbackState,
      audioArtifactId,
      audioMimeType,
      voiceStreamId,
    });
  }

  if (outputMode === 'text_only') {
    return voicePlaybackProjection({
      state: 'text_only',
      reasonCode: 'runtime-voice-text-only',
      actionHint: 'render_text_only_turn',
      outputMode,
      playbackState,
      audioArtifactId,
      audioMimeType,
      voiceStreamId,
      playbackAction: 'none',
      violation: false,
    });
  }

  if (outputMode === 'native_stream') {
    if (!voiceStreamId) {
      return voicePlaybackViolation({
        reasonCode: 'runtime-voice-native-stream-id-missing',
        actionHint: 'inspect_runtime_voice_stream_projection',
        outputMode,
        playbackState,
        audioArtifactId,
        audioMimeType,
        voiceStreamId,
      });
    }
    if (!isRuntimeVoicePlaybackState(playbackState)) {
      return voicePlaybackViolation({
        reasonCode: 'runtime-voice-playback-state-missing',
        actionHint: 'inspect_runtime_voice_playback_state',
        outputMode,
        playbackState,
        audioArtifactId,
        audioMimeType,
        voiceStreamId,
      });
    }
    return voicePlaybackProjection({
      state: playbackState,
      reasonCode: `runtime-voice-native-stream-${playbackState}`,
      actionHint: playbackState === 'active'
        ? 'subscribe_runtime_voice_stream'
        : 'reflect_runtime_voice_terminal_state',
      outputMode,
      playbackState,
      audioArtifactId,
      audioMimeType,
      voiceStreamId,
      playbackAction: playbackState === 'active' ? 'subscribe_stream' : 'none',
      violation: false,
    });
  }

  if (outputMode === 'batch_final_artifact') {
    if (!audioArtifactId) {
      return voicePlaybackViolation({
        reasonCode: 'runtime-voice-final-artifact-id-missing',
        actionHint: 'inspect_runtime_voice_artifact_projection',
        outputMode,
        playbackState,
        audioArtifactId,
        audioMimeType,
        voiceStreamId,
      });
    }
    if (audioMimeType && !audioMimeType.toLowerCase().startsWith('audio/')) {
      return voicePlaybackViolation({
        reasonCode: 'runtime-voice-final-artifact-mime-invalid',
        actionHint: 'inspect_runtime_voice_artifact_mime',
        outputMode,
        playbackState,
        audioArtifactId,
        audioMimeType,
        voiceStreamId,
      });
    }
    return voicePlaybackProjection({
      state: isRuntimeVoicePlaybackState(playbackState) ? playbackState : 'completed',
      reasonCode: 'runtime-voice-batch-final-artifact-ready',
      actionHint: 'replay_runtime_voice_artifact',
      outputMode,
      playbackState,
      audioArtifactId,
      audioMimeType,
      voiceStreamId,
      playbackAction: 'replay_artifact',
      violation: false,
    });
  }

  return voicePlaybackViolation({
    reasonCode: 'runtime-voice-output-mode-invalid',
    actionHint: 'inspect_runtime_voice_output_mode',
    outputMode,
    playbackState,
    audioArtifactId,
    audioMimeType,
    voiceStreamId,
  });
}

export function createZhiyuVoicePlaybackController(
  deps: ZhiyuVoicePlaybackControllerDeps,
): {
  readonly run: (input: ZhiyuVoicePlaybackRunInput) => Promise<ZhiyuVoicePlaybackProjection>;
} {
  return {
    async run(input) {
      const projection = projectZhiyuVoicePlayback(input);
      if (projection.violation || projection.playbackAction === 'none') {
        return projection;
      }
      if (projection.playbackAction === 'replay_artifact') {
        const artifact = await deps.readArtifactBytes(projection.audioArtifactId);
        await deps.playAudioBytes(
          requireAudioBytes(artifact.bytes),
          requireAudioMimeType(artifact.mimeType),
          projection.audioArtifactId,
        );
        return projection;
      }
      const agentId = normalizeVoiceText(input.agentId);
      const conversationAnchorId = normalizeVoiceText(input.conversationAnchorId);
      const turnId = normalizeVoiceText(input.turnId);
      if (!agentId || !conversationAnchorId || !turnId) {
        return voicePlaybackViolation({
          reasonCode: 'runtime-voice-stream-correlation-missing',
          actionHint: 'wait_runtime_voice_turn_identity',
          outputMode: projection.outputMode,
          playbackState: projection.playbackState,
          audioArtifactId: projection.audioArtifactId,
          audioMimeType: projection.audioMimeType,
          voiceStreamId: projection.voiceStreamId,
        });
      }
      const subscribeInput = {
        agentId,
        conversationAnchorId,
        turnId,
        voiceStreamId: projection.voiceStreamId,
      };
      const subscription = await deps.subscribeStream(subscribeInput);
      if (isAsyncVoiceStream(subscription)) {
        let eventCount = 0;
        for await (const event of subscription) {
          eventCount += 1;
          if (eventCount > 4096) break;
          await consumeVoiceStreamEvent(deps, event, projection.outputMode);
          if (event.terminal) return projection;
        }
      } else {
        let page = subscription;
        for (let eventCount = 0; eventCount < 4096; eventCount += 1) {
          const event = page.events[0];
          await consumeVoiceStreamEvent(deps, event, projection.outputMode);
          if (event.terminal) return projection;
          page = await deps.subscribeStream({ ...subscribeInput, cursor: page.cursor }) as ZhiyuVoiceStreamPage;
        }
      }
      throw voicePlaybackError(
        'runtime-voice-stream-event-bound-exceeded',
        'inspect_runtime_voice_stream_truth',
      );
    },
  };
}

async function consumeVoiceStreamEvent(
  deps: ZhiyuVoicePlaybackControllerDeps,
  event: ZhiyuVoiceStreamEvent | undefined,
  expectedOutputMode: string,
): Promise<void> {
  if (!event) {
    throw voicePlaybackError('runtime-voice-stream-event-missing', 'inspect_runtime_voice_stream_truth');
  }
  if (normalizeVoiceOutputMode(event.voiceOutputMode) !== expectedOutputMode) {
    throw voicePlaybackError(
      'runtime-voice-stream-output-mode-mismatch',
      'inspect_runtime_voice_stream_truth',
    );
  }
  if (event.chunk.byteLength > 0) {
    await deps.playAudioBytes(
      event.chunk,
      requireAudioMimeType(event.mimeType),
      `runtime-agent-voice-stream://${event.voiceStreamId}/chunks/${event.chunkSequence}`,
    );
  }
}

function isAsyncVoiceStream(
  value: ZhiyuVoiceStreamPage | AsyncIterable<ZhiyuVoiceStreamEvent>,
): value is AsyncIterable<ZhiyuVoiceStreamEvent> {
  return Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === 'function';
}

function normalizeVoiceOutputMode(value: unknown): string {
  if (value === 1) return 'native_stream';
  if (value === 2) return 'simulated_stream';
  if (value === 3) return 'batch_final_artifact';
  if (value === 4) return 'text_only';
  return normalizeVoiceText(value).toLowerCase();
}

function voicePlaybackError(reasonCode: string, actionHint: string): Error {
  return Object.assign(new Error(reasonCode), { reasonCode, actionHint, source: 'runtime' });
}

export async function playZhiyuVoiceAudioBytes(
  bytes: Uint8Array,
  mimeType: string,
  audioSourceId: string,
): Promise<void> {
  const audio = requireAudioBytes(bytes);
  const mime = requireAudioMimeType(mimeType);
  const sourceId = normalizeVoiceText(audioSourceId);
  if (!sourceId) {
    throw voicePlaybackError(
      'runtime-voice-audio-source-id-missing',
      'inspect_runtime_voice_stream_truth',
    );
  }
  const pipeline = getSharedAudioPipelineController();
  let unsubscribe = () => {};
  const completion = new Promise<void>((resolve, reject) => {
    unsubscribe = pipeline.subscribe((snapshot) => {
      if (snapshot.audioArtifactId !== sourceId) return;
      if (snapshot.state === 'completed') resolve();
      if (snapshot.state === 'failed' || snapshot.state === 'interrupted') {
        reject(voicePlaybackError(
          `runtime-voice-audio-${snapshot.reason || snapshot.state}`,
          'inspect_runtime_voice_audio_playback',
        ));
      }
    });
  });
  try {
    await pipeline.playBytes({ audioSourceId: sourceId, audioMimeType: mime, bytes: audio });
    await completion;
  } finally {
    unsubscribe();
  }
}

function voicePlaybackProjection(input: ZhiyuVoicePlaybackProjection): ZhiyuVoicePlaybackProjection {
  return input;
}

function voicePlaybackViolation(input: Omit<ZhiyuVoicePlaybackProjection, 'state' | 'playbackAction' | 'violation'>): ZhiyuVoicePlaybackProjection {
  return {
    ...input,
    state: 'failed',
    playbackAction: 'none',
    violation: true,
  };
}

function isRuntimeVoicePlaybackState(value: string): value is Exclude<ZhiyuVoicePlaybackState, 'idle' | 'text_only'> {
  return value === 'active'
    || value === 'completed'
    || value === 'failed'
    || value === 'interrupted'
    || value === 'canceled';
}

function requireAudioMimeType(value: unknown): string {
  const mimeType = normalizeVoiceText(value);
  if (!mimeType.toLowerCase().startsWith('audio/')) {
    throw Object.assign(new Error('Runtime voice bytes must carry audio/* MIME type.'), {
      reasonCode: 'runtime-voice-audio-mime-invalid',
      actionHint: 'inspect_runtime_voice_artifact_mime',
      source: 'runtime',
    });
  }
  return mimeType;
}

function requireAudioBytes(value: unknown): Uint8Array {
  const bytes = byteArray(value);
  if (bytes.byteLength === 0) {
    throw Object.assign(new Error('Runtime voice bytes are empty.'), {
      reasonCode: 'runtime-voice-audio-bytes-empty',
      actionHint: 'inspect_runtime_voice_artifact_bytes',
      source: 'runtime',
    });
  }
  return bytes;
}

function byteArray(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) {
    return Uint8Array.from(value.filter((item): item is number => Number.isInteger(item) && item >= 0 && item <= 255));
  }
  return new Uint8Array();
}

function normalizeVoiceText(value: unknown): string {
  return String(value ?? '').trim();
}
