export const CAPABILITIES_V11 = ['chat', 'image', 'video', 'tts', 'stt', 'embedding'] as const;
export type CapabilityV11 = (typeof CAPABILITIES_V11)[number];

export type SourceIdV11 = 'local' | 'cloud';
export type RuntimePageIdV11 = 'overview' | 'local' | 'cloud' | 'catalog' | 'runtime' | 'mods' | 'data-management' | 'performance' | 'mod-developer';
export type RuntimeSetupPageIdV11 = RuntimePageIdV11;
export type UiModeV11 = 'simple' | 'advanced';
export type ProviderStatusV11 = 'idle' | 'healthy' | 'unreachable' | 'unsupported' | 'degraded';
export type ApiVendor =
  | 'openrouter'
  | 'gpt'
  | 'claude'
  | 'gemini'
  | 'kimi'
  | 'deepseek'
  | 'volcengine'
  | 'dashscope'
  | 'custom';

export type LocalModelOptionV11 = {
  localModelId: string;
  engine: 'localai' | 'nexa' | 'nimi_media' | string;
  model: string;
  endpoint: string;
  capabilities: CapabilityV11[];
  status: 'installed' | 'active' | 'unhealthy' | 'removed';
  hash?: string;
  installedAt?: string;
  updatedAt?: string;
};

export type NodeCapabilityV11 = CapabilityV11 | 'rerank' | 'cv' | 'diarize';

export type LocalProviderHintsV11 = {
  localai?: {
    backend?: string;
    preferredAdapter?: 'openai_compat_adapter' | 'localai_native_adapter' | 'nimi_media_native_adapter' | string;
    whisperVariant?: string;
    stablediffusionPipeline?: string;
    videoBackend?: string;
  };
  nexa?: {
    backend?: string;
    preferredAdapter?: 'openai_compat_adapter' | 'localai_native_adapter' | 'nexa_native_adapter' | 'nimi_media_native_adapter' | string;
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
  nimiMedia?: {
    preferredAdapter?: 'nimi_media_native_adapter' | string;
    driver?: string;
    family?: string;
  };
  extra?: Record<string, unknown>;
} & Record<string, unknown>;

export type LocalNodeMatrixEntryV11 = {
  nodeId: string;
  capability: NodeCapabilityV11;
  serviceId: string;
  provider: 'localai' | 'nexa' | 'nimi_media' | string;
  adapter: 'openai_compat_adapter' | 'localai_native_adapter' | 'nexa_native_adapter' | 'nimi_media_native_adapter';
  backend?: string;
  backendSource?: string;
  available: boolean;
  reasonCode?: string;
  policyGate?: string;
  providerHints?: LocalProviderHintsV11;
};

export type LocalStateV11 = {
  endpoint: string;
  models: LocalModelOptionV11[];
  nodeMatrix: LocalNodeMatrixEntryV11[];
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
  modelCapabilities?: Record<string, string[]>;
  status: ProviderStatusV11;
  lastCheckedAt: string | null;
  lastDetail: string;
  isDraft?: boolean;
};

export type RuntimeConfigStateV11 = {
  version: 11 | 12;
  initializedByV11: boolean;
  activePage: RuntimePageIdV11;
  diagnosticsCollapsed: boolean;
  selectedSource: SourceIdV11;
  activeCapability: CapabilityV11;
  uiMode: UiModeV11;
  local: LocalStateV11;
  connectors: ApiConnector[];
  selectedConnectorId: string;
};

export const DEFAULT_LOCAL_ENDPOINT_V11 = 'http://127.0.0.1:1234/v1';
export const DEFAULT_OPENAI_ENDPOINT_V11 = 'http://127.0.0.1:1234/v1';
export const DEFAULT_OPENROUTER_ENDPOINT_V11 = 'https://openrouter.ai/api/v1';

function defaultEngineForCapabilities(capabilities: CapabilityV11[]): LocalModelOptionV11['engine'] {
  if (capabilities.includes('image') || capabilities.includes('video')) {
    return 'nimi_media';
  }
  if (capabilities.includes('tts') || capabilities.includes('stt') || capabilities.includes('embedding')) {
    return 'nexa';
  }
  return 'localai';
}

function defaultEndpointForEngine(engine: LocalModelOptionV11['engine']): string {
  if (engine === 'nimi_media') {
    return 'http://127.0.0.1:8321/v1';
  }
  if (engine === 'nexa') {
    return 'http://127.0.0.1:18181/v1';
  }
  return DEFAULT_LOCAL_ENDPOINT_V11;
}

export const VENDOR_LABELS_V11: Record<ApiVendor, string> = {
  gpt: 'OpenAI',
  claude: 'Anthropic Claude',
  gemini: 'Google Gemini',
  kimi: 'Moonshot Kimi',
  deepseek: 'DeepSeek',
  volcengine: 'Volcengine (火山引擎)',
  dashscope: 'DashScope (阿里云)',
  openrouter: 'OpenRouter',
  custom: 'Custom',
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

export function normalizeSourceV11(value: unknown): SourceIdV11 {
  return value === 'cloud' ? 'cloud' : 'local';
}

export function normalizePageIdV11(value: unknown): RuntimePageIdV11 {
  if (
    value === 'overview'
    || value === 'local'
    || value === 'cloud'
    || value === 'catalog'
    || value === 'runtime'
    || value === 'mods'
    || value === 'data-management'
    || value === 'performance'
    || value === 'mod-developer'
  ) {
    return value;
  }
  return 'overview';
}

export function normalizeCapabilityV11(value: unknown): CapabilityV11 {
  if (value === 'image' || value === 'video' || value === 'tts' || value === 'stt' || value === 'embedding') return value;
  return 'chat';
}

export function normalizeUiModeV11(value: unknown): UiModeV11 {
  return value === 'advanced' ? 'advanced' : 'simple';
}

export function normalizeVendorV11(value: unknown): ApiVendor {
  if (
    value === 'gpt'
    || value === 'claude'
    || value === 'gemini'
    || value === 'kimi'
    || value === 'deepseek'
    || value === 'volcengine'
    || value === 'dashscope'
    || value === 'custom'
    || value === 'openrouter'
  ) {
    return value;
  }
  return 'openrouter';
}

export function normalizeStatusV11(value: unknown): ProviderStatusV11 {
  if (value === 'healthy' || value === 'unreachable' || value === 'unsupported' || value === 'degraded') return value;
  return 'idle';
}

export function statusTextV11(status: ProviderStatusV11): string {
  if (status === 'healthy') return 'Healthy';
  if (status === 'degraded') return 'Degraded';
  if (status === 'unreachable') return 'Unreachable';
  if (status === 'unsupported') return 'Unsupported';
  return 'Not checked';
}

export function statusClassV11(status: ProviderStatusV11): string {
  if (status === 'healthy') return 'bg-green-50 text-green-700';
  if (status === 'degraded') return 'bg-yellow-50 text-yellow-700';
  if (status === 'unreachable') return 'bg-red-50 text-red-700';
  if (status === 'unsupported') return 'bg-orange-50 text-orange-700';
  return 'bg-gray-100 text-gray-600';
}

export function dedupeStringsV11(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

export function getVendorLabelV11(vendor: ApiVendor): string {
  return VENDOR_LABELS_V11[vendor];
}

export function normalizeEndpointV11(value: string, fallback: string): string {
  return (String(value || '').trim() || fallback).replace(/\/+$/, '');
}

export function randomIdV11(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createConnectorV11(vendor: ApiVendor = 'openrouter', label?: string): ApiConnector {
  return {
    id: randomIdV11('connector'),
    label: label || `${getVendorLabelV11(vendor)} Connector`,
    vendor,
    provider: '',
    endpoint: DEFAULT_OPENAI_ENDPOINT_V11,
    hasCredential: false,
    isSystemOwned: false,
    models: [],
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  };
}

export function normalizeConnectorModelsV11(vendor: ApiVendor, rawModels: unknown): string[] {
  void vendor;
  return dedupeStringsV11(Array.isArray(rawModels) ? rawModels : []);
}

export function normalizeConnectorV11(raw: Partial<ApiConnector>): ApiConnector {
  const vendor = normalizeVendorV11(raw.vendor);
  return {
    id: String(raw.id || randomIdV11('connector')),
    label: String(raw.label || `${getVendorLabelV11(vendor)} Connector`),
    vendor,
    provider: String(raw.provider || ''),
    endpoint: normalizeEndpointV11(String(raw.endpoint || DEFAULT_OPENAI_ENDPOINT_V11), DEFAULT_OPENAI_ENDPOINT_V11),
    hasCredential: Boolean(raw.hasCredential),
    isSystemOwned: Boolean(raw.isSystemOwned),
    models: normalizeConnectorModelsV11(vendor, raw.models),
    status: normalizeStatusV11(raw.status),
    lastCheckedAt: raw.lastCheckedAt || null,
    lastDetail: String(raw.lastDetail || ''),
  };
}

export function normalizeLocalModelV11(raw: Partial<LocalModelOptionV11>): LocalModelOptionV11 {
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
  const engine = String(raw.engine || defaultEngineForCapabilities(capabilities)).trim() || defaultEngineForCapabilities(capabilities);
  return {
    localModelId,
    engine,
    model: String(raw.model || localModelId).trim() || localModelId,
    endpoint: normalizeEndpointV11(String(raw.endpoint || defaultEndpointForEngine(engine)), defaultEndpointForEngine(engine)),
    capabilities: capabilities.length > 0 ? capabilities : ['chat'],
    status: raw.status === 'active' || raw.status === 'unhealthy' || raw.status === 'removed' ? raw.status : 'installed',
    hash: String(raw.hash || '').trim() || undefined,
    installedAt: String(raw.installedAt || '').trim() || undefined,
    updatedAt: String(raw.updatedAt || '').trim() || undefined,
  };
}

export function normalizeLocalNodeMatrixEntryV11(
  raw: Partial<LocalNodeMatrixEntryV11>,
): LocalNodeMatrixEntryV11 {
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
    String(raw.serviceId || '').toLowerCase().includes('nimi-media')
      ? 'nimi_media'
      : String(raw.serviceId || '').toLowerCase().includes('nexa')
        ? 'nexa'
        : normalizedCapability === 'image' || normalizedCapability === 'video'
          ? 'nimi_media'
          : 'localai'
  );
  const adapterRaw = String(raw.adapter || '').trim().toLowerCase();
  let normalizedAdapter: LocalNodeMatrixEntryV11['adapter'];
  if (adapterRaw === 'localai_native_adapter') {
    normalizedAdapter = 'localai_native_adapter';
  } else if (adapterRaw === 'nexa_native_adapter') {
    normalizedAdapter = 'nexa_native_adapter';
  } else if (adapterRaw === 'nimi_media_native_adapter') {
    normalizedAdapter = 'nimi_media_native_adapter';
  } else if (adapterRaw === 'openai_compat_adapter') {
    normalizedAdapter = 'openai_compat_adapter';
  } else if (normalizedProvider === 'nexa') {
    normalizedAdapter = 'nexa_native_adapter';
  } else if (normalizedProvider === 'nimi_media') {
    normalizedAdapter = 'nimi_media_native_adapter';
  } else {
    normalizedAdapter = normalizedCapability === 'chat' || normalizedCapability === 'embedding'
      ? 'openai_compat_adapter'
      : 'localai_native_adapter';
  }
  const hints = (
    raw.providerHints
    && typeof raw.providerHints === 'object'
    && !Array.isArray(raw.providerHints)
  )
    ? raw.providerHints as LocalProviderHintsV11
    : undefined;
  return {
    nodeId: String(raw.nodeId || '').trim() || randomIdV11('node'),
    capability: normalizedCapability,
    serviceId: String(raw.serviceId || '').trim() || (
      normalizedProvider === 'nimi_media'
        ? 'nimi-media-openai-gateway'
        : normalizedProvider === 'nexa'
          ? 'nexa-openai-gateway'
          : 'localai-openai-gateway'
    ),
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
