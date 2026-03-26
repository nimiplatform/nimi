import type { LocalRuntimeCatalogRecommendation } from '@runtime/local-runtime';

type JsonObject = Record<string, unknown>;

export const CAPABILITIES_V11 = ['chat', 'image', 'video', 'tts', 'stt', 'embedding'] as const;
export type CapabilityV11 = (typeof CAPABILITIES_V11)[number];

export type SourceIdV11 = 'local' | 'cloud';
export type RuntimePageIdV11 = 'overview' | 'recommend' | 'local' | 'cloud' | 'catalog' | 'runtime' | 'mods' | 'data-management' | 'performance' | 'mod-developer';
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
  engine: 'llama' | 'media' | 'speech' | 'sidecar' | string;
  model: string;
  endpoint: string;
  capabilities: CapabilityV11[];
  status: 'installed' | 'active' | 'unhealthy' | 'removed';
  hash?: string;
  installedAt?: string;
  updatedAt?: string;
  recommendation?: LocalRuntimeCatalogRecommendation;
};

export type NodeCapabilityV11 = CapabilityV11 | 'rerank' | 'cv' | 'diarize';

export type LocalProviderHintsV11 = {
  llama?: {
    backend?: string;
    preferredAdapter?: 'openai_compat_adapter' | 'llama_native_adapter' | string;
    whisperVariant?: string;
  };
  media?: {
    preferredAdapter?: 'media_native_adapter' | string;
    driver?: string;
    family?: string;
  };
  speech?: {
    preferredAdapter?: 'speech_native_adapter' | string;
    backend?: string;
    family?: string;
  };
  extra?: JsonObject;
} & JsonObject;

export type LocalNodeMatrixEntryV11 = {
  nodeId: string;
  capability: NodeCapabilityV11;
  serviceId: string;
  provider: 'llama' | 'media' | 'speech' | 'sidecar' | string;
  adapter: 'openai_compat_adapter' | 'llama_native_adapter' | 'media_native_adapter' | 'speech_native_adapter' | 'sidecar_music_adapter';
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

export const DEFAULT_LOCAL_ENDPOINT_V11 = '';
export const DEFAULT_OPENAI_ENDPOINT_V11 = '';
export const DEFAULT_OPENROUTER_ENDPOINT_V11 = 'https://openrouter.ai/api/v1';
let _runtimeConfigPlatformForTests: 'windows' | 'darwin' | 'linux' | 'unknown' | null = null;

export function setRuntimeConfigPlatformForTests(value: 'windows' | 'darwin' | 'linux' | 'unknown' | null): void {
  _runtimeConfigPlatformForTests = value;
}

function defaultEngineForCapabilities(capabilities: CapabilityV11[]): LocalModelOptionV11['engine'] {
  if (capabilities.includes('image') || capabilities.includes('video')) {
    return 'media';
  }
  if (capabilities.includes('tts') || capabilities.includes('stt')) {
    return 'speech';
  }
  return 'llama';
}

function defaultEndpointForEngine(engine: LocalModelOptionV11['engine']): string {
  if (engine === 'speech') return 'http://127.0.0.1:8330';
  if (engine === 'media') return 'http://127.0.0.1:8321';
  return engine === 'llama' ? DEFAULT_LOCAL_ENDPOINT_V11 : '';
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
    || value === 'recommend'
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
  if (status === 'healthy') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]';
  if (status === 'degraded') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]';
  if (status === 'unreachable') return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)]';
  if (status === 'unsupported') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)]';
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
  const defaultEndpoint = vendor === 'openrouter' ? DEFAULT_OPENROUTER_ENDPOINT_V11 : DEFAULT_OPENAI_ENDPOINT_V11;
  return {
    id: randomIdV11('connector'),
    label: label || `${getVendorLabelV11(vendor)} Connector`,
    vendor,
    provider: '',
    endpoint: defaultEndpoint,
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
  const defaultEndpoint = vendor === 'openrouter' ? DEFAULT_OPENROUTER_ENDPOINT_V11 : DEFAULT_OPENAI_ENDPOINT_V11;
  return {
    id: String(raw.id || randomIdV11('connector')),
    label: String(raw.label || `${getVendorLabelV11(vendor)} Connector`),
    vendor,
    provider: String(raw.provider || ''),
    endpoint: normalizeEndpointV11(String(raw.endpoint || defaultEndpoint), defaultEndpoint),
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
    recommendation: raw.recommendation,
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
  const normalizedProvider = String(raw.provider || '').trim().toLowerCase();
  const adapterRaw = String(raw.adapter || '').trim().toLowerCase();
  let normalizedAdapter: LocalNodeMatrixEntryV11['adapter'];
  if (adapterRaw === 'llama_native_adapter') {
    normalizedAdapter = 'llama_native_adapter';
  } else if (adapterRaw === 'media_native_adapter') {
    normalizedAdapter = 'media_native_adapter';
  } else if (adapterRaw === 'speech_native_adapter') {
    normalizedAdapter = 'speech_native_adapter';
  } else if (adapterRaw === 'sidecar_music_adapter') {
    normalizedAdapter = 'sidecar_music_adapter';
  } else if (adapterRaw === 'openai_compat_adapter') {
    normalizedAdapter = 'openai_compat_adapter';
  } else if (normalizedProvider === 'media') {
    normalizedAdapter = 'media_native_adapter';
  } else if (normalizedProvider === 'speech') {
    normalizedAdapter = 'speech_native_adapter';
  } else if (normalizedProvider === 'sidecar') {
    normalizedAdapter = 'sidecar_music_adapter';
  } else {
    normalizedAdapter = normalizedCapability === 'chat' || normalizedCapability === 'embedding'
      ? 'openai_compat_adapter'
      : 'llama_native_adapter';
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
    serviceId: String(raw.serviceId || '').trim(),
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
