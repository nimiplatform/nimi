import { getPlatformClient } from '@nimiplatform/sdk';
import {
  CatalogModelSource,
  ModelCatalogProviderSource,
  type CatalogModelDetail,
  type CatalogOverlayWarning,
  type CatalogPricing,
  type CatalogSourceRef,
  type CatalogVideoGenerationCapability,
  type CatalogVoiceEntry,
  type CatalogWorkflowModel,
  type CatalogModelWorkflowBinding,
  type CatalogModelSummary,
  type ModelCatalogProviderEntry,
} from '@nimiplatform/sdk/runtime';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useModelPicker, type UseModelPickerOptions, type UseModelPickerResult } from './headless.js';
import type { ModelCatalogAdapter } from './types.js';

const CATALOG_CALL_OPTIONS = {
  timeoutMs: 8000,
  metadata: {
    callerKind: 'third-party-app' as const,
    callerId: 'nimi-kit.model-picker.runtime',
    surfaceId: 'kit.features.model-picker',
  },
};

type JsonObject = Record<string, unknown>;
type ProtoStruct = {
  fields: Record<string, ProtoValue>;
};

type ProtoValue =
  | { kind: { oneofKind: 'nullValue'; nullValue: 0 } }
  | { kind: { oneofKind: 'numberValue'; numberValue: number } }
  | { kind: { oneofKind: 'stringValue'; stringValue: string } }
  | { kind: { oneofKind: 'boolValue'; boolValue: boolean } }
  | { kind: { oneofKind: 'structValue'; structValue: ProtoStruct } }
  | { kind: { oneofKind: 'listValue'; listValue: { values: ProtoValue[] } } }
  | { kind: { oneofKind: undefined } };

export type RuntimeModelCatalogProviderSource = 'builtin' | 'custom' | 'overridden' | 'remote' | 'unknown';
export type RuntimeModelCatalogSource = 'builtin' | 'custom' | 'overridden' | 'unknown';

export type RuntimeCatalogOverlayWarning = {
  code: string;
  message: string;
};

export type RuntimeCatalogPricing = {
  unit: string;
  input: string;
  output: string;
  currency: string;
  asOf: string;
  notes: string;
};

export type RuntimeCatalogSourceRef = {
  url: string;
  retrievedAt: string;
  note: string;
};

export type RuntimeCatalogVoiceEntry = {
  voiceSetId: string;
  provider: string;
  voiceId: string;
  name: string;
  langs: string[];
  modelIds: string[];
  sourceRef: RuntimeCatalogSourceRef;
};

export type RuntimeCatalogWorkflowModel = {
  workflowModelId: string;
  workflowType: string;
  inputContractRef: string;
  outputPersistence: string;
  targetModelRefs: string[];
  langs: string[];
  sourceRef: RuntimeCatalogSourceRef;
};

export type RuntimeCatalogWorkflowBinding = {
  modelId: string;
  workflowModelRefs: string[];
  workflowTypes: string[];
};

export type RuntimeCatalogVideoGeneration = {
  modes: string[];
  inputRoles: Array<{ key: string; values: string[] }>;
  limits: JsonObject;
  optionSupports: string[];
  optionConstraints: JsonObject;
  outputs: { videoUrl: boolean; lastFrameUrl: boolean };
};

export type RuntimeModelCatalogProvider = {
  provider: string;
  version: number;
  catalogVersion: string;
  source: RuntimeModelCatalogProviderSource;
  inventoryMode: string;
  modelCount: number;
  voiceCount: number;
  defaultTextModel: string;
  capabilities: string[];
  hasOverlay: boolean;
  customModelCount: number;
  overriddenModelCount: number;
  overlayUpdatedAt: string;
  yaml: string;
  effectiveYaml: string;
  defaultEndpoint: string;
  requiresExplicitEndpoint: boolean;
  runtimePlane: string;
  executionModule: string;
  managedSupported: boolean;
};

export type RuntimeCatalogModelSummary = {
  provider: string;
  modelId: string;
  modelType: string;
  updatedAt: string;
  capabilities: string[];
  source: RuntimeModelCatalogSource;
  userScoped: boolean;
  sourceNote: string;
  hasVoiceCatalog: boolean;
  hasVideoGeneration: boolean;
};

export type RuntimeCatalogModelDetail = RuntimeCatalogModelSummary & {
  pricing: RuntimeCatalogPricing;
  voiceSetId: string;
  voiceDiscoveryMode: string;
  voiceRefKinds: string[];
  videoGeneration: RuntimeCatalogVideoGeneration | null;
  sourceRef: RuntimeCatalogSourceRef;
  warnings: RuntimeCatalogOverlayWarning[];
  voices: RuntimeCatalogVoiceEntry[];
  voiceWorkflowModels: RuntimeCatalogWorkflowModel[];
  modelWorkflowBinding: RuntimeCatalogWorkflowBinding | null;
};

export type RuntimeCatalogProviderModelsResponse = {
  provider: RuntimeModelCatalogProvider;
  models: RuntimeCatalogModelSummary[];
  nextPageToken: string;
  warnings: RuntimeCatalogOverlayWarning[];
};

export type RuntimeCatalogModelDetailResponse = {
  provider: RuntimeModelCatalogProvider;
  model: RuntimeCatalogModelDetail;
  warnings: RuntimeCatalogOverlayWarning[];
};

export type RuntimeModelCatalogService = {
  listProviders: () => Promise<RuntimeModelCatalogProvider[]>;
  listProviderModels: (provider: string, pageSize?: number, pageToken?: string) => Promise<RuntimeCatalogProviderModelsResponse>;
  getModelDetail: (provider: string, modelId: string) => Promise<RuntimeCatalogModelDetailResponse>;
};

function mapProviderSource(source: ModelCatalogProviderSource): RuntimeModelCatalogProviderSource {
  if (source === ModelCatalogProviderSource.BUILTIN) return 'builtin';
  if (source === ModelCatalogProviderSource.CUSTOM) return 'custom';
  if (source === ModelCatalogProviderSource.OVERRIDDEN) return 'overridden';
  if (source === ModelCatalogProviderSource.REMOTE) return 'remote';
  return 'unknown';
}

function mapModelSource(source: CatalogModelSource): RuntimeModelCatalogSource {
  if (source === CatalogModelSource.BUILTIN) return 'builtin';
  if (source === CatalogModelSource.CUSTOM) return 'custom';
  if (source === CatalogModelSource.OVERRIDDEN) return 'overridden';
  return 'unknown';
}

function normalizeWarnings(warnings: CatalogOverlayWarning[] | undefined): RuntimeCatalogOverlayWarning[] {
  return (warnings || []).map((warning) => ({
    code: String(warning.code || '').trim(),
    message: String(warning.message || '').trim(),
  }));
}

function normalizeSourceRef(sourceRef?: CatalogSourceRef): RuntimeCatalogSourceRef {
  return {
    url: String(sourceRef?.url || '').trim(),
    retrievedAt: String(sourceRef?.retrievedAt || '').trim(),
    note: String(sourceRef?.note || '').trim(),
  };
}

function protoStructToJson(value?: ProtoStruct): JsonObject {
  const output: JsonObject = {};
  for (const [key, item] of Object.entries(value?.fields || {})) {
    output[key] = protoValueToJson(item);
  }
  return output;
}

function protoValueToJson(value?: ProtoValue): unknown {
  switch (value?.kind.oneofKind) {
    case 'boolValue':
      return value.kind.boolValue;
    case 'numberValue':
      return value.kind.numberValue;
    case 'stringValue':
      return value.kind.stringValue;
    case 'structValue':
      return protoStructToJson(value.kind.structValue);
    case 'listValue':
      return (value.kind.listValue?.values || []).map(protoValueToJson);
    default:
      return null;
  }
}

export function normalizeRuntimeModelCatalogProvider(entry: ModelCatalogProviderEntry): RuntimeModelCatalogProvider {
  return {
    provider: String(entry.provider || '').trim(),
    version: Number(entry.version || 0),
    catalogVersion: String(entry.catalogVersion || '').trim(),
    source: mapProviderSource(entry.source),
    inventoryMode: String(entry.inventoryMode || '').trim(),
    modelCount: Number(entry.modelCount || 0),
    voiceCount: Number(entry.voiceCount || 0),
    defaultTextModel: String(entry.defaultTextModel || '').trim(),
    capabilities: (entry.capabilities || []).map((item) => String(item || '').trim()).filter(Boolean),
    hasOverlay: Boolean(entry.hasOverlay),
    customModelCount: Number(entry.customModelCount || 0),
    overriddenModelCount: Number(entry.overriddenModelCount || 0),
    overlayUpdatedAt: String(entry.overlayUpdatedAt || '').trim(),
    yaml: String(entry.yaml || '').trim(),
    effectiveYaml: String(entry.effectiveYaml || '').trim(),
    defaultEndpoint: String(entry.defaultEndpoint || '').trim(),
    requiresExplicitEndpoint: Boolean(entry.requiresExplicitEndpoint),
    runtimePlane: String(entry.runtimePlane || '').trim(),
    executionModule: String(entry.executionModule || '').trim(),
    managedSupported: Boolean(entry.managedSupported),
  };
}

export function normalizeRuntimeCatalogModelSummary(entry: CatalogModelSummary): RuntimeCatalogModelSummary {
  return {
    provider: String(entry.provider || '').trim(),
    modelId: String(entry.modelId || '').trim(),
    modelType: String(entry.modelType || '').trim(),
    updatedAt: String(entry.updatedAt || '').trim(),
    capabilities: (entry.capabilities || []).map((item) => String(item || '').trim()).filter(Boolean),
    source: mapModelSource(entry.source),
    userScoped: Boolean(entry.userScoped),
    sourceNote: String(entry.sourceNote || '').trim(),
    hasVoiceCatalog: Boolean(entry.hasVoiceCatalog),
    hasVideoGeneration: Boolean(entry.hasVideoGeneration),
  };
}

function normalizeRuntimeModelCore(entry?: Partial<CatalogModelSummary & CatalogModelDetail>): RuntimeCatalogModelSummary {
  return {
    provider: String(entry?.provider || '').trim(),
    modelId: String(entry?.modelId || '').trim(),
    modelType: String(entry?.modelType || '').trim(),
    updatedAt: String(entry?.updatedAt || '').trim(),
    capabilities: (entry?.capabilities || []).map((item) => String(item || '').trim()).filter(Boolean),
    source: mapModelSource(entry?.source || CatalogModelSource.UNSPECIFIED),
    userScoped: Boolean(entry?.userScoped),
    sourceNote: String(entry?.sourceNote || '').trim(),
    hasVoiceCatalog: Boolean(entry?.hasVoiceCatalog),
    hasVideoGeneration: Boolean(entry?.hasVideoGeneration),
  };
}

function normalizeRuntimeVideoGeneration(video?: CatalogVideoGenerationCapability): RuntimeCatalogVideoGeneration | null {
  if (!video) {
    return null;
  }
  return {
    modes: (video.modes || []).map((item) => String(item || '').trim()).filter(Boolean),
    inputRoles: (video.inputRoles || []).map((item) => ({
      key: String(item.key || '').trim(),
      values: (item.values || []).map((value) => String(value || '').trim()).filter(Boolean),
    })),
    limits: protoStructToJson(video.limits as ProtoStruct | undefined),
    optionSupports: (video.optionSupports || []).map((item) => String(item || '').trim()).filter(Boolean),
    optionConstraints: protoStructToJson(video.optionConstraints as ProtoStruct | undefined),
    outputs: {
      videoUrl: Boolean(video.outputs?.videoUrl),
      lastFrameUrl: Boolean(video.outputs?.lastFrameUrl),
    },
  };
}

export function normalizeRuntimeCatalogModelDetail(entry?: CatalogModelDetail): RuntimeCatalogModelDetail {
  const summary = normalizeRuntimeModelCore(entry);
  return {
    ...summary,
    pricing: {
      unit: String(entry?.pricing?.unit || '').trim(),
      input: String(entry?.pricing?.input || '').trim(),
      output: String(entry?.pricing?.output || '').trim(),
      currency: String(entry?.pricing?.currency || '').trim(),
      asOf: String(entry?.pricing?.asOf || '').trim(),
      notes: String(entry?.pricing?.notes || '').trim(),
    } satisfies RuntimeCatalogPricing,
    voiceSetId: String(entry?.voiceSetId || '').trim(),
    voiceDiscoveryMode: String(entry?.voiceDiscoveryMode || '').trim(),
    voiceRefKinds: (entry?.voiceRefKinds || []).map((item) => String(item || '').trim()).filter(Boolean),
    videoGeneration: normalizeRuntimeVideoGeneration(entry?.videoGeneration),
    sourceRef: normalizeSourceRef(entry?.sourceRef),
    warnings: normalizeWarnings(entry?.warnings),
    voices: (entry?.voices || []).map((voice) => ({
      voiceSetId: String(voice.voiceSetId || '').trim(),
      provider: String(voice.provider || '').trim(),
      voiceId: String(voice.voiceId || '').trim(),
      name: String(voice.name || '').trim(),
      langs: (voice.langs || []).map((item) => String(item || '').trim()).filter(Boolean),
      modelIds: (voice.modelIds || []).map((item) => String(item || '').trim()).filter(Boolean),
      sourceRef: normalizeSourceRef(voice.sourceRef),
    }) satisfies RuntimeCatalogVoiceEntry),
    voiceWorkflowModels: (entry?.voiceWorkflowModels || []).map((workflow) => ({
      workflowModelId: String(workflow.workflowModelId || '').trim(),
      workflowType: String(workflow.workflowType || '').trim(),
      inputContractRef: String(workflow.inputContractRef || '').trim(),
      outputPersistence: String(workflow.outputPersistence || '').trim(),
      targetModelRefs: (workflow.targetModelRefs || []).map((item) => String(item || '').trim()).filter(Boolean),
      langs: (workflow.langs || []).map((item) => String(item || '').trim()).filter(Boolean),
      sourceRef: normalizeSourceRef(workflow.sourceRef),
    }) satisfies RuntimeCatalogWorkflowModel),
    modelWorkflowBinding: entry?.modelWorkflowBinding ? ({
      modelId: String(entry.modelWorkflowBinding.modelId || '').trim(),
      workflowModelRefs: (entry.modelWorkflowBinding.workflowModelRefs || []).map((item) => String(item || '').trim()).filter(Boolean),
      workflowTypes: (entry.modelWorkflowBinding.workflowTypes || []).map((item) => String(item || '').trim()).filter(Boolean),
    } satisfies RuntimeCatalogWorkflowBinding) : null,
  };
}

function runtimeAdmin() {
  return getPlatformClient().domains.runtimeAdmin;
}

export const runtimeModelCatalogService: RuntimeModelCatalogService = {
  async listProviders() {
    const response = await runtimeAdmin().listModelCatalogProviders({}, CATALOG_CALL_OPTIONS);
    return (response.providers || [])
      .map(normalizeRuntimeModelCatalogProvider)
      .sort((left, right) => left.provider.localeCompare(right.provider));
  },
  async listProviderModels(provider: string, pageSize = 500, pageToken = '') {
    const response = await runtimeAdmin().listCatalogProviderModels({
      provider: provider.trim(),
      pageSize,
      pageToken,
    }, CATALOG_CALL_OPTIONS);
    return {
      provider: normalizeRuntimeModelCatalogProvider(response.provider || {} as ModelCatalogProviderEntry),
      models: (response.models || []).map(normalizeRuntimeCatalogModelSummary),
      nextPageToken: String(response.nextPageToken || '').trim(),
      warnings: normalizeWarnings(response.warnings),
    };
  },
  async getModelDetail(provider: string, modelId: string) {
    const response = await runtimeAdmin().getCatalogModelDetail({
      provider: provider.trim(),
      modelId: modelId.trim(),
    }, CATALOG_CALL_OPTIONS);
    return {
      provider: normalizeRuntimeModelCatalogProvider(response.provider || {} as ModelCatalogProviderEntry),
      model: normalizeRuntimeCatalogModelDetail(response.model),
      warnings: normalizeWarnings(response.warnings),
    };
  },
};

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
