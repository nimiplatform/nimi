import type { ProviderType } from '../types';

export type SpeechFormat = 'mp3' | 'wav' | 'opus' | 'pcm';

export type SpeechSynthesizeRequest = {
  model: string;
  text: string;
  voice?: string;
  format?: SpeechFormat;
  speed?: number;
  sampleRateHz?: number;
  providerParams?: Record<string, unknown>;
};

export type SpeechSynthesizeResult = {
  audioUri: string;
  format: SpeechFormat;
  mimeType: string;
  durationMs?: number;
  sampleRateHz?: number;
  raw?: unknown;
};

export type SpeechSynthesisRequest = SpeechSynthesizeRequest;
export type SpeechSynthesisResponse = SpeechSynthesizeResult;

export type SpeechNativeStreamResponse = {
  format: SpeechFormat;
  mimeType: string;
  sampleRateHz?: number;
  channels?: number;
  providerTraceId?: string;
  chunks: AsyncIterable<Uint8Array>;
};

export type SpeechProviderDescriptor = {
  id: string;
  name: string;
  status: 'available' | 'unavailable';
  capabilities?: string[];
  voiceCount?: number;
  ownerModId?: string;
};

export type SpeechVoiceDescriptor = {
  id: string;
  providerId: string;
  name: string;
  lang?: string;
  langs?: string[];
  sampleAudioUri?: string;
};

export type SpeechHealthResult = {
  status: 'healthy' | 'unreachable' | 'unsupported';
  detail: string;
  checkedAt: string;
  latencyMs?: number;
};

export type SpeechAdapterConfig = {
  name: string;
  endpoint: string;
  headers?: Record<string, string>;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  transformRequest?: (params: Record<string, unknown>) => Record<string, unknown>;
};

export interface SpeechAdapter {
  readonly type: ProviderType;
  readonly config: SpeechAdapterConfig;
  synthesize(request: SpeechSynthesizeRequest): Promise<SpeechSynthesizeResult>;
  stream?(request: SpeechSynthesizeRequest): Promise<SpeechNativeStreamResponse>;
  healthCheck(model?: string): Promise<SpeechHealthResult>;
}

export type SpeechStreamOpenRequest = {
  providerType: ProviderType;
  endpoint: string;
  apiKey?: string;
  model: string;
  text: string;
  voice?: string;
  format?: SpeechFormat;
  speed?: number;
  sampleRateHz?: number;
};

export type SpeechStreamOpenResult = {
  streamId: string;
  eventTopic: string;
  format: SpeechFormat;
  sampleRateHz: number;
  channels: number;
  providerTraceId?: string;
};

export type SpeechStreamControlAction = 'pause' | 'resume' | 'cancel';

export type SpeechStreamEvent =
  | {
      type: 'start';
      streamId: string;
      format: SpeechFormat;
      sampleRateHz: number;
      channels: number;
      providerTraceId?: string;
    }
  | {
      type: 'chunk';
      streamId: string;
      seq: number;
      audioBase64: string;
      durationMs: number;
      textOffsetStart?: number;
      textOffsetEnd?: number;
    }
  | {
      type: 'mark';
      streamId: string;
      markId: string;
      textOffsetStart: number;
      textOffsetEnd: number;
    }
  | {
      type: 'end';
      streamId: string;
      totalChunks: number;
      durationMs: number;
    }
  | {
      type: 'error';
      streamId: string;
      errorCode: string;
      message: string;
      retryable: boolean;
    };
