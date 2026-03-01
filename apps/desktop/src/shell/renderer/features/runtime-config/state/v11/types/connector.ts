import { OPENROUTER_AUDIO_CHAT_MODELS } from '@nimiplatform/sdk/mod/model-options';
import type { ApiVendor, CapabilityV11, ProviderStatusV11 } from './modality';
import { normalizeStatusV11, normalizeVendorV11 } from './modality';

export type LocalRuntimeModelOptionV11 = {
  localModelId: string;
  engine: 'localai' | 'nexa' | string;
  model: string;
  endpoint: string;
  capabilities: CapabilityV11[];
  status: 'installed' | 'active' | 'unhealthy' | 'removed';
  hash?: string;
  installedAt?: string;
  updatedAt?: string;
};

export type NodeCapabilityV11 = CapabilityV11 | 'rerank' | 'cv' | 'diarize';

export type LocalRuntimeProviderHintsV11 = {
  localai?: {
    backend?: string;
    preferredAdapter?: 'openai_compat_adapter' | 'localai_native_adapter' | string;
    whisperVariant?: string;
    stablediffusionPipeline?: string;
    videoBackend?: string;
  };
  nexa?: {
    backend?: string;
    preferredAdapter?: 'openai_compat_adapter' | 'localai_native_adapter' | string;
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
} & Record<string, unknown>;

export type LocalRuntimeNodeMatrixEntryV11 = {
  nodeId: string;
  capability: NodeCapabilityV11;
  serviceId: string;
  provider: 'localai' | 'nexa' | string;
  adapter: 'openai_compat_adapter' | 'localai_native_adapter';
  backend?: string;
  backendSource?: string;
  available: boolean;
  reasonCode?: string;
  policyGate?: string;
  providerHints?: LocalRuntimeProviderHintsV11;
};

export type LocalRuntimeStateV11 = {
  endpoint: string;
  models: LocalRuntimeModelOptionV11[];
  nodeMatrix: LocalRuntimeNodeMatrixEntryV11[];
  status: ProviderStatusV11;
  lastCheckedAt: string | null;
  lastDetail: string;
};

export type ApiConnector = {
  id: string;
  label: string;
  vendor: ApiVendor;
  provider: string;
  endpoint: string;
  hasCredential: boolean;
  isSystemOwned: boolean;
  models: string[];
  status: ProviderStatusV11;
  lastCheckedAt: string | null;
  lastDetail: string;
};

export const DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11 = 'http://127.0.0.1:1234/v1';
export const DEFAULT_OPENAI_ENDPOINT_V11 = 'http://127.0.0.1:1234/v1';
export const DEFAULT_OPENROUTER_ENDPOINT_V11 = 'https://openrouter.ai/api/v1';

export type VendorCatalogV11 = {
  label: string;
  defaultEndpoint: string;
  version: string;
  updatedAt: string;
  models: string[];
};

export const OPENROUTER_AUDIO_CHAT_MODELS_V11 = [...OPENROUTER_AUDIO_CHAT_MODELS] as const;

export const VENDOR_CATALOGS_V11: Record<ApiVendor, VendorCatalogV11> = {
  gpt: {
    label: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1',
    version: 'openai-catalog-v11',
    updatedAt: '2026-02-20',
    models: [
      'gpt-5-mini',
      'gpt-5',
      'gpt-4.1-mini',
      'gpt-4o-mini',
      'gpt-audio-mini',
      'gpt-audio',
    ],
  },
  claude: {
    label: 'Anthropic Claude',
    defaultEndpoint: 'https://api.anthropic.com/v1',
    version: 'claude-catalog-v11',
    updatedAt: '2026-02-20',
    models: [
      'claude-sonnet-4',
      'claude-3.5-sonnet',
      'claude-3.5-haiku',
    ],
  },
  gemini: {
    label: 'Google Gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    version: 'gemini-catalog-v11',
    updatedAt: '2026-02-20',
    models: [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
    ],
  },
  kimi: {
    label: 'Moonshot Kimi',
    defaultEndpoint: 'https://api.moonshot.cn/v1',
    version: 'kimi-catalog-v11',
    updatedAt: '2026-02-20',
    models: [
      'moonshot-v1-8k',
      'moonshot-v1-32k',
      'moonshot-v1-128k',
    ],
  },
  deepseek: {
    label: 'DeepSeek',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    version: 'deepseek-catalog-v11',
    updatedAt: '2026-02-20',
    models: [
      'deepseek-chat',
      'deepseek-reasoner',
    ],
  },
  volcengine: {
    label: 'Volcengine (火山引擎)',
    defaultEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    version: 'volcengine-catalog-v11',
    updatedAt: '2026-02-20',
    models: [
      'doubao-pro-32k',
      'doubao-lite-32k',
      'doubao-vision-pro-32k',
    ],
  },
  dashscope: {
    label: 'DashScope (阿里云)',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    version: 'dashscope-catalog-v11',
    updatedAt: '2026-02-23',
    models: [
      'qwen-max',
      'qwen-plus',
      'qwen-turbo',
      'qwen-long',
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    defaultEndpoint: DEFAULT_OPENROUTER_ENDPOINT_V11,
    version: 'openrouter-catalog-v11',
    updatedAt: '2026-02-20',
    models: [
      'openai/gpt-5-mini',
      'openai/gpt-5',
      'anthropic/claude-sonnet-4',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-r1',
      ...OPENROUTER_AUDIO_CHAT_MODELS_V11,
    ],
  },
  custom: {
    label: 'Custom',
    defaultEndpoint: DEFAULT_OPENAI_ENDPOINT_V11,
    version: 'custom-catalog-v11',
    updatedAt: '2026-02-20',
    models: ['custom-model'],
  },
};

export const VENDOR_ORDER_V11: ApiVendor[] = [
  'openrouter',
  'gpt',
  'claude',
  'gemini',
  'deepseek',
  'dashscope',
  'kimi',
  'volcengine',
  'custom',
];

export function dedupeStringsV11(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

export function normalizeEndpointV11(value: string, fallback: string): string {
  return (String(value || '').trim() || fallback).replace(/\/+$/, '');
}

export function randomIdV11(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function catalogModelsV11(vendor: ApiVendor): string[] {
  return dedupeStringsV11([...VENDOR_CATALOGS_V11[vendor].models]);
}

export function createConnectorV11(vendor: ApiVendor = 'openrouter', label?: string): ApiConnector {
  const catalog = VENDOR_CATALOGS_V11[vendor];
  return {
    id: randomIdV11('connector'),
    label: label || `${catalog.label} Connector`,
    vendor,
    provider: '',
    endpoint: catalog.defaultEndpoint,
    hasCredential: false,
    isSystemOwned: false,
    models: catalogModelsV11(vendor),
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  };
}

export function normalizeConnectorModelsV11(vendor: ApiVendor, rawModels: unknown): string[] {
  const catalog = catalogModelsV11(vendor);
  const input = dedupeStringsV11(Array.isArray(rawModels) ? rawModels : []);
  if (input.length === 0) return catalog;
  if (vendor === 'custom') return input;

  if (vendor === 'openrouter') {
    const openRouterShaped = input.filter((model) => model.includes('/'));
    return dedupeStringsV11([...(openRouterShaped.length > 0 ? openRouterShaped : []), ...catalog]);
  }

  const otherCatalogModels = dedupeStringsV11(
    (Object.entries(VENDOR_CATALOGS_V11) as Array<[ApiVendor, VendorCatalogV11]>)
      .filter(([key]) => key !== vendor && key !== 'custom')
      .flatMap(([, item]) => item.models),
  );
  const otherSet = new Set(otherCatalogModels);
  const filtered = input.filter((model) => !otherSet.has(model));

  return dedupeStringsV11([...(filtered.length > 0 ? filtered : []), ...catalog]);
}

export function normalizeConnectorV11(raw: Partial<ApiConnector>): ApiConnector {
  const vendor = normalizeVendorV11(raw.vendor);
  const catalog = VENDOR_CATALOGS_V11[vendor];
  return {
    id: String(raw.id || randomIdV11('connector')),
    label: String(raw.label || `${catalog.label} Connector`),
    vendor,
    provider: String(raw.provider || ''),
    endpoint: normalizeEndpointV11(String(raw.endpoint || catalog.defaultEndpoint), catalog.defaultEndpoint),
    hasCredential: Boolean(raw.hasCredential),
    isSystemOwned: Boolean(raw.isSystemOwned),
    models: normalizeConnectorModelsV11(vendor, raw.models),
    status: normalizeStatusV11(raw.status),
    lastCheckedAt: raw.lastCheckedAt || null,
    lastDetail: String(raw.lastDetail || ''),
  };
}

export function normalizeLocalRuntimeModelV11(raw: Partial<LocalRuntimeModelOptionV11>): LocalRuntimeModelOptionV11 {
  const localModelId = String(raw.localModelId || raw.model || randomIdV11('local-model')).trim();
  const capabilities = (Array.isArray(raw.capabilities) ? raw.capabilities : [])
    .map((value) => String(value || '').trim())
    .filter((value): value is CapabilityV11 => (
      value === 'chat'
      || value === 'image'
      || value === 'video'
      || value === 'tts'
      || value === 'stt'
      || value === 'embedding'
    ));
  return {
    localModelId,
    engine: String(raw.engine || 'localai').trim() || 'localai',
    model: String(raw.model || localModelId).trim() || localModelId,
    endpoint: normalizeEndpointV11(String(raw.endpoint || DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11), DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11),
    capabilities: capabilities.length > 0 ? capabilities : ['chat'],
    status: raw.status === 'active' || raw.status === 'unhealthy' || raw.status === 'removed' ? raw.status : 'installed',
    hash: String(raw.hash || '').trim() || undefined,
    installedAt: String(raw.installedAt || '').trim() || undefined,
    updatedAt: String(raw.updatedAt || '').trim() || undefined,
  };
}

export function normalizeLocalRuntimeNodeMatrixEntryV11(
  raw: Partial<LocalRuntimeNodeMatrixEntryV11>,
): LocalRuntimeNodeMatrixEntryV11 {
  const capability = String(raw.capability || '').trim().toLowerCase();
  const normalizedCapability: NodeCapabilityV11 = (
    capability === 'image'
    || capability === 'video'
    || capability === 'tts'
    || capability === 'stt'
    || capability === 'embedding'
    || capability === 'rerank'
    || capability === 'cv'
    || capability === 'diarize'
  ) ? capability : 'chat';
  const normalizedProvider = String(raw.provider || '').trim().toLowerCase() || (
    String(raw.serviceId || '').toLowerCase().includes('nexa') ? 'nexa' : 'localai'
  );
  const adapterRaw = String(raw.adapter || '').trim().toLowerCase();
  const normalizedAdapter: LocalRuntimeNodeMatrixEntryV11['adapter'] = adapterRaw === 'localai_native_adapter'
    ? 'localai_native_adapter'
    : adapterRaw === 'openai_compat_adapter'
      ? 'openai_compat_adapter'
      : normalizedProvider === 'nexa'
        ? (
          normalizedCapability === 'rerank'
          || normalizedCapability === 'cv'
          || normalizedCapability === 'diarize'
            ? 'localai_native_adapter'
            : 'openai_compat_adapter'
        )
        : (
          normalizedCapability === 'chat' || normalizedCapability === 'embedding'
            ? 'openai_compat_adapter'
            : 'localai_native_adapter'
        );
  const hints = (
    raw.providerHints
    && typeof raw.providerHints === 'object'
    && !Array.isArray(raw.providerHints)
  )
    ? raw.providerHints as LocalRuntimeProviderHintsV11
    : undefined;
  return {
    nodeId: String(raw.nodeId || '').trim() || randomIdV11('node'),
    capability: normalizedCapability,
    serviceId: String(raw.serviceId || '').trim() || 'localai-openai-gateway',
    provider: normalizedProvider,
    adapter: normalizedAdapter,
    backend: String(raw.backend || '').trim() || undefined,
    backendSource: String(raw.backendSource || '').trim() || undefined,
    available: Boolean(raw.available),
    reasonCode: String(raw.reasonCode || '').trim() || undefined,
    policyGate: String(raw.policyGate || '').trim() || undefined,
    providerHints: hints,
  };
}
