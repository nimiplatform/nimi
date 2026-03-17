export type RuntimeModality = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'music';

export type LocalEngine = 'llama' | 'media' | 'sidecar' | string;

export type LocalProviderAdapter =
  | 'openai_compat_adapter'
  | 'llama_native_adapter'
  | 'media_native_adapter'
  | 'media_diffusers_adapter'
  | 'sidecar_music_adapter'
  | string;

export type LlamaProviderHints = {
  preferredAdapter?: LocalProviderAdapter;
  whisperVariant?: string;
};

export type MediaProviderHints = {
  preferredAdapter?: LocalProviderAdapter;
  driver?: string;
  family?: string;
  device?: string;
  policyGate?: string;
};

export type LocalProviderHints = {
  llama?: LlamaProviderHints;
  media?: MediaProviderHints;
  sidecar?: {
    preferredAdapter?: LocalProviderAdapter;
  };
  extra?: Record<string, unknown>;
} & Record<string, unknown>;

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
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  extra?: Record<string, unknown>;
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
