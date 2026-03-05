export type HookSpeechProviderDescriptor = {
  id: string;
  name: string;
  status: 'available' | 'unavailable';
  capabilities?: string[];
  voiceCount?: number;
  ownerModId?: string;
};

export type HookSpeechVoiceDescriptor = {
  id: string;
  providerId: string;
  name: string;
  lang?: string;
  langs?: string[];
  sampleAudioUri?: string;
  modelResolved?: string;
  voiceCatalogSource?: string;
  voiceCatalogVersion?: string;
};

export type HookSpeechSynthesizeResult = {
  audioUri: string;
  mimeType: string;
  durationMs?: number;
  sampleRateHz?: number;
  traceId: string;
  providerTraceId?: string;
  cacheKey?: string;
};

export type HookSpeechStreamOpenResult = {
  streamId: string;
  eventTopic: string;
  format: 'mp3' | 'wav' | 'opus' | 'pcm';
  sampleRateHz: number;
  channels: number;
  providerTraceId?: string;
};
