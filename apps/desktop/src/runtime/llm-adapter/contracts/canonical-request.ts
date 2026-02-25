import type { SpeechFormat } from '../speech/types';

export type CanonicalSpeechRequest = {
  model: string;
  text: string;
  voice?: string;
  format?: SpeechFormat;
  speed?: number;
  sampleRateHz?: number;
  language?: string;
  pitch?: number;
  stylePrompt?: string;
  providerParams?: Record<string, unknown>;
};
