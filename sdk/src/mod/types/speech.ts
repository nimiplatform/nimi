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
