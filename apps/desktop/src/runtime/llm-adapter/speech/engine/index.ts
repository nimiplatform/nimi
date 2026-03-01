import { SpeechStreamRuntime } from '../stream-runtime';
import type {
  SpeechStreamControlAction,
  SpeechStreamOpenResult,
  SpeechSynthesizeRequest,
  SpeechVoiceDescriptor,
  SpeechProviderDescriptor,
} from '../types';
import { openSpeechStream } from './open-stream';

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
  providerType: string;
  endpoint: string;
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

  async listVoices(_input?: ListVoicesInput): Promise<SpeechVoiceDescriptor[]> {
    return [];
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
