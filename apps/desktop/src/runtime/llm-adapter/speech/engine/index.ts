import type { ProviderType } from '../../types';
import { SpeechAssetStore } from '../asset-store';
import { SpeechStreamRuntime } from '../stream-runtime';
import type {
  SpeechProviderDescriptor,
  SpeechStreamControlAction,
  SpeechStreamOpenResult,
  SpeechSynthesizeRequest,
  SpeechSynthesizeResult,
  SpeechVoiceDescriptor,
} from '../types';
import { listSpeechProviders } from './list-providers';
import { listSpeechVoices, type ListVoicesInput } from './list-voices';
import { synthesizeSpeech } from './synthesize';
import { openSpeechStream } from './open-stream';

type StreamPublisher = (
  topic: string,
  payload: Record<string, unknown>,
) => Promise<void>;

type SynthesizeInput = {
  providerType: ProviderType;
  endpoint: string;
  apiKey?: string;
  request: SpeechSynthesizeRequest;
};

type OpenStreamInput = {
  model: string;
  routeSource: 'local-runtime' | 'token-api';
  credentialRefId?: string;
  providerEndpoint?: string;
  request: SpeechSynthesizeRequest;
  open: {
    format?: 'mp3' | 'wav' | 'opus' | 'pcm';
    sampleRateHz?: number;
  };
  providerType: ProviderType;
  endpoint: string;
  apiKey?: string;
};

export class NimiSpeechEngine {
  private readonly streamRuntime?: SpeechStreamRuntime;
  private readonly assetStore = new SpeechAssetStore();
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
    return listSpeechProviders();
  }

  async listVoices(input?: ListVoicesInput): Promise<SpeechVoiceDescriptor[]> {
    return listSpeechVoices(input);
  }

  async synthesize(input: SynthesizeInput): Promise<SpeechSynthesizeResult> {
    return synthesizeSpeech({
      providerType: input.providerType,
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      request: input.request,
      assetStore: this.assetStore,
      fetchImpl: this.fetchImpl,
    });
  }

  async openStream(input: OpenStreamInput): Promise<SpeechStreamOpenResult> {
    if (!this.streamRuntime) {
      throw new Error('SPEECH_STREAM_UNSUPPORTED: speech stream publisher unavailable');
    }
    return openSpeechStream({
      model: input.model,
      routeSource: input.routeSource,
      credentialRefId: input.credentialRefId,
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
