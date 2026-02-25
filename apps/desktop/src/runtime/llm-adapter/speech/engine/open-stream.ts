import type { ProviderType } from '../../types';
import { createSpeechAdapter } from '../index';
import { SpeechStreamRuntime } from '../stream-runtime';
import type {
  SpeechStreamOpenRequest,
  SpeechStreamOpenResult,
  SpeechSynthesizeRequest,
  SpeechSynthesizeResult,
} from '../types';
import { openStreamFromSynthesizedAudio } from './stream-fallback';
import {
  buildStreamId,
  isSupportedSpeechProvider,
  isStreamUnsupportedError,
  withV1Endpoint,
} from './shared';

function resolveEndpointForProvider(providerType: ProviderType, endpoint: string): string {
  if (providerType === 'DASHSCOPE_COMPATIBLE' || providerType === 'VOLCENGINE_COMPATIBLE') {
    return endpoint;
  }
  return withV1Endpoint(endpoint);
}

export async function openSpeechStream(input: {
  providerType: ProviderType;
  endpoint: string;
  apiKey?: string;
  request: SpeechSynthesizeRequest;
  open: SpeechStreamOpenRequest;
  streamRuntime: SpeechStreamRuntime;
  synthesize: () => Promise<SpeechSynthesizeResult>;
  fetchImpl?: typeof fetch;
}): Promise<SpeechStreamOpenResult> {
  if (!isSupportedSpeechProvider(input.providerType)) {
    throw new Error(`SPEECH_STREAM_UNSUPPORTED: provider type ${input.providerType} is not supported`);
  }

  const streamId = buildStreamId();
  const eventTopic = `speech.stream.${streamId}`;
  const adapter = createSpeechAdapter(input.providerType, {
    name: String(input.providerType || '').toLowerCase(),
    endpoint: resolveEndpointForProvider(input.providerType, input.endpoint),
    headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : undefined,
    fetch: input.fetchImpl,
  });

  if (typeof adapter.stream === 'function') {
    try {
      const native = await adapter.stream(input.request);
      const sampleRateHz = native.sampleRateHz || input.open.sampleRateHz || 24000;
      const channels = native.channels || 1;
      void input.streamRuntime.startFromChunks({
        streamId,
        eventTopic,
        format: native.format,
        sampleRateHz,
        channels,
        chunks: native.chunks,
        chunkDurationMs: 100,
        providerTraceId: native.providerTraceId,
      });
      return {
        streamId,
        eventTopic,
        format: native.format,
        sampleRateHz,
        channels,
        providerTraceId: native.providerTraceId,
      };
    } catch (error) {
      if (!isStreamUnsupportedError(error)) {
        throw error;
      }
    }
  }

  const synthesized = await input.synthesize();
  return openStreamFromSynthesizedAudio({
    streamRuntime: input.streamRuntime,
    streamId,
    eventTopic,
    open: input.open,
    synthesized,
  });
}
