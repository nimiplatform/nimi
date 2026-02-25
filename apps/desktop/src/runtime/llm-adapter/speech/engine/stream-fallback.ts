import { SpeechStreamRuntime } from '../stream-runtime';
import type { SpeechStreamOpenRequest, SpeechStreamOpenResult, SpeechSynthesizeResult } from '../types';

export async function openStreamFromSynthesizedAudio(input: {
  streamRuntime: SpeechStreamRuntime;
  streamId: string;
  eventTopic: string;
  open: SpeechStreamOpenRequest;
  synthesized: SpeechSynthesizeResult;
}): Promise<SpeechStreamOpenResult> {
  const response = await fetch(input.synthesized.audioUri);
  if (!response.ok) {
    throw new Error(`SPEECH_STREAM_PROTOCOL_ERROR: failed to load synthesized audio (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sampleRateHz = input.synthesized.sampleRateHz || input.open.sampleRateHz || 24000;
  void input.streamRuntime.start({
    streamId: input.streamId,
    eventTopic: input.eventTopic,
    format: input.synthesized.format,
    sampleRateHz,
    channels: 1,
    bytes,
    chunkSize: 12_000,
    chunkDurationMs: 100,
  });
  return {
    streamId: input.streamId,
    eventTopic: input.eventTopic,
    format: input.synthesized.format,
    sampleRateHz,
    channels: 1,
    providerTraceId: undefined,
  };
}
