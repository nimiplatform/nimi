import { ReasonCode } from '../types/index.js';
import { asNimiError } from '../core/errors.js';
import type { RuntimeCallOptions } from './types.js';
import {
  CatalogModelSource,
  ModelCatalogProviderSource,
  type CatalogModelDetail,
  type CatalogModelInput,
  type CatalogModelSummary,
  type CatalogModelWorkflowBinding,
  type CatalogOverlayWarning,
  type CatalogPricing,
  type CatalogSourceRef,
  type CatalogVideoGenerationCapability,
  type CatalogVoiceEntry,
  type CatalogWorkflowModel,
  type DeleteCatalogModelOverlayResponse,
  type GetCatalogModelDetailResponse,
  type ListCatalogProviderModelsResponse,
  type ListModelCatalogProvidersResponse,
  type ModelCatalogProviderEntry,
  type UpsertCatalogModelOverlayResponse,
  type UpsertModelCatalogProviderResponse,
} from './generated/runtime/v1/connector.js';
import type { RuntimeConnectorClient } from './types-client-interfaces.js';

type JsonObject = Record<string, unknown>;
type JsonValue = unknown;

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
export type RuntimeCatalogModelSource = 'builtin' | 'custom' | 'overridden' | 'unknown';

export type RuntimeCatalogOverlayWarning = { code: string; message: string };
export type RuntimeCatalogPricing = {
  unit: string;
  input: string;
  output: string;
  currency: string;
  asOf: string;
  notes: string;
};
export type RuntimeCatalogSourceRef = { url: string; retrievedAt: string; note: string };
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
  source: RuntimeCatalogModelSource;
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

export type RuntimeCatalogModelOverlayInput = {
  model: RuntimeCatalogModelDetail;
  voices?: RuntimeCatalogVoiceEntry[];
  voiceWorkflowModels?: RuntimeCatalogWorkflowModel[];
  modelWorkflowBinding?: RuntimeCatalogWorkflowBinding | null;
};

export type RuntimeModelCatalogConnectorClient = Pick<
  RuntimeConnectorClient,
  | 'listModelCatalogProviders'
  | 'listCatalogProviderModels'
  | 'getCatalogModelDetail'
  | 'upsertModelCatalogProvider'
  | 'deleteModelCatalogProvider'
  | 'upsertCatalogModelOverlay'
  | 'deleteCatalogModelOverlay'
>;

export type RuntimeModelCatalogClientOptions = {
  connector: () => RuntimeModelCatalogConnectorClient;
  readConnector?: () => RuntimeModelCatalogConnectorClient;
  callOptions?: RuntimeCallOptions;
  readFallbackTtlMs?: number;
  shouldUseReadFallback?: (error: unknown) => boolean;
  now?: () => number;
};

export type RuntimeModelCatalogClient = {
  listProviders: () => Promise<RuntimeModelCatalogProvider[]>;
  listProviderModels: (provider: string, pageSize?: number, pageToken?: string) => Promise<RuntimeCatalogProviderModelsResponse>;
  getModelDetail: (provider: string, modelId: string) => Promise<RuntimeCatalogModelDetailResponse>;
  upsertProvider: (provider: string, yaml: string) => Promise<RuntimeModelCatalogProvider>;
  deleteProvider: (provider: string) => Promise<void>;
  upsertModelOverlay: (provider: string, input: RuntimeCatalogModelOverlayInput) => Promise<RuntimeCatalogModelDetailResponse>;
  deleteModelOverlay: (provider: string, modelId: string) => Promise<RuntimeModelCatalogProvider>;
};

function mapProviderSource(source?: ModelCatalogProviderSource): RuntimeModelCatalogProviderSource {
  if (source === ModelCatalogProviderSource.BUILTIN) return 'builtin';
  if (source === ModelCatalogProviderSource.CUSTOM) return 'custom';
  if (source === ModelCatalogProviderSource.OVERRIDDEN) return 'overridden';
  if (source === ModelCatalogProviderSource.REMOTE) return 'remote';
  return 'unknown';
}

function mapModelSource(source?: CatalogModelSource): RuntimeCatalogModelSource {
  if (source === CatalogModelSource.BUILTIN) return 'builtin';
  if (source === CatalogModelSource.CUSTOM) return 'custom';
  if (source === CatalogModelSource.OVERRIDDEN) return 'overridden';
  return 'unknown';
}

export function normalizeRuntimeCatalogWarnings(warnings: CatalogOverlayWarning[] | undefined): RuntimeCatalogOverlayWarning[] {
  return (warnings || []).map((warning) => ({
    code: String(warning.code || '').trim(),
    message: String(warning.message || '').trim(),
  }));
}

export function normalizeRuntimeCatalogSourceRef(sourceRef?: CatalogSourceRef): RuntimeCatalogSourceRef {
  return {
    url: String(sourceRef?.url || '').trim(),
    retrievedAt: String(sourceRef?.retrievedAt || '').trim(),
    note: String(sourceRef?.note || '').trim(),
  };
}

export function runtimeJsonToProtoStruct(value: JsonObject): ProtoStruct {
  return {
    fields: Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [key, runtimeJsonToProtoValue(item)])),
  };
}

function runtimeJsonToProtoValue(value: JsonValue): ProtoValue {
  if (value === null || value === undefined) return { kind: { oneofKind: 'nullValue', nullValue: 0 } };
  if (Array.isArray(value)) return { kind: { oneofKind: 'listValue', listValue: { values: value.map(runtimeJsonToProtoValue) } } };
  if (typeof value === 'number') return { kind: { oneofKind: 'numberValue', numberValue: value } };
  if (typeof value === 'boolean') return { kind: { oneofKind: 'boolValue', boolValue: value } };
  if (typeof value === 'string') return { kind: { oneofKind: 'stringValue', stringValue: value } };
  return { kind: { oneofKind: 'structValue', structValue: runtimeJsonToProtoStruct(value as JsonObject) } };
}

export function runtimeProtoStructToJson(value?: ProtoStruct): JsonObject {
  const output: JsonObject = {};
  for (const [key, item] of Object.entries(value?.fields || {})) {
    output[key] = runtimeProtoValueToJson(item);
  }
  return output;
}

function runtimeProtoValueToJson(value?: ProtoValue): JsonValue {
  switch (value?.kind.oneofKind) {
    case 'boolValue':
      return value.kind.boolValue;
    case 'numberValue':
      return value.kind.numberValue;
    case 'stringValue':
      return value.kind.stringValue;
    case 'structValue':
      return runtimeProtoStructToJson(value.kind.structValue);
    case 'listValue':
      return (value.kind.listValue?.values || []).map(runtimeProtoValueToJson);
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

function normalizeRuntimeCatalogVideoGeneration(video?: CatalogVideoGenerationCapability): RuntimeCatalogVideoGeneration | null {
  if (!video) return null;
  return {
    modes: (video.modes || []).map((item) => String(item || '').trim()).filter(Boolean),
    inputRoles: (video.inputRoles || []).map((item) => ({
      key: String(item.key || '').trim(),
      values: (item.values || []).map((value) => String(value || '').trim()).filter(Boolean),
    })),
    limits: runtimeProtoStructToJson(video.limits as ProtoStruct | undefined),
    optionSupports: (video.optionSupports || []).map((item) => String(item || '').trim()).filter(Boolean),
    optionConstraints: runtimeProtoStructToJson(video.optionConstraints as ProtoStruct | undefined),
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
    videoGeneration: normalizeRuntimeCatalogVideoGeneration(entry?.videoGeneration),
    sourceRef: normalizeRuntimeCatalogSourceRef(entry?.sourceRef),
    warnings: normalizeRuntimeCatalogWarnings(entry?.warnings),
    voices: (entry?.voices || []).map((voice) => ({
      voiceSetId: String(voice.voiceSetId || '').trim(),
      provider: String(voice.provider || '').trim(),
      voiceId: String(voice.voiceId || '').trim(),
      name: String(voice.name || '').trim(),
      langs: (voice.langs || []).map((item) => String(item || '').trim()).filter(Boolean),
      modelIds: (voice.modelIds || []).map((item) => String(item || '').trim()).filter(Boolean),
      sourceRef: normalizeRuntimeCatalogSourceRef(voice.sourceRef),
    }) satisfies RuntimeCatalogVoiceEntry),
    voiceWorkflowModels: (entry?.voiceWorkflowModels || []).map((workflow) => ({
      workflowModelId: String(workflow.workflowModelId || '').trim(),
      workflowType: String(workflow.workflowType || '').trim(),
      inputContractRef: String(workflow.inputContractRef || '').trim(),
      outputPersistence: String(workflow.outputPersistence || '').trim(),
      targetModelRefs: (workflow.targetModelRefs || []).map((item) => String(item || '').trim()).filter(Boolean),
      langs: (workflow.langs || []).map((item) => String(item || '').trim()).filter(Boolean),
      sourceRef: normalizeRuntimeCatalogSourceRef(workflow.sourceRef),
    }) satisfies RuntimeCatalogWorkflowModel),
    modelWorkflowBinding: entry?.modelWorkflowBinding ? ({
      modelId: String(entry.modelWorkflowBinding.modelId || '').trim(),
      workflowModelRefs: (entry.modelWorkflowBinding.workflowModelRefs || []).map((item) => String(item || '').trim()).filter(Boolean),
      workflowTypes: (entry.modelWorkflowBinding.workflowTypes || []).map((item) => String(item || '').trim()).filter(Boolean),
    } satisfies RuntimeCatalogWorkflowBinding) : null,
  };
}

export function runtimeCatalogModelDetailToInput(provider: string, detail: RuntimeCatalogModelDetail): CatalogModelInput {
  return {
    provider: provider.trim(),
    modelId: detail.modelId.trim(),
    modelType: detail.modelType.trim(),
    updatedAt: detail.updatedAt.trim(),
    capabilities: detail.capabilities.map((item) => item.trim()).filter(Boolean),
    pricing: {
      unit: detail.pricing.unit.trim(),
      input: detail.pricing.input.trim(),
      output: detail.pricing.output.trim(),
      currency: detail.pricing.currency.trim(),
      asOf: detail.pricing.asOf.trim(),
      notes: detail.pricing.notes.trim(),
    } satisfies CatalogPricing,
    voiceSetId: detail.voiceSetId.trim(),
    voiceDiscoveryMode: detail.voiceDiscoveryMode.trim(),
    voiceRefKinds: detail.voiceRefKinds.map((item) => item.trim()).filter(Boolean),
    videoGeneration: detail.videoGeneration ? {
      modes: detail.videoGeneration.modes,
      inputRoles: detail.videoGeneration.inputRoles,
      limits: runtimeJsonToProtoStruct(detail.videoGeneration.limits),
      optionSupports: detail.videoGeneration.optionSupports,
      optionConstraints: runtimeJsonToProtoStruct(detail.videoGeneration.optionConstraints),
      outputs: detail.videoGeneration.outputs,
    } : undefined,
    sourceRef: {
      url: detail.sourceRef.url.trim(),
      retrievedAt: detail.sourceRef.retrievedAt.trim(),
      note: detail.sourceRef.note.trim(),
    } satisfies CatalogSourceRef,
  };
}

function runtimeCatalogVoiceToInput(provider: string, voice: RuntimeCatalogVoiceEntry): CatalogVoiceEntry {
  return {
    voiceSetId: voice.voiceSetId.trim(),
    provider: provider.trim(),
    voiceId: voice.voiceId.trim(),
    name: voice.name.trim(),
    langs: voice.langs.map((item) => item.trim()).filter(Boolean),
    modelIds: voice.modelIds.map((item) => item.trim()).filter(Boolean),
    sourceRef: {
      url: voice.sourceRef.url.trim(),
      retrievedAt: voice.sourceRef.retrievedAt.trim(),
      note: voice.sourceRef.note.trim(),
    },
  };
}

function runtimeCatalogWorkflowToInput(workflow: RuntimeCatalogWorkflowModel): CatalogWorkflowModel {
  return {
    workflowModelId: workflow.workflowModelId.trim(),
    workflowType: workflow.workflowType.trim(),
    inputContractRef: workflow.inputContractRef.trim(),
    outputPersistence: workflow.outputPersistence.trim(),
    targetModelRefs: workflow.targetModelRefs.map((item) => item.trim()).filter(Boolean),
    langs: workflow.langs.map((item) => item.trim()).filter(Boolean),
    sourceRef: {
      url: workflow.sourceRef.url.trim(),
      retrievedAt: workflow.sourceRef.retrievedAt.trim(),
      note: workflow.sourceRef.note.trim(),
    },
  };
}

function runtimeCatalogWorkflowBindingToInput(binding: RuntimeCatalogWorkflowBinding): CatalogModelWorkflowBinding {
  return {
    modelId: binding.modelId.trim(),
    workflowModelRefs: binding.workflowModelRefs.map((item) => item.trim()).filter(Boolean),
    workflowTypes: binding.workflowTypes.map((item) => item.trim()).filter(Boolean),
  };
}

export function runtimeCatalogAuthFailedBecauseOfStaleBearer(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'retry_without_stale_runtime_bearer',
    source: 'runtime',
  });
  const code = typeof normalized.reasonCode === 'string' ? normalized.reasonCode.trim() : '';
  return code === ReasonCode.AUTH_TOKEN_INVALID;
}

export function createRuntimeModelCatalogClient(options: RuntimeModelCatalogClientOptions): RuntimeModelCatalogClient {
  const callOptions = options.callOptions;
  const readFallbackTtlMs = options.readFallbackTtlMs ?? 60_000;
  const shouldUseReadFallback = options.shouldUseReadFallback ?? runtimeCatalogAuthFailedBecauseOfStaleBearer;
  const now = options.now ?? (() => Date.now());
  let readFallbackUntilMs = 0;

  async function withReadFallback<T>(
    action: (connector: RuntimeModelCatalogConnectorClient) => Promise<T>,
  ): Promise<T> {
    const readConnector = options.readConnector;
    if (readConnector && now() < readFallbackUntilMs) {
      return action(readConnector());
    }
    try {
      return await action(options.connector());
    } catch (error) {
      if (!readConnector || !shouldUseReadFallback(error)) {
        throw error;
      }
      readFallbackUntilMs = now() + readFallbackTtlMs;
      return action(readConnector());
    }
  }

  return {
    async listProviders() {
      const response = await withReadFallback<ListModelCatalogProvidersResponse>((connector) =>
        connector.listModelCatalogProviders({}, callOptions));
      return (response.providers || [])
        .map(normalizeRuntimeModelCatalogProvider)
        .sort((left, right) => left.provider.localeCompare(right.provider));
    },
    async listProviderModels(provider: string, pageSize = 500, pageToken = '') {
      const request = { provider: provider.trim(), pageSize, pageToken };
      const response = await withReadFallback<ListCatalogProviderModelsResponse>((connector) =>
        connector.listCatalogProviderModels(request, callOptions));
      return {
        provider: normalizeRuntimeModelCatalogProvider(response.provider || {} as ModelCatalogProviderEntry),
        models: (response.models || []).map(normalizeRuntimeCatalogModelSummary),
        nextPageToken: String(response.nextPageToken || '').trim(),
        warnings: normalizeRuntimeCatalogWarnings(response.warnings),
      };
    },
    async getModelDetail(provider: string, modelId: string) {
      const request = { provider: provider.trim(), modelId: modelId.trim() };
      const response = await withReadFallback<GetCatalogModelDetailResponse>((connector) =>
        connector.getCatalogModelDetail(request, callOptions));
      return {
        provider: normalizeRuntimeModelCatalogProvider(response.provider || {} as ModelCatalogProviderEntry),
        model: normalizeRuntimeCatalogModelDetail(response.model),
        warnings: normalizeRuntimeCatalogWarnings(response.warnings),
      };
    },
    async upsertProvider(provider: string, yaml: string) {
      const response: UpsertModelCatalogProviderResponse = await options.connector().upsertModelCatalogProvider(
        { provider: provider.trim(), yaml: yaml.trim() },
        callOptions,
      );
      return normalizeRuntimeModelCatalogProvider(response.provider || {} as ModelCatalogProviderEntry);
    },
    async deleteProvider(provider: string) {
      await options.connector().deleteModelCatalogProvider(
        { provider: provider.trim() },
        callOptions,
      );
    },
    async upsertModelOverlay(provider: string, input: RuntimeCatalogModelOverlayInput) {
      const response: UpsertCatalogModelOverlayResponse = await options.connector().upsertCatalogModelOverlay({
        provider: provider.trim(),
        model: runtimeCatalogModelDetailToInput(provider, input.model),
        voices: (input.voices || []).map((voice) => runtimeCatalogVoiceToInput(provider, voice)),
        voiceWorkflowModels: (input.voiceWorkflowModels || []).map(runtimeCatalogWorkflowToInput),
        modelWorkflowBinding: input.modelWorkflowBinding
          ? runtimeCatalogWorkflowBindingToInput(input.modelWorkflowBinding)
          : undefined,
      }, callOptions);
      return {
        provider: normalizeRuntimeModelCatalogProvider(response.provider || {} as ModelCatalogProviderEntry),
        model: normalizeRuntimeCatalogModelDetail(response.model),
        warnings: normalizeRuntimeCatalogWarnings(response.warnings),
      };
    },
    async deleteModelOverlay(provider: string, modelId: string) {
      const response: DeleteCatalogModelOverlayResponse = await options.connector().deleteCatalogModelOverlay(
        { provider: provider.trim(), modelId: modelId.trim() },
        callOptions,
      );
      return normalizeRuntimeModelCatalogProvider(response.provider || {} as ModelCatalogProviderEntry);
    },
  };
}
