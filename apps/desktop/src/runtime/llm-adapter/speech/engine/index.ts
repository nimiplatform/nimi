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

type RuntimeClientLike = ReturnType<typeof getRuntimeClient>;
type RuntimeClientResolver = () => RuntimeClientLike;
type MetadataBuilder = typeof buildRuntimeRequestMetadata;

export type ListVoicesInput = {
  providerId?: string;
  model?: string;
  routeSource?: 'local-runtime' | 'token-api';
  connectorId?: string;
  providerEndpoint?: string;
};

function ensureRouteSpeechModelId(model: string, routeSource: 'local-runtime' | 'token-api'): string {
  const normalized = String(model || '').trim();
  if (!normalized) return normalized;
  if (routeSource !== 'token-api') return normalized;

  const lower = normalized.toLowerCase();
  if (lower.startsWith('cloud/')) return normalized;
  if (lower.startsWith('local/')) return `cloud/${normalized.slice('local/'.length).trim() || 'default'}`;
  if (lower.startsWith('token/')) return `cloud/${normalized.slice('token/'.length).trim() || 'default'}`;
  return `cloud/${normalized}`;
}

export class NimiSpeechEngine {
  private readonly streamRuntime?: SpeechStreamRuntime;
  private fetchImpl?: typeof fetch;
  private readonly resolveRuntimeClient: RuntimeClientResolver;
  private readonly buildMetadata: MetadataBuilder;

  constructor(input?: {
    publish?: StreamPublisher;
    getRuntimeClient?: RuntimeClientResolver;
    buildRuntimeRequestMetadata?: MetadataBuilder;
  }) {
    this.streamRuntime = input?.publish
      ? new SpeechStreamRuntime({
        publish: async (topic, event) => input.publish?.(topic, event as unknown as Record<string, unknown>) ?? Promise.resolve(),
      })
      : undefined;
    this.resolveRuntimeClient = input?.getRuntimeClient || getRuntimeClient;
    this.buildMetadata = input?.buildRuntimeRequestMetadata || buildRuntimeRequestMetadata;
  }

  setFetchImpl(fn: typeof fetch): void {
    this.fetchImpl = fn;
  }

  listProviders(): SpeechProviderDescriptor[] {
    return [];
  }

  async listVoices(input?: ListVoicesInput): Promise<SpeechVoiceDescriptor[]> {
    if (!input?.model) return [];
    const routeSource = input.routeSource === 'local-runtime' ? 'local-runtime' : 'token-api';
    const model = ensureRouteSpeechModelId(input.model, routeSource);
    const runtime = this.resolveRuntimeClient();
    const metadata = await this.buildMetadata({
      source: routeSource,
      connectorId: input.connectorId,
      providerEndpoint: input.providerEndpoint,
    });
    const result = await runtime.media.tts.listVoices({
      model,
      route: routeSource,
      fallback: 'deny',
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
