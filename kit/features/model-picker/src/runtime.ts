import {
  createRuntimeModelCatalogClient,
  getPlatformClient,
  listRuntimeRouteOptions,
  type RuntimeCatalogModelDetail,
  type RuntimeCatalogModelDetailResponse,
  type RuntimeCatalogModelSource,
  type RuntimeCatalogModelSummary,
  type RuntimeCatalogOverlayWarning,
  type RuntimeCatalogProviderModelsResponse,
  type RuntimeModelCatalogClient,
  type RuntimeModelCatalogProvider,
  type RuntimeCanonicalCapability,
  type RuntimeRouteOptionsSnapshot,
  type RuntimeRouteOptionsClient,
  type ListRuntimeRouteOptionsInput,
} from '@nimiplatform/kit/core/sdk-contract';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useModelPicker, type UseModelPickerOptions, type UseModelPickerResult } from './headless.js';
import { createSnapshotRouteDataProvider, type RouteModelPickerDataProvider } from './route-data.js';
import type { ModelCatalogAdapter } from './types.js';

export type { RouteModelPickerDataProvider } from './route-data.js';

export type {
  RuntimeCatalogModelDetail,
  RuntimeCatalogModelDetailResponse,
  RuntimeCatalogModelSummary,
  RuntimeCatalogOverlayWarning,
  RuntimeCatalogPricing,
  RuntimeCatalogProviderModelsResponse,
  RuntimeCatalogSourceRef,
  RuntimeCatalogVideoGeneration,
  RuntimeCatalogVoiceEntry,
  RuntimeCatalogWorkflowBinding,
  RuntimeCatalogWorkflowModel,
  RuntimeModelCatalogProvider,
  RuntimeModelCatalogProviderSource,
} from '@nimiplatform/kit/core/sdk-contract';

const CATALOG_CALL_OPTIONS = {
  timeoutMs: 8000,
  metadata: {
    callerKind: 'third-party-app' as const,
    callerId: 'nimi-kit.model-picker.runtime',
    surfaceId: 'kit.features.model-picker',
  },
};

export type RuntimeModelCatalogSource = RuntimeCatalogModelSource;

export type RuntimeRouteModelPickerClient = RuntimeRouteOptionsClient;

export type RuntimeRouteModelPickerProviderOptions = {
  capability: string;
  client?: RuntimeRouteModelPickerClient | null;
  getClient?: () => RuntimeRouteModelPickerClient | null | Promise<RuntimeRouteModelPickerClient | null>;
  loadOptions?: (
    input: ListRuntimeRouteOptionsInput,
  ) => RuntimeRouteOptionsSnapshot | Promise<RuntimeRouteOptionsSnapshot>;
  targetId?: string;
  selectedBinding?: Parameters<typeof listRuntimeRouteOptions>[1]['selectedBinding'];
  unavailableMessage?: string;
};

export type RuntimeRouteModelPickerProviderCacheOptions = Omit<
  RuntimeRouteModelPickerProviderOptions,
  'capability'
>;

function resolveRouteCapability(capability: string): RuntimeCanonicalCapability {
  const normalized = String(capability || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('Runtime route capability is required.');
  }
  return normalized as RuntimeCanonicalCapability;
}

async function resolveRouteModelPickerClient(
  input: Pick<RuntimeRouteModelPickerProviderOptions, 'client' | 'getClient' | 'unavailableMessage'>,
): Promise<RuntimeRouteModelPickerClient> {
  const client = input.client ?? (input.getClient ? await input.getClient() : getPlatformClient());
  if (!client) {
    throw new Error(input.unavailableMessage || 'Runtime route model picker client is unavailable.');
  }
  return client;
}

/**
 * Create a Kit-owned route model-picker provider backed by the SDK
 * `runtime.route.listOptions` projection. Runtime/SDK remain the source for
 * route availability; Kit owns only the reusable picker adapter and snapshot
 * cache consumed by apps.
 */
export function createRuntimeRouteModelPickerProvider(
  input: RuntimeRouteModelPickerProviderOptions,
): RouteModelPickerDataProvider {
  const capability = resolveRouteCapability(input.capability);
  return createSnapshotRouteDataProvider(async () => {
    const optionsInput = {
      capability,
      targetId: input.targetId,
      selectedBinding: input.selectedBinding,
    };
    if (input.loadOptions) {
      return input.loadOptions(optionsInput);
    }
    const client = await resolveRouteModelPickerClient(input);
    return listRuntimeRouteOptions(client, optionsInput);
  });
}

/**
 * Create a per-capability provider cache for app settings and chat surfaces.
 * Empty capability tokens return null so apps can fail closed at the existing
 * "no provider" UI boundary instead of keeping local cache logic. Unknown
 * non-empty tokens still flow to SDK/Runtime, where capability support is the
 * authoritative fail-closed decision.
 */
export function createRuntimeRouteModelPickerProviderCache(
  options: RuntimeRouteModelPickerProviderCacheOptions = {},
): (capability: string) => RouteModelPickerDataProvider | null {
  const providerCache = new Map<string, RouteModelPickerDataProvider | null>();
  return (capability: string): RouteModelPickerDataProvider | null => {
    const normalized = String(capability || '').trim();
    if (!normalized) {
      return null;
    }
    if (providerCache.has(normalized)) {
      return providerCache.get(normalized) || null;
    }
    try {
      const provider = createRuntimeRouteModelPickerProvider({
        ...options,
        capability: normalized,
      });
      providerCache.set(normalized, provider);
      return provider;
    } catch {
      providerCache.set(normalized, null);
      return null;
    }
  };
}

export type RuntimeModelCatalogService = {
  listProviders: () => Promise<RuntimeModelCatalogProvider[]>;
  listProviderModels: (provider: string, pageSize?: number, pageToken?: string) => Promise<RuntimeCatalogProviderModelsResponse>;
  getModelDetail: (provider: string, modelId: string) => Promise<RuntimeCatalogModelDetailResponse>;
};

function runtimeAdmin() {
  return getPlatformClient().domains.runtimeAdmin;
}

export const runtimeModelCatalogService: RuntimeModelCatalogService = createRuntimeModelCatalogClient({
  connector: runtimeAdmin,
  callOptions: CATALOG_CALL_OPTIONS,
}) satisfies RuntimeModelCatalogClient;

export type RuntimeModelCatalogAdapterOptions = {
  provider: string;
  service?: RuntimeModelCatalogService;
  pageSize?: number;
  pageToken?: string;
};

export function createRuntimeModelCatalogAdapter({
  provider,
  service = runtimeModelCatalogService,
  pageSize = 500,
  pageToken = '',
}: RuntimeModelCatalogAdapterOptions): ModelCatalogAdapter<RuntimeCatalogModelSummary> {
  return {
    listModels: async () => {
      if (!provider.trim()) {
        return [];
      }
      const response = await service.listProviderModels(provider, pageSize, pageToken);
      return response.models;
    },
    getId: (model) => model.modelId,
    getTitle: (model) => model.modelId,
    getDescription: (model) => model.sourceNote || `${model.modelType || 'unknown'} model`,
    getCapabilities: (model) => model.capabilities,
    getBadges: (model) => [
      { label: model.modelType || 'unknown', tone: 'accent' },
      ...(model.hasVoiceCatalog ? [{ label: 'Voice Catalog', tone: 'success' as const }] : []),
      ...(model.hasVideoGeneration ? [{ label: 'Video Gen', tone: 'warning' as const }] : []),
      ...(model.userScoped ? [{ label: 'Personal', tone: 'neutral' as const }] : []),
    ],
    getSource: (model) => model.source,
    getSearchText: (model) => [
      model.provider,
      model.modelType,
      model.sourceNote,
      model.userScoped ? 'personal user scoped' : 'shared provider',
      model.hasVoiceCatalog ? 'voice voices audio' : '',
      model.hasVideoGeneration ? 'video motion' : '',
    ].filter(Boolean).join(' '),
    getGroupKey: (model) => model.source,
    getGroupLabel: (groupKey, groupModels) => {
      if (groupKey === 'builtin') return `Builtin (${groupModels.length})`;
      if (groupKey === 'custom') return `Custom (${groupModels.length})`;
      if (groupKey === 'overridden') return `Overridden (${groupModels.length})`;
      return `${groupKey} (${groupModels.length})`;
    },
    getDetailRows: (model) => [
      { label: 'Model Type', value: model.modelType || 'unknown' },
      { label: 'Updated At', value: model.updatedAt || 'n/a' },
      { label: 'Visibility', value: model.userScoped ? 'Only visible to current user' : 'Provider overlay / builtin' },
    ],
  };
}

export type UseRuntimeModelPickerOptions = Omit<UseModelPickerOptions<RuntimeCatalogModelSummary>, 'adapter'> & RuntimeModelCatalogAdapterOptions;

export type UseRuntimeModelPickerPanelOptions = UseRuntimeModelPickerOptions & {
  detailService?: RuntimeModelCatalogService;
};

export type UseRuntimeModelPickerPanelResult = {
  pickerState: UseModelPickerResult<RuntimeCatalogModelSummary>;
  detail: RuntimeCatalogModelDetail | null;
  detailProvider: RuntimeModelCatalogProvider | null;
  detailWarnings: readonly RuntimeCatalogOverlayWarning[];
  isDetailLoading: boolean;
  detailError: string | null;
  refreshDetail: () => Promise<void>;
};

export function useRuntimeModelPicker({
  provider,
  service = runtimeModelCatalogService,
  pageSize = 500,
  pageToken = '',
  selectedId,
  initialSelectedId,
  onSelectModel,
}: UseRuntimeModelPickerOptions): UseModelPickerResult<RuntimeCatalogModelSummary> {
  const adapter = useMemo(
    () => createRuntimeModelCatalogAdapter({ provider, service, pageSize, pageToken }),
    [pageSize, pageToken, provider, service],
  );
  return useModelPicker({
    adapter,
    selectedId,
    initialSelectedId,
    onSelectModel,
  });
}

export function useRuntimeModelPickerPanel({
  provider,
  service = runtimeModelCatalogService,
  detailService = service,
  pageSize = 500,
  pageToken = '',
  selectedId,
  initialSelectedId,
  onSelectModel,
}: UseRuntimeModelPickerPanelOptions): UseRuntimeModelPickerPanelResult {
  const pickerState = useRuntimeModelPicker({
    provider,
    service,
    pageSize,
    pageToken,
    selectedId,
    initialSelectedId,
    onSelectModel,
  });
  const [detail, setDetail] = useState<RuntimeCatalogModelDetail | null>(null);
  const [detailProvider, setDetailProvider] = useState<RuntimeModelCatalogProvider | null>(null);
  const [detailWarnings, setDetailWarnings] = useState<readonly RuntimeCatalogOverlayWarning[]>([]);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const refreshDetail = useCallback(async () => {
    if (!provider.trim() || !pickerState.selectedId.trim()) {
      setDetail(null);
      setDetailProvider(null);
      setDetailWarnings([]);
      setDetailError(null);
      return;
    }
    setIsDetailLoading(true);
    setDetailError(null);
    try {
      const response = await detailService.getModelDetail(provider, pickerState.selectedId);
      setDetail(response.model);
      setDetailProvider(response.provider);
      setDetailWarnings(response.warnings);
    } catch (error) {
      setDetail(null);
      setDetailProvider(null);
      setDetailWarnings([]);
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDetailLoading(false);
    }
  }, [detailService, pickerState.selectedId, provider]);

  useEffect(() => {
    void refreshDetail();
  }, [refreshDetail]);

  return {
    pickerState,
    detail,
    detailProvider,
    detailWarnings,
    isDetailLoading,
    detailError,
    refreshDetail,
  };
}
