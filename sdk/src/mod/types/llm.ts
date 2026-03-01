export type RuntimeModality = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding';

export type RuntimeRouteHint =
  | 'chat/default'
  | 'chat/coarse'
  | 'chat/fine'
  | 'chat/retry-low-temp'
  | 'image/default'
  | 'video/default'
  | 'tts/default'
  | 'stt/default'
  | 'embedding/default'
  | string;

export type LocalRuntimeEngine = 'localai' | 'nexa' | string;

export type LocalAiProviderAdapter = 'openai_compat_adapter' | 'localai_native_adapter' | string;

export type NexaProviderHints = {
  backend?: string;
  preferredAdapter?: LocalAiProviderAdapter;
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

export type LocalAiProviderHints = {
  localai?: {
    backend?: string;
    preferredAdapter?: LocalAiProviderAdapter;
    whisperVariant?: string;
    stablediffusionPipeline?: string;
    videoBackend?: string;
  };
  nexa?: NexaProviderHints;
} & Record<string, unknown>;

export type LocalRuntimeRouteBinding = {
  source: 'local-runtime';
  runtimeModelType: RuntimeModality;
  provider: string;
  adapter?: LocalAiProviderAdapter;
  providerHints?: LocalAiProviderHints;
  localModelId: string;
  engine: LocalRuntimeEngine;
  model: string;
  endpoint: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId: '';
};

export type TokenApiRouteBinding = {
  source: 'token-api';
  runtimeModelType: RuntimeModality;
  provider: string;
  adapter?: LocalAiProviderAdapter;
  providerHints?: LocalAiProviderHints;
  connectorId: string;
  model: string;
  endpoint: string;
  localOpenAiEndpoint: string;
};

export type ResolvedRuntimeRouteBinding = LocalRuntimeRouteBinding | TokenApiRouteBinding;

export type RuntimeRouteOverride = {
  source?: 'local-runtime' | 'token-api';
  connectorId?: string;
  model?: string;
  localModelId?: string;
  engine?: LocalRuntimeEngine;
};

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
  actionHint?: 'none' | 'install-local-model' | 'switch-to-token-api' | 'verify-connector' | 'retry';
};

export type HookLlmTextStreamEvent =
  | {
      type: 'text_delta';
      textDelta: string;
    }
  | {
      type: 'done';
    };
