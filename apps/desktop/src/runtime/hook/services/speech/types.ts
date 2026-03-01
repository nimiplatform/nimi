import type { ProviderType } from '../../../llm-adapter/types';
import type { NimiSpeechEngine } from '../../../llm-adapter/speech/engine/index.js';
import type { HookSourceType } from '../../contracts/types.js';
import { HookAuditTrail } from '../../audit/hook-audit.js';
import type { PermissionResolver } from '../utils.js';

export function inferProviderTypeFromPrefix(prefix: string): ProviderType {
  const low = String(prefix || '').trim().toLowerCase();
  if (low === 'dashscope-compatible' || low === 'dashscope') return 'DASHSCOPE_COMPATIBLE';
  if (low === 'volcengine-compatible' || low === 'volcengine') return 'VOLCENGINE_COMPATIBLE';
  if (
    low === 'openai-compatible'
    || low === 'openai'
    || low === 'localai'
    || low === 'localai-native'
    || low === 'nexa'
  ) {
    return 'OPENAI_COMPATIBLE';
  }
  return 'CLOUD_API';
}

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
  adapter: 'openai_compat_adapter' | 'localai_native_adapter' | string;
  providerType: ProviderType;
  endpoint: string;
  connectorId?: string;
  model: string;
};

function isAdapterToken(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'openai_compat_adapter' || normalized === 'localai_native_adapter';
}

function normalizeProviderNamespace(value: unknown, fallback = 'localai'): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'localai' || normalized === 'nexa') return normalized;
  return fallback;
}

export function normalizeSpeechAdapter(
  value: unknown,
): 'openai_compat_adapter' | 'localai_native_adapter' {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'localai_native_adapter' ? 'localai_native_adapter' : 'openai_compat_adapter';
}

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
  if (normalized.startsWith('local-runtime:')) {
    const parts = normalized.split(':').map((item) => item.trim()).filter(Boolean);
    const namespace = String(parts[1] || '').toLowerCase();
    if (namespace === 'nexa') return 'nexa';
    return 'localai';
  }
  return normalized;
}

export function normalizeLocalRuntimeProviderRef(input: {
  provider?: unknown;
  engine?: unknown;
  adapter?: unknown;
  model?: unknown;
}): string {
  const model = String(input.model || '').trim() || 'local-model';
  const adapter = normalizeSpeechAdapter(input.adapter);
  const fallbackNamespace = normalizeProviderNamespace(input.engine, 'localai');
  const rawProvider = String(input.provider || '').trim();
  if (!rawProvider) {
    return `local-runtime:${fallbackNamespace}:${adapter}:${model}`;
  }

  const parts = rawProvider.split(':').map((item) => item.trim()).filter(Boolean);
  if (parts.length === 0) {
    return `local-runtime:${fallbackNamespace}:${adapter}:${model}`;
  }
  const first = String(parts[0] || '').toLowerCase();
  if (first !== 'local-runtime') {
    return rawProvider;
  }

  const second = String(parts[1] || '').toLowerCase();
  const third = String(parts[2] || '').toLowerCase();
  if ((second === 'localai' || second === 'nexa') && isAdapterToken(third)) {
    const modelHint = parts.slice(3).join(':').trim() || model;
    return `local-runtime:${second}:${normalizeSpeechAdapter(third)}:${modelHint}`;
  }
  if (isAdapterToken(second)) {
    const modelHint = parts.slice(2).join(':').trim() || model;
    return `local-runtime:${fallbackNamespace}:${normalizeSpeechAdapter(second)}:${modelHint}`;
  }
  if (second === 'localai' || second === 'nexa') {
    const modelHint = parts.slice(2).join(':').trim() || model;
    return `local-runtime:${second}:${adapter}:${modelHint}`;
  }
  const modelHint = parts.slice(1).join(':').trim() || model;
  return `local-runtime:${fallbackNamespace}:${adapter}:${modelHint}`;
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
}

export interface SpeechSynthesizeResultPayload {
  audioUri: string;
  mimeType: string;
  durationMs?: number;
  sampleRateHz?: number;
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
