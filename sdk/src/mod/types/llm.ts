import type { JsonObject } from '../../internal/utils.js';
export type RuntimeModality = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'music';

export type LocalEngine = 'llama' | 'media' | 'speech' | 'sidecar' | string;

export type LocalProviderAdapter =
  | 'openai_compat_adapter'
  | 'llama_native_adapter'
  | 'media_native_adapter'
  | 'speech_native_adapter'
  | 'sidecar_music_adapter'
  | string;

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
  actionHint?: 'none' | 'install-local-model' | 'switch-to-cloud' | 'verify-connector' | 'retry';
};

export type HookLlmTextStreamEvent =
  | {
      type: 'text_delta';
      textDelta: string;
    }
  | {
      type: 'done';
    };
