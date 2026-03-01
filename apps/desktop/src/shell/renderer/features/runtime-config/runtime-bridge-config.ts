import {
  DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
  createConnectorV11,
  normalizeEndpointV11,
  type ApiVendor,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/v11/types';

type RuntimeBridgeProviderConfig = {
  baseUrl: string;
  apiKeyEnv: string;
};

const DEFAULT_RUNTIME_CONFIG = {
  schemaVersion: 1,
  runtime: {
    grpcAddr: '127.0.0.1:46371',
    httpAddr: '127.0.0.1:46372',
    shutdownTimeout: '10s',
    localRuntimeStatePath: '~/.nimi/runtime/local-runtime-state.json',
  },
  ai: {
    httpTimeout: '30s',
    healthInterval: '8s',
  },
} as const;

const DEFAULT_PROVIDER_BASE_URL: Record<string, string> = {
  local: DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
  'local-nexa': 'http://127.0.0.1:18181',
  nimillm: 'http://127.0.0.1:4000',
  alibaba: 'https://dashscope.aliyuncs.com/compatible-mode',
  bytedance: 'https://ark.cn-beijing.volces.com',
  'bytedance-openspeech': 'https://openspeech.bytedance.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  minimax: 'https://api.minimax.io',
  kimi: 'https://api.moonshot.cn',
  glm: 'https://api.z.ai/api/paas/v4',
};

const DEFAULT_PROVIDER_API_KEY_ENV: Record<string, string> = {
  local: 'LOCALAI_API_KEY',
  'local-nexa': 'NEXA_API_KEY',
  nimillm: 'NIMILLM_API_KEY',
  alibaba: 'DASHSCOPE_API_KEY',
  bytedance: 'ARK_API_KEY',
  'bytedance-openspeech': 'OPENSPEECH_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  glm: 'ZAI_API_KEY',
};

const UI_MANAGED_CLOUD_PROVIDER_KEYS = ['nimillm', 'alibaba', 'bytedance', 'gemini', 'deepseek', 'minimax', 'kimi', 'glm'] as const;
const UI_UNMANAGED_PROVIDER_KEYS = ['local-nexa', 'bytedance-openspeech'] as const;

type UiManagedCloudProviderKey = (typeof UI_MANAGED_CLOUD_PROVIDER_KEYS)[number];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function deepCloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function canonicalProviderKey(raw: string): string {
  const trimmed = readString(raw).toLowerCase();
  const token = trimmed.replace(/[^a-z0-9]/g, '');
  if (token === 'local') return 'local';
  if (token === 'localnexa' || token === 'nexa') return 'local-nexa';
  if (token === 'nimillm' || token === 'cloudnimillm') return 'nimillm';
  if (token === 'alibaba' || token === 'aliyun' || token === 'cloudalibaba' || token === 'dashscope') return 'alibaba';
  if (token === 'bytedance' || token === 'byte' || token === 'cloudbytedance' || token === 'volcengine') return 'bytedance';
  if (token === 'bytedanceopenspeech' || token === 'openspeech' || token === 'cloudbytedanceopenspeech') return 'bytedance-openspeech';
  if (token === 'gemini' || token === 'cloudgemini') return 'gemini';
  if (token === 'minimax' || token === 'cloudminimax') return 'minimax';
  if (token === 'kimi' || token === 'moonshot' || token === 'cloudkimi') return 'kimi';
  if (token === 'glm' || token === 'zhipu' || token === 'bigmodel' || token === 'cloudglm') return 'glm';
  if (token === 'deepseek' || token === 'clouddeepseek') return 'deepseek';
  return trimmed;
}

function isLegacyProviderToken(raw: string): boolean {
  const token = readString(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
  return token === 'litellm' || token === 'cloudlitellm' || token === 'cloudai';
}

function defaultApiKeyEnvForProvider(providerKey: string): string {
  return DEFAULT_PROVIDER_API_KEY_ENV[providerKey] || '';
}

function defaultBaseUrlForProvider(providerKey: string): string {
  return DEFAULT_PROVIDER_BASE_URL[providerKey] || '';
}

function normalizeProviderConfigs(input: Record<string, unknown>): Record<string, RuntimeBridgeProviderConfig> {
  const output: Record<string, RuntimeBridgeProviderConfig> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (isLegacyProviderToken(rawKey)) {
      throw new Error(`legacy provider key is forbidden: ${rawKey}`);
    }
    const key = canonicalProviderKey(rawKey);
    if (!key) continue;
    const record = asRecord(rawValue);
    const baseUrl = readString(record.baseUrl);
    const apiKeyEnv = readString(record.apiKeyEnv);
    if (!baseUrl && !apiKeyEnv) continue;
    output[key] = {
      baseUrl,
      apiKeyEnv,
    };
  }
  return output;
}

function connectorLabelFromProvider(providerKey: string): string {
  if (providerKey === 'alibaba') return 'DashScope Connector';
  if (providerKey === 'bytedance') return 'Volcengine Connector';
  if (providerKey === 'gemini') return 'Gemini Connector';
  if (providerKey === 'kimi') return 'Kimi Connector';
  if (providerKey === 'minimax') return 'MiniMax Connector';
  if (providerKey === 'glm') return 'GLM Connector';
  if (providerKey === 'deepseek') return 'DeepSeek Connector';
  if (providerKey === 'nimillm') return 'NimiLLM Connector';
  return `Connector ${providerKey}`;
}

function inferVendorFromEndpoint(endpoint: string): ApiVendor {
  const normalized = readString(endpoint).toLowerCase().replace(/\/+$/, '');
  if (!normalized) return 'openrouter';
  if (normalized.includes('openrouter.ai')) return 'openrouter';
  if (normalized.includes('api.openai.com')) return 'gpt';
  if (normalized.includes('api.anthropic.com')) return 'claude';
  if (normalized.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (normalized.includes('api.deepseek.com')) return 'deepseek';
  if (normalized.includes('api.moonshot.cn')) return 'kimi';
  if (normalized.includes('dashscope.aliyuncs.com') || normalized.includes('aliyuncs.com')) return 'dashscope';
  if (normalized.includes('ark.cn-beijing.volces.com') || normalized.includes('volces.com')) return 'volcengine';
  return 'custom';
}

function vendorFromProviderKey(providerKey: UiManagedCloudProviderKey, endpoint: string): ApiVendor {
  if (providerKey === 'alibaba') return 'dashscope';
  if (providerKey === 'bytedance') return 'volcengine';
  if (providerKey === 'gemini') return 'gemini';
  if (providerKey === 'kimi') return 'kimi';
  if (providerKey === 'deepseek') return 'deepseek';
  if (providerKey === 'minimax' || providerKey === 'glm') return 'custom';
  return inferVendorFromEndpoint(endpoint);
}

function providerKeyFromConnector(connector: RuntimeConfigStateV11['connectors'][number]): UiManagedCloudProviderKey {
  if (connector.vendor === 'dashscope') return 'alibaba';
  if (connector.vendor === 'volcengine') return 'bytedance';
  if (connector.vendor === 'gemini') return 'gemini';
  if (connector.vendor === 'kimi') return 'kimi';
  if (connector.vendor === 'deepseek') return 'deepseek';

  const normalizedEndpoint = readString(connector.endpoint).toLowerCase();
  if (normalizedEndpoint.includes('api.deepseek.com')) return 'deepseek';
  if (normalizedEndpoint.includes('api.minimax.io')) return 'minimax';
  if (
    normalizedEndpoint.includes('api.z.ai')
    || normalizedEndpoint.includes('bigmodel')
    || normalizedEndpoint.includes('zhipu')
  ) {
    return 'glm';
  }

  return 'nimillm';
}

function connectorFromProvider(
  providerKey: UiManagedCloudProviderKey,
  providerConfig: RuntimeBridgeProviderConfig,
): RuntimeConfigStateV11['connectors'][number] {
  const endpoint = normalizeEndpointV11(
    providerConfig.baseUrl,
    defaultBaseUrlForProvider(providerKey),
  );
  const vendor = vendorFromProviderKey(providerKey, endpoint);
  const connector = createConnectorV11(vendor, connectorLabelFromProvider(providerKey));
  connector.endpoint = endpoint;
  connector.tokenApiKeyEnv = readString(providerConfig.apiKeyEnv);
  return connector;
}

function findConnectorTokenEnvByProvider(
  connectors: RuntimeConfigStateV11['connectors'],
  providerKey: UiManagedCloudProviderKey,
): string {
  const sameProvider = connectors.find((connector) => providerKeyFromConnector(connector) === providerKey);
  return sameProvider ? readString(sameProvider.tokenApiKeyEnv) : '';
}

function findExistingConnectorByProvider(
  connectors: RuntimeConfigStateV11['connectors'],
  providerKey: UiManagedCloudProviderKey,
  endpoint: string,
): RuntimeConfigStateV11['connectors'][number] | null {
  const normalizedEndpoint = normalizeEndpointV11(endpoint, endpoint);
  const exact = connectors.find((connector) => (
    providerKeyFromConnector(connector) === providerKey
    && normalizeEndpointV11(connector.endpoint, connector.endpoint) === normalizedEndpoint
  ));
  if (exact) {
    return exact;
  }
  return connectors.find((connector) => providerKeyFromConnector(connector) === providerKey) || null;
}

function sortProviderEntries(providers: Record<string, RuntimeBridgeProviderConfig>): Record<string, RuntimeBridgeProviderConfig> {
  const sortedKeys = Object.keys(providers).sort((left, right) => left.localeCompare(right));
  const output: Record<string, RuntimeBridgeProviderConfig> = {};
  for (const key of sortedKeys) {
    const entry = providers[key];
    if (!entry) continue;
    output[key] = entry;
  }
  return output;
}

function orderedConnectorsBySelection(state: RuntimeConfigStateV11): RuntimeConfigStateV11['connectors'] {
  const selectedConnectorId = readString(state.selectedConnectorId);
  return [...state.connectors].sort((left, right) => {
    if (left.id === selectedConnectorId && right.id !== selectedConnectorId) return -1;
    if (right.id === selectedConnectorId && left.id !== selectedConnectorId) return 1;
    return left.id.localeCompare(right.id);
  });
}

export function applyRuntimeBridgeConfigToState(
  state: RuntimeConfigStateV11,
  runtimeConfigRaw: Record<string, unknown>,
): RuntimeConfigStateV11 {
  // Go runtime stores providers at top level (config.providers), not nested under ai.
  const providers = normalizeProviderConfigs(
    asRecord(asRecord(runtimeConfigRaw).providers),
  );

  const localProvider = providers.local;
  const nextLocalEndpoint = localProvider?.baseUrl
    ? normalizeEndpointV11(localProvider.baseUrl, DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11)
    : state.localRuntime.endpoint;

  const previousSelectedConnector = state.connectors.find((connector) => connector.id === state.selectedConnectorId) || null;
  const previousSelectedProviderKey = previousSelectedConnector
    ? providerKeyFromConnector(previousSelectedConnector)
    : null;

  const connectorsFromConfig = UI_MANAGED_CLOUD_PROVIDER_KEYS
    .map((providerKey) => {
      const provider = providers[providerKey];
      if (!provider || !readString(provider.baseUrl)) {
        return null;
      }
      const connector = connectorFromProvider(providerKey, provider);
      const existing = findExistingConnectorByProvider(state.connectors, providerKey, connector.endpoint);
      if (existing) {
        // Keep stable connector identity and user-facing name across bridge resync.
        connector.id = existing.id;
        if (readString(existing.label)) {
          connector.label = existing.label;
        }
      }
      if (!connector.tokenApiKeyEnv) {
        connector.tokenApiKeyEnv = findConnectorTokenEnvByProvider(state.connectors, providerKey)
          || defaultApiKeyEnvForProvider(providerKey);
      }
      return connector;
    })
    .filter((connector): connector is RuntimeConfigStateV11['connectors'][number] => Boolean(connector));

  // Runtime bridge config (config.json) is the single source of truth for connectors.
  // No localStorage fallback — connectorsFromConfig IS the complete connector list.
  const nextConnectors = connectorsFromConfig;
  const nextSelectedConnectorId = previousSelectedProviderKey
    ? (nextConnectors.find((connector) => providerKeyFromConnector(connector) === previousSelectedProviderKey)?.id
      || nextConnectors[0]?.id
      || '')
    : (nextConnectors[0]?.id || '');

  return {
    ...state,
    localRuntime: {
      ...state.localRuntime,
      endpoint: nextLocalEndpoint,
    },
    connectors: nextConnectors,
    selectedConnectorId: nextSelectedConnectorId,
  };
}

export function buildRuntimeBridgeConfigFromState(
  state: RuntimeConfigStateV11,
  baseConfigRaw: Record<string, unknown>,
): Record<string, unknown> {
  // Go runtime FileConfig uses flat top-level fields (grpcAddr, providers, etc.),
  // NOT nested runtime/ai objects.
  const configRecord = deepCloneRecord(baseConfigRaw);
  configRecord.schemaVersion = DEFAULT_RUNTIME_CONFIG.schemaVersion;
  configRecord.grpcAddr = readString(configRecord.grpcAddr as string) || DEFAULT_RUNTIME_CONFIG.runtime.grpcAddr;
  configRecord.httpAddr = readString(configRecord.httpAddr as string) || DEFAULT_RUNTIME_CONFIG.runtime.httpAddr;

  const existingProviders = normalizeProviderConfigs(asRecord(configRecord.providers));
  const nextProviders: Record<string, RuntimeBridgeProviderConfig> = {};

  for (const providerKey of UI_UNMANAGED_PROVIDER_KEYS) {
    const existing = existingProviders[providerKey];
    if (!existing) continue;
    nextProviders[providerKey] = {
      baseUrl: normalizeEndpointV11(existing.baseUrl, defaultBaseUrlForProvider(providerKey)),
      apiKeyEnv: readString(existing.apiKeyEnv) || defaultApiKeyEnvForProvider(providerKey),
    };
  }

  for (const [providerKey, existing] of Object.entries(existingProviders)) {
    if (providerKey === 'local' || UI_MANAGED_CLOUD_PROVIDER_KEYS.includes(providerKey as UiManagedCloudProviderKey)) {
      continue;
    }
    if (!UI_UNMANAGED_PROVIDER_KEYS.includes(providerKey as (typeof UI_UNMANAGED_PROVIDER_KEYS)[number])) {
      const envRef = readString(existing.apiKeyEnv);
      if (!envRef) continue;
      nextProviders[providerKey] = {
        baseUrl: readString(existing.baseUrl),
        apiKeyEnv: envRef,
      };
    }
  }

  nextProviders.local = {
    baseUrl: normalizeEndpointV11(state.localRuntime.endpoint, DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11),
    apiKeyEnv: readString(existingProviders.local?.apiKeyEnv) || defaultApiKeyEnvForProvider('local'),
  };

  const connectors = orderedConnectorsBySelection(state);
  const appliedManagedProviders = new Set<string>();
  for (const connector of connectors) {
    const providerKey = providerKeyFromConnector(connector);
    if (appliedManagedProviders.has(providerKey)) {
      continue;
    }
    appliedManagedProviders.add(providerKey);

    nextProviders[providerKey] = {
      baseUrl: normalizeEndpointV11(connector.endpoint, defaultBaseUrlForProvider(providerKey)),
      apiKeyEnv: readString(connector.tokenApiKeyEnv)
        || readString(existingProviders[providerKey]?.apiKeyEnv)
        || defaultApiKeyEnvForProvider(providerKey),
    };
  }

  const providers = sortProviderEntries(nextProviders);
  const providersRecord: Record<string, unknown> = {};
  for (const [providerKey, providerConfig] of Object.entries(providers)) {
    providersRecord[providerKey] = {
      baseUrl: providerConfig.baseUrl,
      apiKeyEnv: providerConfig.apiKeyEnv,
    };
  }

  configRecord.providers = providersRecord;
  return configRecord;
}

export function serializeRuntimeBridgeProjection(state: RuntimeConfigStateV11): string {
  const projectionProviders: Array<{ provider: string; endpoint: string; apiKeyEnv: string }> = [];
  const seen = new Set<string>();
  for (const connector of orderedConnectorsBySelection(state)) {
    const provider = providerKeyFromConnector(connector);
    if (seen.has(provider)) continue;
    seen.add(provider);
    projectionProviders.push({
      provider,
      endpoint: normalizeEndpointV11(connector.endpoint, defaultBaseUrlForProvider(provider)),
      apiKeyEnv: readString(connector.tokenApiKeyEnv),
    });
  }
  projectionProviders.sort((left, right) => (
    left.provider === right.provider
      ? (left.endpoint === right.endpoint
        ? left.apiKeyEnv.localeCompare(right.apiKeyEnv)
        : left.endpoint.localeCompare(right.endpoint))
      : left.provider.localeCompare(right.provider)
  ));

  return JSON.stringify({
    localEndpoint: normalizeEndpointV11(state.localRuntime.endpoint, DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11),
    providers: projectionProviders,
  });
}
