import {
  CAPABILITIES_V11,
  DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
  createConnectorV11,
  dedupeStringsV11,
  normalizeCapabilityV11,
  normalizeEndpointV11,
  type CapabilityV11,
  type RuntimeConfigStateV11,
  type SourceIdV11,
} from '../types';

export const RUNTIME_CONFIG_STORAGE_KEY_V11 = 'nimi.runtime.llm-config.v11';

export type RuntimeConfigSeedV11 = {
  provider: string;
  runtimeModelType: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId?: string;
};

export type StoredStateV11 = Partial<{
  version: number;
  initializedByV11: boolean;
  selectedSource: SourceIdV11;
  activeCapability: CapabilityV11;
  activeSection: 'setup';
  activeSetupPage: RuntimeConfigStateV11['activeSetupPage'];
  diagnosticsCollapsed: boolean;
  localRuntime: Partial<RuntimeConfigStateV11['localRuntime']>;
  connectors: Array<Partial<RuntimeConfigStateV11['connectors'][number]>>;
  selectedConnectorId: string;
  uiMode: 'simple' | 'advanced';
}>;

function parseSourceFromProvider(providerRef: string): SourceIdV11 {
  const normalized = String(providerRef || '').trim().toLowerCase();
  if (
    normalized.startsWith('openrouter')
    || normalized.startsWith('openai-compatible')
    || normalized.startsWith('openai')
    || normalized.startsWith('token-api')
  ) {
    return 'token-api';
  }
  return 'local-runtime';
}

function isAdapterToken(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'openai_compat_adapter' || normalized === 'localai_native_adapter';
}

function isProviderToken(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'localai' || normalized === 'nexa';
}

function parseModelHint(providerRef: string): string {
  const raw = String(providerRef || '').trim();
  if (!raw.includes(':')) return '';
  const parts = raw.split(':').map((item) => item.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const first = parts[0] || '';
  const second = parts[1] || '';
  const third = parts[2] || '';

  if (first.toLowerCase() === 'local-runtime') {
    if (parts.length >= 4 && isAdapterToken(third)) {
      return parts.slice(3).join(':').trim();
    }
    if (parts.length >= 3 && isAdapterToken(second)) {
      return parts.slice(2).join(':').trim();
    }
    if (parts.length >= 3 && isProviderToken(second)) {
      return parts.slice(2).join(':').trim();
    }
    return parts.slice(1).join(':').trim();
  }

  return parts.slice(1).join(':').trim();
}

export function createDefaultStateV11(seed: RuntimeConfigSeedV11): RuntimeConfigStateV11 {
  const sourceFromRuntime = parseSourceFromProvider(seed.provider);
  const modelHint = parseModelHint(seed.provider) || String(seed.localProviderModel || 'local-model');
  const preferTokenApi = sourceFromRuntime === 'token-api';

  const localRuntime = {
    endpoint: normalizeEndpointV11(
      seed.localProviderEndpoint || seed.localOpenAiEndpoint,
      DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
    ),
    models: [{
      localModelId: toLocalRuntimeModelIdV11(modelHint),
      engine: 'localai',
      model: modelHint,
      endpoint: normalizeEndpointV11(seed.localProviderEndpoint || seed.localOpenAiEndpoint, DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11),
      capabilities: [...CAPABILITIES_V11],
      status: 'installed' as const,
    }],
    nodeMatrix: CAPABILITIES_V11.map((capability) => ({
      nodeId: `${capability}.generate.localai`,
      capability,
      serviceId: 'localai-openai-gateway',
      provider: 'localai' as const,
      adapter: (capability === 'chat' || capability === 'embedding'
        ? 'openai_compat_adapter'
        : 'localai_native_adapter') as 'openai_compat_adapter' | 'localai_native_adapter',
      backend: capability === 'stt'
        ? 'whisper.cpp'
        : capability === 'image'
          ? 'stablediffusion.cpp'
          : undefined,
      backendSource: 'catalog',
      available: capability === 'chat' || capability === 'embedding',
      reasonCode: capability === 'chat' || capability === 'embedding'
        ? undefined
        : 'LOCAL_AI_CAPABILITY_MISSING',
    })),
    status: 'idle' as const,
    lastCheckedAt: null,
    lastDetail: '',
  };

  const connector = createConnectorV11('openrouter', 'Primary Connector');
  const seedOpenAiEndpoint = String(seed.localOpenAiEndpoint || '').trim();
  if (
    seedOpenAiEndpoint
    && (
      sourceFromRuntime === 'token-api'
      || /openrouter\.ai/i.test(seedOpenAiEndpoint)
    )
  ) {
    connector.endpoint = normalizeEndpointV11(seedOpenAiEndpoint, connector.endpoint);
  }
  return {
    version: 11,
    initializedByV11: false,
    activeSection: 'setup',
    activeSetupPage: 'overview',
    diagnosticsCollapsed: true,
    uiMode: 'simple',
    selectedSource: preferTokenApi ? 'token-api' : sourceFromRuntime,
    activeCapability: normalizeCapabilityV11(seed.runtimeModelType),
    localRuntime,
    connectors: [connector],
    selectedConnectorId: connector.id,
  };
}

export function toLocalRuntimeModelIdV11(model: string): string {
  const normalized = String(model || '').trim() || 'local-model';
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'default';
  return `local:${slug}`;
}

export function dedupeModelNamesV11(models: string[]): string[] {
  return dedupeStringsV11(models);
}
