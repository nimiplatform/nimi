import type { NimiSpeechEngine } from '../../../llm-adapter/speech/engine/index.js';
import type { HookSourceType } from '../../contracts/types.js';
import { HookAuditTrail } from '../../audit/hook-audit.js';
import type { PermissionResolver } from '../utils.js';

export type RouteResolverResult = {
  source: 'local-runtime' | 'token-api';
  provider?: string;
  adapter?: 'openai_compat_adapter' | 'localai_native_adapter' | string;
  engine?: string;
  localProviderEndpoint: string;
  localOpenAiEndpoint: string;
  connectorId: string;
  model: string;
};

export type ResolvedRoute = {
  source: 'local-runtime' | 'token-api';
  provider: string;
  adapter: string;
  endpoint: string;
  connectorId?: string;
  model: string;
};

export function normalizeSpeechProviderId(value: unknown, fallback = 'openai-compatible'): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'auto') return fallback;
  if (normalized === 'localai' || normalized === 'localai-native') return 'localai';
  if (normalized === 'nexa') return 'nexa';
  if (
    normalized === 'openai-compatible'
    || normalized === 'dashscope-compatible'
    || normalized === 'volcengine-compatible'
    || normalized === 'openrouter'
  ) {
    return normalized;
  }
  if (normalized.startsWith('openrouter:')) {
    return 'openrouter';
  }
  return normalized;
}

export interface SpeechServiceInput {
  speechEngine: NimiSpeechEngine;
  audit: HookAuditTrail;
  evaluatePermission: PermissionResolver;
  resolveRoute: (input: {
    modId: string;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    connectorId?: string;
    model?: string;
  }) => Promise<RouteResolverResult>;
  ensureEventTopic: (topic: string) => void;
}

export interface SpeechProvidersResult {
  id: string;
  name: string;
  status: 'available' | 'unavailable';
  capabilities?: string[];
  voiceCount?: number;
  ownerModId?: string;
}

export interface SpeechVoicesResult {
  id: string;
  providerId: string;
  name: string;
  lang?: string;
  langs?: string[];
  sampleAudioUri?: string;
  modelResolved?: string;
  voiceCatalogSource?: string;
  voiceCatalogVersion?: string;
}

export interface SpeechSynthesizeResultPayload {
  audioUri: string;
  mimeType: string;
  durationMs?: number;
  sampleRateHz?: number;
  traceId: string;
  providerTraceId?: string;
  cacheKey?: string;
}

export type SpeechBasePermissionInput = {
  modId: string;
  sourceType?: HookSourceType;
};

export type SpeechProvidersInput = SpeechBasePermissionInput;

export type SpeechVoicesInput = SpeechBasePermissionInput & {
  providerId?: string;
  routeSource?: 'auto' | 'local-runtime' | 'token-api';
  connectorId?: string;
  model?: string;
};

export type SpeechSynthesizeInput = SpeechBasePermissionInput & {
  text: string;
  providerId?: string;
  routeSource?: 'auto' | 'local-runtime' | 'token-api';
  connectorId?: string;
  model?: string;
  voiceId: string;
  format?: 'mp3' | 'wav' | 'opus' | 'pcm';
  speakingRate?: number;
  pitch?: number;
  sampleRateHz?: number;
  language?: string;
  stylePrompt?: string;
  targetId?: string;
  sessionId?: string;
};

export type SpeechStreamOpenInput = SpeechBasePermissionInput & {
  text: string;
  providerId?: string;
  routeSource?: 'auto' | 'local-runtime' | 'token-api';
  connectorId?: string;
  model?: string;
  voiceId: string;
  format?: 'mp3' | 'wav' | 'opus' | 'pcm';
  sampleRateHz?: number;
  language?: string;
  stylePrompt?: string;
  targetId?: string;
  sessionId?: string;
};

export type SpeechStreamControlInput = SpeechBasePermissionInput & {
  streamId: string;
  action: 'pause' | 'resume' | 'cancel';
};

export type SpeechStreamCloseInput = SpeechBasePermissionInput & {
  streamId: string;
};
