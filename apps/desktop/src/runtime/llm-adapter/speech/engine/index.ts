import { SpeechStreamRuntime } from '../stream-runtime';
import type {
  SpeechStreamControlAction,
  SpeechStreamOpenResult,
  SpeechSynthesizeRequest,
  SpeechVoiceDescriptor,
  SpeechProviderDescriptor,
} from '../types';
import { openSpeechStream } from './open-stream';
import { getRuntimeClient, buildRuntimeRequestMetadata } from '../../execution/runtime-ai-bridge';

type StreamPublisher = (
  topic: string,
  payload: Record<string, unknown>,
) => Promise<void>;

type OpenStreamInput = {
  model: string;
  routeSource: 'local-runtime' | 'token-api';
  connectorId?: string;
  providerEndpoint?: string;
  request: SpeechSynthesizeRequest;
  open: {
    format?: 'mp3' | 'wav' | 'opus' | 'pcm';
    sampleRateHz?: number;
  };
};

export type ListVoicesInput = {
  providerId?: string;
  model?: string;
  routeSource?: 'local-runtime' | 'token-api';
  connectorId?: string;
  providerEndpoint?: string;
};

export class NimiSpeechEngine {
  private readonly streamRuntime?: SpeechStreamRuntime;
  private fetchImpl?: typeof fetch;

  constructor(input?: { publish?: StreamPublisher }) {
    this.streamRuntime = input?.publish
      ? new SpeechStreamRuntime({
        publish: async (topic, event) => input.publish?.(topic, event as unknown as Record<string, unknown>) ?? Promise.resolve(),
      })
      : undefined;
  }

  setFetchImpl(fn: typeof fetch): void {
    this.fetchImpl = fn;
  }

  listProviders(): SpeechProviderDescriptor[] {
    return [];
  }

  async listVoices(input?: ListVoicesInput): Promise<SpeechVoiceDescriptor[]> {
    if (!input?.model) return [];
    const runtime = getRuntimeClient();
    const metadata = await buildRuntimeRequestMetadata({
      source: input.routeSource || 'token-api',
      connectorId: input.connectorId,
      providerEndpoint: input.providerEndpoint,
    });
    const result = await runtime.media.tts.listVoices({
      model: input.model,
      connectorId: input.connectorId,
      metadata,
    });
    return result.voices.map(v => ({
      id: v.voiceId,
      providerId: input.providerId || 'openai-compatible',
      name: v.name,
      lang: v.lang,
      langs: v.supportedLangs,
    }));
  }

  async openStream(input: OpenStreamInput): Promise<SpeechStreamOpenResult> {
    if (!this.streamRuntime) {
      throw new Error('SPEECH_STREAM_UNSUPPORTED: speech stream publisher unavailable');
    }
    return openSpeechStream({
      model: input.model,
      routeSource: input.routeSource,
      connectorId: input.connectorId,
      providerEndpoint: input.providerEndpoint,
      request: input.request,
      streamRuntime: this.streamRuntime,
      open: input.open,
    });
  }

  controlStream(streamId: string, action: SpeechStreamControlAction): { ok: boolean } {
    if (!this.streamRuntime) return { ok: false };
    return this.streamRuntime.control(streamId, action);
  }

  closeStream(streamId: string): { ok: boolean } {
    if (!this.streamRuntime) return { ok: false };
    return this.streamRuntime.close(streamId);
  }
}
