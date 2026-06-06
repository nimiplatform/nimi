import type { JsonObject } from '../internal/utils.js';
export type RuntimeModality = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'music';

export type LocalEngine = 'llama' | 'media' | 'speech' | 'sidecar' | string;

export const LOCAL_PROVIDER_ADAPTER_IDS = [
  'openai_compat_adapter',
  'llama_native_adapter',
  'media_native_adapter',
  'speech_native_adapter',
  'sidecar_music_adapter',
] as const;

export type LocalProviderAdapterId = (typeof LOCAL_PROVIDER_ADAPTER_IDS)[number];
export type LocalProviderAdapter = LocalProviderAdapterId | string;

export const DEFAULT_LOCAL_PROVIDER_ADAPTER_ID: LocalProviderAdapterId = 'openai_compat_adapter';

export function isLocalProviderAdapterId(value: unknown): value is LocalProviderAdapterId {
  return LOCAL_PROVIDER_ADAPTER_IDS.includes(value as LocalProviderAdapterId);
}

export function normalizeLocalProviderAdapterId(
  value: unknown,
  fallback?: LocalProviderAdapterId,
): LocalProviderAdapterId | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  return isLocalProviderAdapterId(normalized) ? normalized : fallback;
}

export type LlamaProviderHints = {
  preferredAdapter?: LocalProviderAdapter;
  backend?: string;
  multimodalProjector?: string;
};

export type MediaProviderHints = {
  preferredAdapter?: LocalProviderAdapter;
  backend?: string;
  driver?: string;
  family?: string;
  device?: string;
  fallbackDriver?: string;
  fallbackReason?: string;
  policyGate?: string;
};

export type SpeechProviderHints = {
  preferredAdapter?: LocalProviderAdapter;
  backend?: string;
  family?: string;
  driver?: string;
  device?: string;
  voiceWorkflowDriver?: string;
  policyGate?: string;
};

export type LocalProviderHints = {
  llama?: LlamaProviderHints;
  media?: MediaProviderHints;
  speech?: SpeechProviderHints;
  sidecar?: {
    preferredAdapter?: LocalProviderAdapter;
    backend?: string;
  };
  extra?: JsonObject;
} & JsonObject;

export type LocalRouteBinding = {
  source: 'local';
  runtimeModelType: RuntimeModality;
  provider: string;
  adapter?: LocalProviderAdapter;
  providerHints?: LocalProviderHints;
  modelId?: string;
  localModelId: string;
  engine: LocalEngine;
  model: string;
  endpoint?: string;
  localProviderEndpoint?: string;
  localProviderModel: string;
  localOpenAiEndpoint?: string;
  goRuntimeLocalModelId?: string;
  goRuntimeStatus?: 'installed' | 'active' | 'unhealthy' | 'removed' | string;
  connectorId: '';
};

export type CloudRouteBinding = {
  source: 'cloud';
  runtimeModelType: RuntimeModality;
  provider: string;
  adapter?: LocalProviderAdapter;
  providerHints?: LocalProviderHints;
  connectorId: string;
  modelId?: string;
  model: string;
  endpoint?: string;
  localOpenAiEndpoint?: string;
};

export type ResolvedRuntimeRouteBinding = LocalRouteBinding | CloudRouteBinding;

export type RuntimeLlmHealthInput = {
  provider?: string;
  capability?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  extra?: JsonObject;
};

export type RuntimeLlmHealthResult = {
  healthy?: boolean;
  status?: 'healthy' | 'degraded' | 'unavailable' | string;
  detail?: string;
  retryAfterMs?: number;
  [key: string]: unknown;
};

export type RuntimeRouteHealthResult = RuntimeLlmHealthResult & {
  provider?: string;
  reasonCode?: string;
  actionHint?: string;
};

export type HookLlmTextStreamEvent =
  | {
      type: 'text_delta';
      textDelta: string;
    }
  | {
      type: 'done';
    };
