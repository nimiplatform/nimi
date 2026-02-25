import { buildChunkEvent, chunkAudioBytes } from './stream-protocol';
import type {
  SpeechFormat,
  SpeechStreamControlAction,
  SpeechStreamEvent,
} from './types';

type StreamRuntimeState = {
  streamId: string;
  eventTopic: string;
  paused: boolean;
  cancelled: boolean;
};

type StreamPublisher = (topic: string, event: SpeechStreamEvent) => Promise<void>;

type StartStreamInput = {
  streamId: string;
  eventTopic: string;
  format: SpeechFormat;
  sampleRateHz: number;
  channels: number;
  bytes: Uint8Array;
  chunkSize: number;
  chunkDurationMs: number;
};

type StartStreamFromChunksInput = {
  streamId: string;
  eventTopic: string;
  format: SpeechFormat;
  sampleRateHz: number;
  channels: number;
  chunks: AsyncIterable<Uint8Array>;
  chunkDurationMs: number;
  providerTraceId?: string;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SpeechStreamRuntime {
  private readonly states = new Map<string, StreamRuntimeState>();
  private readonly publish: StreamPublisher;

  constructor(input: { publish: StreamPublisher }) {
    this.publish = input.publish;
  }

  async start(input: StartStreamInput): Promise<void> {
    const chunks = chunkAudioBytes(input.bytes, input.chunkSize);
    async function* toAsyncChunks(): AsyncIterable<Uint8Array> {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
    await this.startFromChunks({
      streamId: input.streamId,
      eventTopic: input.eventTopic,
      format: input.format,
      sampleRateHz: input.sampleRateHz,
      channels: input.channels,
      chunks: toAsyncChunks(),
      chunkDurationMs: input.chunkDurationMs,
    });
  }

  async startFromChunks(input: StartStreamFromChunksInput): Promise<void> {
    const state: StreamRuntimeState = {
      streamId: input.streamId,
      eventTopic: input.eventTopic,
      paused: false,
      cancelled: false,
    };
    this.states.set(input.streamId, state);
    const startedAt = Date.now();
    let emittedChunks = 0;
    try {
      await this.publish(input.eventTopic, {
        type: 'start',
        streamId: input.streamId,
        format: input.format,
        sampleRateHz: input.sampleRateHz,
        channels: input.channels,
        providerTraceId: input.providerTraceId,
      });
      for await (const chunk of input.chunks) {
        const latest = this.states.get(input.streamId);
        if (!latest || latest.cancelled) {
          return;
        }
        while (latest.paused && !latest.cancelled) {
          await wait(20);
        }
        if (latest.cancelled) {
          return;
        }
        if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) {
          continue;
        }
        emittedChunks += 1;
        await this.publish(input.eventTopic, buildChunkEvent({
          streamId: input.streamId,
          seq: emittedChunks,
          bytes: chunk,
          durationMs: input.chunkDurationMs,
        }));
      }
      await this.publish(input.eventTopic, {
        type: 'end',
        streamId: input.streamId,
        totalChunks: emittedChunks,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const latest = this.states.get(input.streamId);
      if (latest && !latest.cancelled) {
        await this.publish(input.eventTopic, {
          type: 'error',
          streamId: input.streamId,
          errorCode: 'SPEECH_STREAM_PROTOCOL_ERROR',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        });
      }
    } finally {
      this.states.delete(input.streamId);
    }
  }

  control(streamId: string, action: SpeechStreamControlAction): { ok: boolean } {
    const state = this.states.get(streamId);
    if (!state) return { ok: false };
    if (action === 'cancel') {
      state.cancelled = true;
      state.paused = false;
      this.states.delete(streamId);
      return { ok: true };
    }
    if (action === 'pause') {
      state.paused = true;
      return { ok: true };
    }
    state.paused = false;
    return { ok: true };
  }

  close(streamId: string): { ok: boolean } {
    const state = this.states.get(streamId);
    if (!state) return { ok: false };
    state.cancelled = true;
    this.states.delete(streamId);
    return { ok: true };
  }
}
