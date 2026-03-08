import {
  buildRuntimeRequestMetadata,
  getRuntimeClient,
} from '../../execution/runtime-ai-bridge';
import { SpeechStreamRuntime } from '../stream-runtime';
import type {
  SpeechStreamOpenResult,
  SpeechSynthesizeRequest,
} from '../types';

function buildStreamId(): string {
  return `stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function openSpeechStream(input: {
  model: string;
  routeSource: 'local' | 'cloud';
  connectorId?: string;
  providerEndpoint?: string;
  request: SpeechSynthesizeRequest;
  streamRuntime: SpeechStreamRuntime;
  open: {
    format?: 'mp3' | 'wav' | 'opus' | 'pcm';
    sampleRateHz?: number;
  };
}): Promise<SpeechStreamOpenResult> {
  const streamId = buildStreamId();
  const eventTopic = `speech.stream.${streamId}`;

  try {
    const runtime = getRuntimeClient();
    const metadata = await buildRuntimeRequestMetadata({
      source: input.routeSource,
      connectorId: input.connectorId,
      providerEndpoint: input.providerEndpoint,
    });

    const stream = await runtime.media.tts.stream({
      model: input.model,
      text: input.request.text,
      voice: input.request.voice,
      audioFormat: input.request.format,
      sampleRateHz: input.request.sampleRateHz,
      route: input.routeSource,
      fallback: 'deny',
      connectorId: input.connectorId,
      metadata,
      extensions: input.request.providerParams,
    });

    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      for await (const chunk of stream) {
        if (chunk.chunk && chunk.chunk.byteLength > 0) {
          yield chunk.chunk;
        }
      }
    })();

    const format = (input.open.format || input.request.format || 'mp3') as 'mp3' | 'wav' | 'opus' | 'pcm';
    const sampleRateHz = input.open.sampleRateHz || input.request.sampleRateHz || 24000;

    void input.streamRuntime.startFromChunks({
      streamId,
      eventTopic,
      format,
      sampleRateHz,
      channels: 1,
      chunks,
      chunkDurationMs: 100,
    });

    return {
      streamId,
      eventTopic,
      format,
      sampleRateHz,
      channels: 1,
    };
  } catch (error) {
    throw error;
  }
}
