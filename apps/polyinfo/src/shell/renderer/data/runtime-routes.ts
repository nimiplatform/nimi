import { getPlatformClient } from '@nimiplatform/sdk';
import {
  buildRuntimeRouteOptionsSnapshot,
  buildRuntimeRouteSelectedBinding,
  createEmptyAIConfig,
  type AIConfig,
  type AIScopeRef,
  type RuntimeRouteBinding,
  type RuntimeRouteConnectorOption,
  type RuntimeRouteLocalOption,
  type RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/mod';
import type { RuntimeDefaults, RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import {
  clearLegacyAnalystRuntimeSettings,
  loadSavedAnalystRuntimeSettings,
} from './taxonomy.js';

const AI_CONFIG_STORAGE_KEY = 'nimi:polyinfo:ai-config:v1';
const CONNECTOR_KIND_REMOTE_MANAGED = 2;
const CONNECTOR_MODELS_PAGE_SIZE = 200;
const CONNECTOR_MODELS_MAX_PAGES = 50;
const LOCAL_MODELS_PAGE_SIZE = 200;
const LOCAL_MODELS_MAX_PAGES = 20;
const LOCAL_ASSET_STATUS_INSTALLED = 1;
const LOCAL_ASSET_STATUS_ACTIVE = 2;
const LOCAL_ASSET_STATUS_UNHEALTHY = 3;
const LOCAL_ASSET_STATUS_REMOVED = 4;
const LOCAL_ROUTE_BLOCKED_STATUSES = new Set(['removed', 'unavailable', 'unhealthy']);

type RuntimeConnectorLike = {
  connectorId: string;
  provider: string;
  label: string;
  kind: number;
};

type RuntimeConnectorModelLike = {
  available?: boolean;
  modelId?: string;
  capabilities?: string[];
};

type RuntimeLocalAssetLike = {
  localAssetId?: string;
  localModelId?: string;
  assetId?: string;
  logicalModelId?: string;
  modelId?: string;
  title?: string;
  label?: string;
  engine?: string;
  endpoint?: string;
  status?: unknown;
  capabilities?: string[];
};

type RuntimeHealthSummary = {
  runtimeHealth: {
    status: string;
    reason: string;
    queueDepth: number;
    activeWorkflows: number;
    activeInferenceJobs: number;
  } | null;
  providers: Array<{
    providerName: string;
    state: string;
    reason?: string;
  }>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeLocalAssetStatus(value: unknown): string {
  if (typeof value === 'number') {
    switch (value) {
    case LOCAL_ASSET_STATUS_ACTIVE:
      return 'active';
    case LOCAL_ASSET_STATUS_INSTALLED:
      return 'installed';
    case LOCAL_ASSET_STATUS_UNHEALTHY:
      return 'unhealthy';
    case LOCAL_ASSET_STATUS_REMOVED:
      return 'removed';
    default:
      return '';
    }
  }
  return normalizeText(value).toLowerCase();
}

function textCapabilitySupported(capabilities: string[]): boolean {
  return capabilities.some((capability) => {
    const normalized = String(capability || '').trim().toLowerCase();
    return normalized === 'chat' || normalized === 'text.generate';
  });
}

export function createPolyinfoAIScopeRef(): AIScopeRef {
  return {
    kind: 'app',
    ownerId: 'polyinfo',
    surfaceId: 'chat',
  };
}

export function getTextGenerateBinding(config: AIConfig): RuntimeRouteBinding | null {
  const binding = config.capabilities.selectedBindings['text.generate'];
  return binding ? { ...binding } : null;
}

export function updateTextGenerateBinding(
  config: AIConfig,
  binding: RuntimeRouteBinding | null,
): AIConfig {
  const nextBindings = {
    ...config.capabilities.selectedBindings,
  };
  if (binding) {
    nextBindings['text.generate'] = binding;
  } else {
    delete nextBindings['text.generate'];
  }
  return {
    ...config,
    capabilities: {
      ...config.capabilities,
      selectedBindings: nextBindings,
    },
  };
}

function createLocalBindingFromOption(option: RuntimeRouteLocalOption): RuntimeRouteBinding {
  return {
    source: 'local',
    connectorId: '',
    model: option.model,
    modelId: option.modelId,
    localModelId: option.localModelId,
    endpoint: option.endpoint,
    provider: option.provider,
    engine: option.engine,
    goRuntimeLocalModelId: option.goRuntimeLocalModelId,
    goRuntimeStatus: option.goRuntimeStatus || option.status,
  };
}

function findMatchingLocalOption(
  binding: RuntimeRouteBinding | null | undefined,
  localModels: RuntimeRouteLocalOption[],
): RuntimeRouteLocalOption | null {
  if (!binding || binding.source !== 'local') {
    return null;
  }
  const bindingLocalModelId = normalizeText(binding.localModelId || binding.goRuntimeLocalModelId);
  if (bindingLocalModelId) {
    const byLocalId = localModels.find((item) => normalizeText(item.localModelId || item.goRuntimeLocalModelId) === bindingLocalModelId);
    if (byLocalId) {
      return byLocalId;
    }
  }
  const bindingModelId = normalizeText(binding.modelId || binding.model);
  if (!bindingModelId) {
    return null;
  }
  return localModels.find((item) => normalizeText(item.modelId || item.model) === bindingModelId) || null;
}

function findMatchingCloudConnector(
  binding: RuntimeRouteBinding | null | undefined,
  connectors: RuntimeRouteConnectorOption[],
): RuntimeRouteConnectorOption | null {
  if (!binding || binding.source !== 'cloud') {
    return null;
  }
  const connectorId = normalizeText(binding.connectorId);
  if (!connectorId) {
    return null;
  }
  return connectors.find((item) => normalizeText(item.id) === connectorId) || null;
}

export function readRuntimeDefaultBinding(defaults?: RuntimeDefaults | null): RuntimeRouteBinding | null {
  if (!defaults) {
    return null;
  }
  const connectorId = normalizeText(defaults.runtime.connectorId);
  const localModel = normalizeText(defaults.runtime.localProviderModel);
  if (connectorId) {
    return {
      source: 'cloud',
      connectorId,
      model: 'auto',
      provider: normalizeText(defaults.runtime.provider) || undefined,
    };
  }
  if (localModel) {
    return {
      source: 'local',
      connectorId: '',
      model: localModel,
      modelId: localModel,
      localModelId: localModel,
      endpoint: normalizeText(defaults.runtime.localProviderEndpoint) || undefined,
      provider: normalizeText(defaults.runtime.provider) || undefined,
      engine: normalizeText(defaults.runtime.provider) || undefined,
      goRuntimeLocalModelId: localModel,
    };
  }
  return null;
}

function bindingFromLegacySettings(defaults?: RuntimeDefaults | null): RuntimeRouteBinding | null {
  const legacy = loadSavedAnalystRuntimeSettings();
  if (!legacy) {
    return null;
  }
  clearLegacyAnalystRuntimeSettings();
  if (legacy.route === 'cloud') {
    const connectorId = normalizeText(legacy.cloudConnectorId) || normalizeText(defaults?.runtime.connectorId);
    if (!connectorId) {
      return null;
    }
    return {
      source: 'cloud',
      connectorId,
      model: normalizeText(legacy.cloudModel) || 'auto',
      provider: normalizeText(defaults?.runtime.provider) || undefined,
    };
  }
  const localModel = normalizeText(legacy.localModel)
    || normalizeText(defaults?.runtime.localProviderModel)
    || 'auto';
  return {
    source: 'local',
    connectorId: '',
    model: localModel,
    modelId: localModel,
    localModelId: localModel,
    endpoint: normalizeText(defaults?.runtime.localProviderEndpoint) || undefined,
    provider: normalizeText(defaults?.runtime.provider) || undefined,
    engine: normalizeText(defaults?.runtime.provider) || undefined,
    goRuntimeLocalModelId: localModel,
  };
}

export function loadPersistedAIConfig(defaults?: RuntimeDefaults | null): AIConfig {
  const empty = createEmptyAIConfig(createPolyinfoAIScopeRef());
  if (typeof window === 'undefined') {
    return empty;
  }
  try {
    const raw = window.localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AIConfig>;
      return {
        ...empty,
        ...parsed,
        scopeRef: createPolyinfoAIScopeRef(),
        capabilities: {
          ...empty.capabilities,
          ...(parsed.capabilities || {}),
          selectedBindings: {
            ...empty.capabilities.selectedBindings,
            ...((parsed.capabilities?.selectedBindings || {}) as Record<string, RuntimeRouteBinding | null>),
          },
        },
      };
    }
  } catch {
    // Fall through to migration/defaults.
  }

  const migrated = bindingFromLegacySettings(defaults);
  if (!migrated) {
    return empty;
  }
  const next = updateTextGenerateBinding(empty, migrated);
  savePersistedAIConfig(next);
  return next;
}

export function savePersistedAIConfig(config: AIConfig): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify({
    ...config,
    scopeRef: createPolyinfoAIScopeRef(),
  }));
}

export async function fetchRuntimeCloudConnectors(): Promise<RuntimeRouteConnectorOption[]> {
  const runtimeAdmin = getPlatformClient().domains.runtimeAdmin;
  const response = await runtimeAdmin.listConnectors({
    pageSize: 0,
    pageToken: '',
    kindFilter: CONNECTOR_KIND_REMOTE_MANAGED,
    statusFilter: 0,
    providerFilter: '',
  }, {
    timeoutMs: 5000,
    metadata: {
      callerKind: 'third-party-app',
      callerId: 'polyinfo.runtime-config',
      surfaceId: 'polyinfo.runtime',
    },
  });

  const connectors = Array.isArray(response.connectors)
    ? (response.connectors as RuntimeConnectorLike[])
    : [];

  const remoteConnectors = connectors.filter((connector) => connector.kind === CONNECTOR_KIND_REMOTE_MANAGED);

  return Promise.all(remoteConnectors.map(async (connector) => {
    const models = await fetchConnectorModels(normalizeText(connector.connectorId));
    return {
      id: normalizeText(connector.connectorId),
      label: normalizeText(connector.label) || normalizeText(connector.provider) || 'Connector',
      provider: normalizeText(connector.provider),
      vendor: normalizeText(connector.provider) || undefined,
      models: models.map((item) => item.modelId),
      modelCapabilities: Object.fromEntries(models.map((item) => [item.modelId, item.capabilities])),
    } satisfies RuntimeRouteConnectorOption;
  })).then((items) => items.filter((item) => item.id));
}

async function fetchConnectorModels(connectorId: string): Promise<Array<{ modelId: string; capabilities: string[] }>> {
  if (!connectorId) {
    return [];
  }
  const runtimeAdmin = getPlatformClient().domains.runtimeAdmin;
  const models: Array<{ modelId: string; capabilities: string[] }> = [];
  const seen = new Set<string>();
  let pageToken = '';

  for (let pageIndex = 0; pageIndex < CONNECTOR_MODELS_MAX_PAGES; pageIndex += 1) {
    const response = await runtimeAdmin.listConnectorModels({
      connectorId,
      forceRefresh: pageIndex === 0,
      pageSize: CONNECTOR_MODELS_PAGE_SIZE,
      pageToken,
    }, {
      timeoutMs: 5000,
      metadata: {
        callerKind: 'third-party-app',
        callerId: 'polyinfo.runtime-config',
        surfaceId: 'polyinfo.runtime',
      },
    });

    const pageModels = Array.isArray(response.models)
      ? (response.models as RuntimeConnectorModelLike[])
      : [];

    for (const model of pageModels) {
      if (model.available === false) {
        continue;
      }
      const modelId = normalizeText(model.modelId);
      if (!modelId || seen.has(modelId)) {
        continue;
      }
      seen.add(modelId);
      models.push({
        modelId,
        capabilities: normalizeArray(model.capabilities),
      });
    }

    pageToken = normalizeText(response.nextPageToken);
    if (!pageToken) {
      break;
    }
  }

  return models.filter((item) => textCapabilitySupported(item.capabilities) || item.capabilities.length === 0);
}

export async function fetchRuntimeLocalModels(): Promise<RuntimeRouteLocalOption[]> {
  const runtime = getPlatformClient().runtime;
  const models: RuntimeRouteLocalOption[] = [];
  const seen = new Set<string>();
  let pageToken = '';

  for (let pageIndex = 0; pageIndex < LOCAL_MODELS_MAX_PAGES; pageIndex += 1) {
    const response = await runtime.local.listLocalAssets({
      statusFilter: 0,
      kindFilter: 0,
      engineFilter: '',
      pageSize: LOCAL_MODELS_PAGE_SIZE,
      pageToken,
    }, {
      timeoutMs: 5000,
      metadata: {
        callerKind: 'third-party-app',
        callerId: 'polyinfo.runtime-config',
        surfaceId: 'polyinfo.runtime',
      },
    });
    const assets = Array.isArray(response.assets) ? response.assets : [];

    for (const rawAsset of assets) {
      const asset = rawAsset as RuntimeLocalAssetLike;
      const capabilities = normalizeArray(asset.capabilities);
      const status = normalizeLocalAssetStatus(asset.status);
      if (status === 'removed' || !textCapabilitySupported(capabilities)) {
        continue;
      }
      const localModelId = normalizeText(asset.localAssetId || asset.localModelId || asset.assetId);
      const model = normalizeText(asset.logicalModelId || asset.modelId || asset.assetId || localModelId);
      if (!localModelId || !model || seen.has(localModelId)) {
        continue;
      }
      seen.add(localModelId);
      models.push({
        localModelId,
        label: normalizeText(asset.title || asset.label || asset.logicalModelId || asset.assetId) || model,
        engine: normalizeText(asset.engine) || 'llama',
        model,
        modelId: model,
        provider: normalizeText(asset.engine) || undefined,
        endpoint: normalizeText(asset.endpoint) || undefined,
        status: status || undefined,
        goRuntimeLocalModelId: localModelId,
        goRuntimeStatus: status || undefined,
        capabilities,
      });
    }

    pageToken = normalizeText((response as { nextPageToken?: string }).nextPageToken);
    if (!pageToken) {
      break;
    }
  }

  return models.sort((left, right) => {
    const leftScore = left.status === 'active' ? 0 : left.status === 'installed' ? 1 : 2;
    const rightScore = right.status === 'active' ? 0 : right.status === 'installed' ? 1 : 2;
    return leftScore - rightScore || left.label?.localeCompare(right.label || '') || 0;
  });
}

export async function loadTextGenerateRouteOptions(input: {
  aiConfig: AIConfig;
  runtimeDefaults?: RuntimeDefaults | null;
}): Promise<RuntimeRouteOptionsSnapshot> {
  const [localModels, connectors] = await Promise.all([
    fetchRuntimeLocalModels(),
    fetchRuntimeCloudConnectors(),
  ]);
  return buildRuntimeRouteOptionsSnapshot({
    capability: 'text.generate',
    selectedBinding: getTextGenerateBinding(input.aiConfig),
    localModels,
    connectors,
    defaultLocalEndpoint: normalizeText(input.runtimeDefaults?.runtime.localProviderEndpoint),
    runtimeDefaultEngine: normalizeText(input.runtimeDefaults?.runtime.provider),
  });
}

export async function fetchRuntimeHealthSummary(): Promise<RuntimeHealthSummary> {
  const runtimeAdmin = getPlatformClient().domains.runtimeAdmin;
  const [runtimeHealth, providerHealth] = await Promise.all([
    runtimeAdmin.getRuntimeHealth({}, { timeoutMs: 5000 }),
    runtimeAdmin.listAIProviderHealth({}, { timeoutMs: 5000 }),
  ]);

  return {
    runtimeHealth: runtimeHealth
      ? {
        status: normalizeText(runtimeHealth.status) || 'unknown',
        reason: normalizeText(runtimeHealth.reason),
        queueDepth: Number(runtimeHealth.queueDepth) || 0,
        activeWorkflows: Number(runtimeHealth.activeWorkflows) || 0,
        activeInferenceJobs: Number(runtimeHealth.activeInferenceJobs) || 0,
      }
      : null,
    providers: Array.isArray(providerHealth.providers)
      ? providerHealth.providers.map((provider) => ({
        providerName: normalizeText(provider.providerName) || 'unknown',
        state: normalizeText(provider.state) || 'unknown',
        reason: normalizeText(provider.reason) || undefined,
      }))
      : [],
  };
}

export function summarizeRuntimeBinding(
  binding: RuntimeRouteBinding | null | undefined,
  daemonStatus?: RuntimeBridgeDaemonStatus | null,
): {
  title: string;
  detail: string;
  ready: boolean;
} {
  if (!binding) {
    return {
      title: '未配置',
      detail: '先去 Runtime 页面选择本地模型或云端连接器。',
      ready: false,
    };
  }
  if (binding.source === 'cloud') {
    const connectorId = normalizeText(binding.connectorId);
    const model = normalizeText(binding.modelId || binding.model) || 'auto';
    return {
      title: `云端 · ${model}`,
      detail: connectorId ? `连接器 ${connectorId}` : '缺少连接器',
      ready: Boolean(connectorId),
    };
  }
  const model = normalizeText(binding.modelId || binding.model || binding.localModelId) || 'auto';
  const daemonReady = !daemonStatus || daemonStatus.running;
  const localStatus = normalizeText(binding.goRuntimeStatus);
  if (LOCAL_ROUTE_BLOCKED_STATUSES.has(localStatus)) {
    return {
      title: `本地 · ${model}`,
      detail: '当前本地模型不可用，请去 Runtime 页面重新选择。',
      ready: false,
    };
  }
  return {
    title: `本地 · ${model}`,
    detail: daemonReady ? '通过 runtime 本地链路执行' : 'runtime 当前未运行',
    ready: daemonReady,
  };
}

export type TextGenerateRouteStatus = {
  binding: RuntimeRouteBinding | null;
  source: 'selected' | 'runtime-default' | 'fallback' | 'none';
  blockingReason:
    | 'none'
    | 'loading'
    | 'missing'
    | 'daemon-offline'
    | 'local-unavailable'
    | 'cloud-auth-required'
    | 'cloud-connector-missing'
    | 'cloud-model-missing';
  title: string;
  detail: string;
  ready: boolean;
};

export function resolveTextGenerateRouteStatus(input: {
  aiConfig: AIConfig;
  runtimeDefaults?: RuntimeDefaults | null;
  routeOptions?: RuntimeRouteOptionsSnapshot | null;
  daemonStatus?: RuntimeBridgeDaemonStatus | null;
  authStatus?: 'bootstrapping' | 'authenticated' | 'anonymous';
}): TextGenerateRouteStatus {
  const selectedBinding = getTextGenerateBinding(input.aiConfig);
  const localModels = input.routeOptions?.local.models ?? [];
  const connectors = input.routeOptions?.connectors ?? [];

  let binding: RuntimeRouteBinding | null = null;
  let source: TextGenerateRouteStatus['source'] = 'none';

  if (selectedBinding) {
    source = 'selected';
    binding = input.routeOptions?.selected ?? selectedBinding;
  } else {
    const runtimeDefaultBinding = readRuntimeDefaultBinding(input.runtimeDefaults);
    const defaultSource = runtimeDefaultBinding?.source;
    if (runtimeDefaultBinding && input.routeOptions) {
      if (defaultSource === 'local') {
        const matchedLocal = findMatchingLocalOption(runtimeDefaultBinding, localModels);
        if (matchedLocal) {
          binding = createLocalBindingFromOption(matchedLocal);
          source = 'runtime-default';
        }
      } else if (defaultSource === 'cloud') {
        const matchedConnector = findMatchingCloudConnector(runtimeDefaultBinding, connectors);
        if (matchedConnector) {
          binding = buildRuntimeRouteSelectedBinding({
            capability: 'text.generate',
            selectedBinding: runtimeDefaultBinding,
            localModels,
            connectors,
            runtimeDefaultEngine: normalizeText(input.runtimeDefaults?.runtime.provider),
          });
          source = 'runtime-default';
        }
      }
    } else if (runtimeDefaultBinding) {
      binding = runtimeDefaultBinding;
      source = 'runtime-default';
    }

    if (!binding) {
      binding = input.routeOptions?.resolvedDefault ?? null;
      source = binding ? 'fallback' : 'none';
    }
  }

  if (!input.routeOptions) {
    const summary = summarizeRuntimeBinding(binding, input.daemonStatus);
    return {
      binding,
      source,
      blockingReason: binding ? 'loading' : 'missing',
      title: summary.title,
      detail: binding ? '正在读取当前可用路由，请稍等。' : summary.detail,
      ready: false,
    };
  }

  if (!binding) {
    return {
      binding: null,
      source: 'none',
      blockingReason: 'missing',
      title: '未配置',
      detail: '当前没有可用聊天路由，请去 Runtime 页面选择本地模型或云端连接器。',
      ready: false,
    };
  }

  if (binding.source === 'local') {
    const daemonReady = !input.daemonStatus || input.daemonStatus.running;
    if (!daemonReady) {
      return {
        binding,
        source,
        blockingReason: 'daemon-offline',
        title: `本地 · ${normalizeText(binding.modelId || binding.model || binding.localModelId) || 'auto'}`,
        detail: 'runtime 当前未运行，请先启动后再聊天。',
        ready: false,
      };
    }
    const matchedLocal = findMatchingLocalOption(binding, localModels);
    const localStatus = normalizeText(matchedLocal?.status || matchedLocal?.goRuntimeStatus || binding.goRuntimeStatus);
    if (!matchedLocal || LOCAL_ROUTE_BLOCKED_STATUSES.has(localStatus)) {
      return {
        binding,
        source,
        blockingReason: 'local-unavailable',
        title: `本地 · ${normalizeText(binding.modelId || binding.model || binding.localModelId) || 'auto'}`,
        detail: '当前选择的本地模型不可用，请去 Runtime 页面重新选择。',
        ready: false,
      };
    }
    return {
      binding: createLocalBindingFromOption(matchedLocal),
      source,
      blockingReason: 'none',
      title: `本地 · ${normalizeText(matchedLocal.modelId || matchedLocal.model) || 'auto'}`,
      detail: source === 'selected'
        ? '当前会按你手动选择的本地模型执行。'
        : '当前会按可用的本地模型执行。',
      ready: true,
    };
  }

  const connector = findMatchingCloudConnector(binding, connectors);
  if (!connector) {
    return {
      binding,
      source,
      blockingReason: 'cloud-connector-missing',
      title: `云端 · ${normalizeText(binding.modelId || binding.model) || 'auto'}`,
      detail: '当前选择的云端连接器已经不可用，请去 Runtime 页面重新选择。',
      ready: false,
    };
  }

  const model = normalizeText(binding.modelId || binding.model) || 'auto';
  if (model !== 'auto' && connector.models.length > 0 && !connector.models.includes(model)) {
    return {
      binding,
      source,
      blockingReason: 'cloud-model-missing',
      title: `云端 · ${model}`,
      detail: '当前选择的云端模型已经不可用，请去 Runtime 页面重新选择。',
      ready: false,
    };
  }

  if (input.authStatus !== 'authenticated') {
    return {
      binding: {
        ...binding,
        connectorId: connector.id,
        provider: binding.provider || connector.provider,
      },
      source,
      blockingReason: 'cloud-auth-required',
      title: `云端 · ${model}`,
      detail: '当前是云端路由。Polyinfo 会像 Desktop 一样复用登录态；请先去 Settings 登录。',
      ready: false,
    };
  }

  return {
    binding: {
      ...binding,
      connectorId: connector.id,
      provider: binding.provider || connector.provider,
    },
    source,
    blockingReason: 'none',
    title: `云端 · ${model}`,
    detail: source === 'selected'
      ? `当前会按你手动选择的连接器 ${connector.id} 执行。`
      : `当前会按连接器 ${connector.id} 执行。`,
    ready: true,
  };
}
