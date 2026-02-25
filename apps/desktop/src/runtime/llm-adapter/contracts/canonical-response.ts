import type { SpeechFormat } from '../speech/types';

export type CanonicalSpeechResponse = {
  audioUri: string;
  format: SpeechFormat;
  mimeType: string;
  durationMs?: number;
  sampleRateHz?: number;
  providerTraceId?: string;
  raw?: unknown;
};
