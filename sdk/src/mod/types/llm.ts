export type RuntimeModality = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'music';

export type LocalEngine = 'localai' | 'nexa' | 'nimi_media' | 'sidecar' | string;

export type LocalProviderAdapter =
  | 'openai_compat_adapter'
  | 'localai_native_adapter'
  | 'nexa_native_adapter'
  | 'nimi_media_native_adapter'
  | 'localai_music_adapter'
  | 'sidecar_music_adapter'
  | string;

export type NexaProviderHints = {
  backend?: string;
  preferredAdapter?: LocalProviderAdapter;
  pluginId?: string;
  deviceId?: string;
  modelType?: string;
  npuMode?: string;
  policyGate?: string;
  hostNpuReady?: boolean;
  modelProbeHasNpuCandidate?: boolean;
  policyGateAllowsNpu?: boolean;
  npuUsable?: boolean;
  gateReason?: string;
  gateDetail?: string;
};

export type NimiMediaProviderHints = {
  preferredAdapter?: LocalProviderAdapter;
  driver?: string;
  family?: string;
};

export type LocalProviderHints = {
  localai?: {
    backend?: string;
    preferredAdapter?: LocalProviderAdapter;
    whisperVariant?: string;
    stablediffusionPipeline?: string;
    videoBackend?: string;
  };
  nexa?: NexaProviderHints;
  nimiMedia?: NimiMediaProviderHints;
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
