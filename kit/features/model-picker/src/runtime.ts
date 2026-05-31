import {
  createRuntimeModelCatalogClient,
  getPlatformClient,
  Runtime,
  type RuntimeCatalogModelDetail,
  type RuntimeCatalogModelDetailResponse,
  type RuntimeCatalogModelSource,
  type RuntimeCatalogModelSummary,
  type RuntimeCatalogOverlayWarning,
  type RuntimeCatalogProviderModelsResponse,
  type RuntimeModelCatalogClient,
  type RuntimeModelCatalogProvider,
} from '@nimiplatform/kit/core/sdk-contract';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useModelPicker, type UseModelPickerOptions, type UseModelPickerResult } from './headless.js';
import type { ModelCatalogAdapter } from './types.js';

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

export type RuntimeModelCatalogService = {
  listProviders: () => Promise<RuntimeModelCatalogProvider[]>;
  listProviderModels: (provider: string, pageSize?: number, pageToken?: string) => Promise<RuntimeCatalogProviderModelsResponse>;
  getModelDetail: (provider: string, modelId: string) => Promise<RuntimeCatalogModelDetailResponse>;
};

function runtimeAdmin() {
  return getPlatformClient().domains.runtimeAdmin;
}

const STALE_BEARER_ANONYMOUS_RETRY_MS = 60_000;
let anonymousRuntime: Runtime | null = null;

function getAnonymousRuntime(): Runtime {
  const runtime = getPlatformClient().runtime;
  if (
    anonymousRuntime
    && anonymousRuntime.appId === runtime.appId
    && anonymousRuntime.transport === runtime.transport
  ) {
    return anonymousRuntime;
  }
  anonymousRuntime = new Runtime({
    appId: runtime.appId,
    transport: runtime.transport,
  });
  return anonymousRuntime;
}

export const runtimeModelCatalogService: RuntimeModelCatalogService = createRuntimeModelCatalogClient({
  connector: runtimeAdmin,
  readConnector: () => getAnonymousRuntime().connector,
  callOptions: CATALOG_CALL_OPTIONS,
  readFallbackTtlMs: STALE_BEARER_ANONYMOUS_RETRY_MS,
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
