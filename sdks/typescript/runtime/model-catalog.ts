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
  CatalogSourceKind,
  type CatalogVideoGenerationCapability,
  type CatalogVoiceEntry,
  type CatalogWorkflowModel,
  type GetCatalogModelDetailResponse,
  type ListCatalogProviderModelsResponse,
  type ListModelCatalogProvidersResponse,
  type ModelCatalogProviderEntry,
  type RuntimeTypedCallOptions,
  type RuntimeTypedClient,
} from '../core-generated/runtime-typed-client';
import type {
  Struct,
  Value,
} from '../core-generated/runtime-protobuf/google/protobuf/struct';
import { createNimiError, type JsonObject } from '../types';

export type NimiRuntimeModelCatalogProviderSource =
  | 'builtin'
  | 'custom'
  | 'overridden'
  | 'remote'
  | 'unknown';

export type NimiRuntimeCatalogModelSource =
  | 'builtin'
  | 'custom'
  | 'overridden'
  | 'unknown';

export interface NimiRuntimeCatalogOverlayWarning {
  readonly code: string;
  readonly message: string;
}

export interface NimiRuntimeCatalogPricing {
  readonly unit: string;
  readonly input: string;
  readonly output: string;
  readonly currency: string;
  readonly asOf: string;
  readonly notes: string;
}

export interface NimiRuntimeCatalogSourceRef {
  readonly sourceKind: 'provider_documentation' | 'authenticated_provider_inventory' | 'unknown';
  readonly url: string;
  readonly retrievedAt: string;
  readonly note: string;
}

export interface NimiRuntimeCatalogVoiceEntry {
  readonly voiceSetId: string;
  readonly provider: string;
  readonly voiceId: string;
  readonly name: string;
  readonly langs: readonly string[];
  readonly modelIds: readonly string[];
  readonly sourceRef: NimiRuntimeCatalogSourceRef;
}

export interface NimiRuntimeCatalogWorkflowModel {
  readonly workflowModelId: string;
  readonly workflowType: string;
  readonly inputContractRef: string;
  readonly outputPersistence: string;
  readonly targetModelRefs: readonly string[];
  readonly langs: readonly string[];
  readonly sourceRef: NimiRuntimeCatalogSourceRef;
}

export interface NimiRuntimeCatalogWorkflowBinding {
  readonly modelId: string;
  readonly workflowModelRefs: readonly string[];
  readonly workflowTypes: readonly string[];
}

export interface NimiRuntimeCatalogVideoGeneration {
  readonly modes: readonly string[];
  readonly inputRoles: readonly {
    readonly key: string;
    readonly values: readonly string[];
  }[];
  readonly limits: JsonObject;
  readonly optionSupports: readonly string[];
  readonly optionConstraints: JsonObject;
  readonly outputs: {
    readonly videoUrl: boolean;
    readonly lastFrameUrl: boolean;
  };
}

export interface NimiRuntimeModelCatalogProvider {
  readonly provider: string;
  readonly version: number;
  readonly catalogVersion: string;
  readonly source: NimiRuntimeModelCatalogProviderSource;
  readonly inventoryMode: string;
  readonly modelCount: number;
  readonly voiceCount: number;
  readonly defaultTextModel: string;
  readonly capabilities: readonly string[];
  readonly hasOverlay: boolean;
  readonly customModelCount: number;
  readonly overriddenModelCount: number;
  readonly overlayUpdatedAt: string;
  readonly yaml: string;
  readonly effectiveYaml: string;
  readonly defaultEndpoint: string;
  readonly requiresExplicitEndpoint: boolean;
  readonly runtimePlane: string;
  readonly executionModule: string;
  readonly managedSupported: boolean;
}

export interface NimiRuntimeCatalogModelSummary {
  readonly provider: string;
  readonly modelId: string;
  readonly modelType: string;
  readonly updatedAt: string;
  readonly capabilities: readonly string[];
  readonly source: NimiRuntimeCatalogModelSource;
  readonly userScoped: boolean;
  readonly sourceNote: string;
  readonly hasVoiceCatalog: boolean;
  readonly hasVideoGeneration: boolean;
}

export interface NimiRuntimeCatalogModelDetail extends NimiRuntimeCatalogModelSummary {
  readonly pricing: NimiRuntimeCatalogPricing;
  readonly voiceSetId: string;
  readonly voiceDiscoveryMode: string;
  readonly voiceRefKinds: readonly string[];
  readonly videoGeneration: NimiRuntimeCatalogVideoGeneration | null;
  readonly sourceRef: NimiRuntimeCatalogSourceRef;
  readonly warnings: readonly NimiRuntimeCatalogOverlayWarning[];
  readonly voices: readonly NimiRuntimeCatalogVoiceEntry[];
  readonly voiceWorkflowModels: readonly NimiRuntimeCatalogWorkflowModel[];
  readonly modelWorkflowBinding: NimiRuntimeCatalogWorkflowBinding | null;
}

export interface NimiRuntimeCatalogProviderModelsResponse {
  readonly provider: NimiRuntimeModelCatalogProvider;
  readonly models: readonly NimiRuntimeCatalogModelSummary[];
  readonly nextPageToken: string;
  readonly warnings: readonly NimiRuntimeCatalogOverlayWarning[];
}

export interface NimiRuntimeCatalogModelDetailResponse {
  readonly provider: NimiRuntimeModelCatalogProvider;
  readonly model: NimiRuntimeCatalogModelDetail;
  readonly warnings: readonly NimiRuntimeCatalogOverlayWarning[];
}

export interface NimiRuntimeCatalogModelOverlayInput {
  readonly model: NimiRuntimeCatalogModelDetail;
  readonly voices?: readonly NimiRuntimeCatalogVoiceEntry[];
  readonly voiceWorkflowModels?: readonly NimiRuntimeCatalogWorkflowModel[];
  readonly modelWorkflowBinding?: NimiRuntimeCatalogWorkflowBinding | null;
}

export type NimiRuntimeModelCatalogConnectorClient = Pick<
  RuntimeTypedClient,
  | 'listModelCatalogProviders'
  | 'listCatalogProviderModels'
  | 'getCatalogModelDetail'
  | 'upsertModelCatalogProvider'
  | 'deleteModelCatalogProvider'
  | 'upsertCatalogModelOverlay'
  | 'deleteCatalogModelOverlay'
>;

export interface NimiRuntimeModelCatalogClientOptions {
  readonly connectors: NimiRuntimeModelCatalogConnectorClient;
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeModelCatalogClient {
  listProviders(): Promise<readonly NimiRuntimeModelCatalogProvider[]>;
  listProviderModels(
    provider: string,
    pageSize?: number,
    pageToken?: string,
  ): Promise<NimiRuntimeCatalogProviderModelsResponse>;
  getModelDetail(provider: string, modelId: string): Promise<NimiRuntimeCatalogModelDetailResponse>;
  upsertProvider(provider: string, yaml: string): Promise<NimiRuntimeModelCatalogProvider>;
  deleteProvider(provider: string): Promise<void>;
  upsertModelOverlay(
    provider: string,
    input: NimiRuntimeCatalogModelOverlayInput,
  ): Promise<NimiRuntimeCatalogModelDetailResponse>;
  deleteModelOverlay(provider: string, modelId: string): Promise<NimiRuntimeModelCatalogProvider>;
}

export function createNimiRuntimeModelCatalogClient(
  options: NimiRuntimeModelCatalogClientOptions,
): NimiRuntimeModelCatalogClient {
  const connectors = options.connectors;
  const callOptions = options.callOptions;
  return {
    async listProviders() {
      const response: ListModelCatalogProvidersResponse = await connectors.listModelCatalogProviders({}, callOptions);
      return response.providers
        .map(normalizeNimiRuntimeModelCatalogProvider)
        .sort((left, right) => left.provider.localeCompare(right.provider));
    },
    async listProviderModels(provider, pageSize = 500, pageToken = '') {
      const response: ListCatalogProviderModelsResponse = await connectors.listCatalogProviderModels({
        provider: requireCatalogText(provider, 'Runtime model catalog provider is required', 'provide_catalog_provider'),
        pageSize: normalizeCatalogPageSize(pageSize),
        pageToken: normalizeText(pageToken),
      }, callOptions);
      return {
        provider: normalizeNimiRuntimeModelCatalogProvider(response.provider),
        models: response.models.map(normalizeNimiRuntimeCatalogModelSummary),
        nextPageToken: normalizeText(response.nextPageToken),
        warnings: normalizeNimiRuntimeCatalogWarnings(response.warnings),
      };
    },
    async getModelDetail(provider, modelId) {
      const response: GetCatalogModelDetailResponse = await connectors.getCatalogModelDetail({
        provider: requireCatalogText(provider, 'Runtime model catalog provider is required', 'provide_catalog_provider'),
        modelId: requireCatalogText(modelId, 'Runtime catalog model id is required', 'provide_catalog_model_id'),
      }, callOptions);
      return {
        provider: normalizeNimiRuntimeModelCatalogProvider(response.provider),
        model: normalizeNimiRuntimeCatalogModelDetail(response.model),
        warnings: normalizeNimiRuntimeCatalogWarnings(response.warnings),
      };
    },
    async upsertProvider(provider, yaml) {
      const response = await connectors.upsertModelCatalogProvider({
        provider: requireCatalogText(provider, 'Runtime model catalog provider is required', 'provide_catalog_provider'),
        yaml: requireCatalogText(yaml, 'Runtime model catalog provider yaml is required', 'provide_catalog_provider_yaml'),
      }, callOptions);
      return normalizeNimiRuntimeModelCatalogProvider(response.provider);
    },
    async deleteProvider(provider) {
      await connectors.deleteModelCatalogProvider({
        provider: requireCatalogText(provider, 'Runtime model catalog provider is required', 'provide_catalog_provider'),
      }, callOptions);
    },
    async upsertModelOverlay(provider, input) {
      const normalizedProvider = requireCatalogText(
        provider,
        'Runtime model catalog provider is required',
        'provide_catalog_provider',
      );
      const response = await connectors.upsertCatalogModelOverlay({
        provider: normalizedProvider,
        model: nimiRuntimeCatalogModelDetailToInput(normalizedProvider, input.model),
        voices: (input.voices ?? []).map((voice) => nimiRuntimeCatalogVoiceToInput(normalizedProvider, voice)),
        voiceWorkflowModels: (input.voiceWorkflowModels ?? []).map(nimiRuntimeCatalogWorkflowToInput),
        modelWorkflowBinding: input.modelWorkflowBinding
          ? nimiRuntimeCatalogWorkflowBindingToInput(input.modelWorkflowBinding)
          : undefined,
      }, callOptions);
      return {
        provider: normalizeNimiRuntimeModelCatalogProvider(response.provider),
        model: normalizeNimiRuntimeCatalogModelDetail(response.model),
        warnings: normalizeNimiRuntimeCatalogWarnings(response.warnings),
      };
    },
    async deleteModelOverlay(provider, modelId) {
      const response = await connectors.deleteCatalogModelOverlay({
        provider: requireCatalogText(provider, 'Runtime model catalog provider is required', 'provide_catalog_provider'),
        modelId: requireCatalogText(modelId, 'Runtime catalog model id is required', 'provide_catalog_model_id'),
      }, callOptions);
      return normalizeNimiRuntimeModelCatalogProvider(response.provider);
    },
  };
}

export function modelCatalogProviderSourceToNimiSource(
  source?: ModelCatalogProviderSource,
): NimiRuntimeModelCatalogProviderSource {
  if (source === ModelCatalogProviderSource.BUILTIN) return 'builtin';
  if (source === ModelCatalogProviderSource.CUSTOM) return 'custom';
  if (source === ModelCatalogProviderSource.OVERRIDDEN) return 'overridden';
  if (source === ModelCatalogProviderSource.REMOTE) return 'remote';
  return 'unknown';
}

export function catalogModelSourceToNimiSource(source?: CatalogModelSource): NimiRuntimeCatalogModelSource {
  if (source === CatalogModelSource.BUILTIN) return 'builtin';
  if (source === CatalogModelSource.CUSTOM) return 'custom';
  if (source === CatalogModelSource.OVERRIDDEN) return 'overridden';
  return 'unknown';
}

export function normalizeNimiRuntimeCatalogWarnings(
  warnings: readonly CatalogOverlayWarning[] | undefined,
): readonly NimiRuntimeCatalogOverlayWarning[] {
  return (warnings ?? []).map((warning) => ({
    code: normalizeText(warning.code),
    message: normalizeText(warning.message),
  }));
}

export function normalizeNimiRuntimeCatalogSourceRef(
  sourceRef?: CatalogSourceRef,
): NimiRuntimeCatalogSourceRef {
  return {
    sourceKind: sourceRef?.sourceKind === CatalogSourceKind.PROVIDER_DOCUMENTATION
      ? 'provider_documentation'
      : sourceRef?.sourceKind === CatalogSourceKind.AUTHENTICATED_PROVIDER_INVENTORY
        ? 'authenticated_provider_inventory'
        : 'unknown',
    url: normalizeText(sourceRef?.url),
    retrievedAt: normalizeText(sourceRef?.retrievedAt),
    note: normalizeText(sourceRef?.note),
  };
}

function nimiRuntimeCatalogSourceKindToProto(
  sourceKind: NimiRuntimeCatalogSourceRef['sourceKind'],
): CatalogSourceKind {
  if (sourceKind === 'provider_documentation') return CatalogSourceKind.PROVIDER_DOCUMENTATION;
  if (sourceKind === 'authenticated_provider_inventory') {
    return CatalogSourceKind.AUTHENTICATED_PROVIDER_INVENTORY;
  }
  return CatalogSourceKind.UNSPECIFIED;
}

export function normalizeNimiRuntimeModelCatalogProvider(
  entry: ModelCatalogProviderEntry | undefined,
): NimiRuntimeModelCatalogProvider {
  return {
    provider: normalizeText(entry?.provider),
    version: Number(entry?.version ?? 0),
    catalogVersion: normalizeText(entry?.catalogVersion),
    source: modelCatalogProviderSourceToNimiSource(entry?.source),
    inventoryMode: normalizeText(entry?.inventoryMode),
    modelCount: Number(entry?.modelCount ?? 0),
    voiceCount: Number(entry?.voiceCount ?? 0),
    defaultTextModel: normalizeText(entry?.defaultTextModel),
    capabilities: normalizeTextList(entry?.capabilities),
    hasOverlay: Boolean(entry?.hasOverlay),
    customModelCount: Number(entry?.customModelCount ?? 0),
    overriddenModelCount: Number(entry?.overriddenModelCount ?? 0),
    overlayUpdatedAt: normalizeText(entry?.overlayUpdatedAt),
    yaml: normalizeText(entry?.yaml),
    effectiveYaml: normalizeText(entry?.effectiveYaml),
    defaultEndpoint: normalizeText(entry?.defaultEndpoint),
    requiresExplicitEndpoint: Boolean(entry?.requiresExplicitEndpoint),
    runtimePlane: normalizeText(entry?.runtimePlane),
    executionModule: normalizeText(entry?.executionModule),
    managedSupported: Boolean(entry?.managedSupported),
  };
}

export function normalizeNimiRuntimeCatalogModelSummary(
  entry: CatalogModelSummary,
): NimiRuntimeCatalogModelSummary {
  return {
    provider: normalizeText(entry.provider),
    modelId: normalizeText(entry.modelId),
    modelType: normalizeText(entry.modelType),
    updatedAt: normalizeText(entry.updatedAt),
    capabilities: normalizeTextList(entry.capabilities),
    source: catalogModelSourceToNimiSource(entry.source),
    userScoped: Boolean(entry.userScoped),
    sourceNote: normalizeText(entry.sourceNote),
    hasVoiceCatalog: Boolean(entry.hasVoiceCatalog),
    hasVideoGeneration: Boolean(entry.hasVideoGeneration),
  };
}

export function normalizeNimiRuntimeCatalogModelDetail(
  entry: CatalogModelDetail | undefined,
): NimiRuntimeCatalogModelDetail {
  const summary = normalizeNimiRuntimeCatalogModelCore(entry);
  return {
    ...summary,
    pricing: {
      unit: normalizeText(entry?.pricing?.unit),
      input: normalizeText(entry?.pricing?.input),
      output: normalizeText(entry?.pricing?.output),
      currency: normalizeText(entry?.pricing?.currency),
      asOf: normalizeText(entry?.pricing?.asOf),
      notes: normalizeText(entry?.pricing?.notes),
    },
    voiceSetId: normalizeText(entry?.voiceSetId),
    voiceDiscoveryMode: normalizeText(entry?.voiceDiscoveryMode),
    voiceRefKinds: normalizeTextList(entry?.voiceRefKinds),
    videoGeneration: normalizeNimiRuntimeCatalogVideoGeneration(entry?.videoGeneration),
    sourceRef: normalizeNimiRuntimeCatalogSourceRef(entry?.sourceRef),
    warnings: normalizeNimiRuntimeCatalogWarnings(entry?.warnings),
    voices: (entry?.voices ?? []).map(nimiRuntimeCatalogVoiceFromRuntime),
    voiceWorkflowModels: (entry?.voiceWorkflowModels ?? []).map(nimiRuntimeCatalogWorkflowFromRuntime),
    modelWorkflowBinding: entry?.modelWorkflowBinding
      ? nimiRuntimeCatalogWorkflowBindingFromRuntime(entry.modelWorkflowBinding)
      : null,
  };
}

export function nimiRuntimeCatalogModelDetailToInput(
  provider: string,
  detail: NimiRuntimeCatalogModelDetail,
): CatalogModelInput {
  return {
    provider: normalizeText(provider),
    modelId: requireCatalogText(detail.modelId, 'Runtime catalog model id is required', 'provide_catalog_model_id'),
    modelType: normalizeText(detail.modelType),
    updatedAt: normalizeText(detail.updatedAt),
    capabilities: mutableTextList(detail.capabilities),
    pricing: {
      unit: normalizeText(detail.pricing.unit),
      input: normalizeText(detail.pricing.input),
      output: normalizeText(detail.pricing.output),
      currency: normalizeText(detail.pricing.currency),
      asOf: normalizeText(detail.pricing.asOf),
      notes: normalizeText(detail.pricing.notes),
    },
    voiceSetId: normalizeText(detail.voiceSetId),
    voiceDiscoveryMode: normalizeText(detail.voiceDiscoveryMode),
    voiceRefKinds: mutableTextList(detail.voiceRefKinds),
    videoGeneration: detail.videoGeneration ? {
      modes: mutableTextList(detail.videoGeneration.modes),
      inputRoles: detail.videoGeneration.inputRoles.map((entry) => ({
        key: normalizeText(entry.key),
        values: mutableTextList(entry.values),
      })),
      limits: nimiRuntimeJsonToProtoStruct(detail.videoGeneration.limits),
      optionSupports: mutableTextList(detail.videoGeneration.optionSupports),
      optionConstraints: nimiRuntimeJsonToProtoStruct(detail.videoGeneration.optionConstraints),
      outputs: { ...detail.videoGeneration.outputs },
    } : undefined,
    sourceRef: {
      sourceKind: nimiRuntimeCatalogSourceKindToProto(detail.sourceRef.sourceKind),
      url: normalizeText(detail.sourceRef.url),
      retrievedAt: normalizeText(detail.sourceRef.retrievedAt),
      note: normalizeText(detail.sourceRef.note),
    },
  };
}

export function nimiRuntimeProtoStructToJson(value?: Struct): JsonObject {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value?.fields ?? {})) {
    output[key] = nimiRuntimeProtoValueToJson(item);
  }
  return output as JsonObject;
}

export function nimiRuntimeJsonToProtoStruct(value: JsonObject): Struct {
  return {
    fields: Object.fromEntries(
      Object.entries(value ?? {}).map(([key, item]) => [key, nimiRuntimeJsonToProtoValue(item)]),
    ),
  };
}

function normalizeNimiRuntimeCatalogModelCore(
  entry?: Partial<CatalogModelSummary & CatalogModelDetail>,
): NimiRuntimeCatalogModelSummary {
  return {
    provider: normalizeText(entry?.provider),
    modelId: normalizeText(entry?.modelId),
    modelType: normalizeText(entry?.modelType),
    updatedAt: normalizeText(entry?.updatedAt),
    capabilities: normalizeTextList(entry?.capabilities),
    source: catalogModelSourceToNimiSource(entry?.source),
    userScoped: Boolean(entry?.userScoped),
    sourceNote: normalizeText(entry?.sourceNote),
    hasVoiceCatalog: Boolean(entry?.hasVoiceCatalog),
    hasVideoGeneration: Boolean(entry?.hasVideoGeneration),
  };
}

function normalizeNimiRuntimeCatalogVideoGeneration(
  video?: CatalogVideoGenerationCapability,
): NimiRuntimeCatalogVideoGeneration | null {
  if (!video) return null;
  return {
    modes: normalizeTextList(video.modes),
    inputRoles: video.inputRoles.map((item) => ({
      key: normalizeText(item.key),
      values: normalizeTextList(item.values),
    })),
    limits: nimiRuntimeProtoStructToJson(video.limits),
    optionSupports: normalizeTextList(video.optionSupports),
    optionConstraints: nimiRuntimeProtoStructToJson(video.optionConstraints),
    outputs: {
      videoUrl: Boolean(video.outputs?.videoUrl),
      lastFrameUrl: Boolean(video.outputs?.lastFrameUrl),
    },
  };
}

function nimiRuntimeCatalogVoiceFromRuntime(voice: CatalogVoiceEntry): NimiRuntimeCatalogVoiceEntry {
  return {
    voiceSetId: normalizeText(voice.voiceSetId),
    provider: normalizeText(voice.provider),
    voiceId: normalizeText(voice.voiceId),
    name: normalizeText(voice.name),
    langs: mutableTextList(voice.langs),
    modelIds: mutableTextList(voice.modelIds),
    sourceRef: normalizeNimiRuntimeCatalogSourceRef(voice.sourceRef),
  };
}

function nimiRuntimeCatalogWorkflowFromRuntime(workflow: CatalogWorkflowModel): NimiRuntimeCatalogWorkflowModel {
  return {
    workflowModelId: normalizeText(workflow.workflowModelId),
    workflowType: normalizeText(workflow.workflowType),
    inputContractRef: normalizeText(workflow.inputContractRef),
    outputPersistence: normalizeText(workflow.outputPersistence),
    targetModelRefs: mutableTextList(workflow.targetModelRefs),
    langs: mutableTextList(workflow.langs),
    sourceRef: normalizeNimiRuntimeCatalogSourceRef(workflow.sourceRef),
  };
}

function nimiRuntimeCatalogWorkflowBindingFromRuntime(
  binding: CatalogModelWorkflowBinding,
): NimiRuntimeCatalogWorkflowBinding {
  return {
    modelId: normalizeText(binding.modelId),
    workflowModelRefs: mutableTextList(binding.workflowModelRefs),
    workflowTypes: mutableTextList(binding.workflowTypes),
  };
}

function nimiRuntimeCatalogVoiceToInput(
  provider: string,
  voice: NimiRuntimeCatalogVoiceEntry,
): CatalogVoiceEntry {
  return {
    voiceSetId: normalizeText(voice.voiceSetId),
    provider: normalizeText(provider),
    voiceId: normalizeText(voice.voiceId),
    name: normalizeText(voice.name),
    langs: mutableTextList(voice.langs),
    modelIds: mutableTextList(voice.modelIds),
    sourceRef: {
      sourceKind: nimiRuntimeCatalogSourceKindToProto(voice.sourceRef.sourceKind),
      url: normalizeText(voice.sourceRef.url),
      retrievedAt: normalizeText(voice.sourceRef.retrievedAt),
      note: normalizeText(voice.sourceRef.note),
    },
  };
}

function nimiRuntimeCatalogWorkflowToInput(
  workflow: NimiRuntimeCatalogWorkflowModel,
): CatalogWorkflowModel {
  return {
    workflowModelId: normalizeText(workflow.workflowModelId),
    workflowType: normalizeText(workflow.workflowType),
    inputContractRef: normalizeText(workflow.inputContractRef),
    outputPersistence: normalizeText(workflow.outputPersistence),
    targetModelRefs: mutableTextList(workflow.targetModelRefs),
    langs: mutableTextList(workflow.langs),
    sourceRef: {
      sourceKind: nimiRuntimeCatalogSourceKindToProto(workflow.sourceRef.sourceKind),
      url: normalizeText(workflow.sourceRef.url),
      retrievedAt: normalizeText(workflow.sourceRef.retrievedAt),
      note: normalizeText(workflow.sourceRef.note),
    },
  };
}

function nimiRuntimeCatalogWorkflowBindingToInput(
  binding: NimiRuntimeCatalogWorkflowBinding,
): CatalogModelWorkflowBinding {
  return {
    modelId: normalizeText(binding.modelId),
    workflowModelRefs: mutableTextList(binding.workflowModelRefs),
    workflowTypes: mutableTextList(binding.workflowTypes),
  };
}

function nimiRuntimeProtoValueToJson(value?: Value): unknown {
  switch (value?.kind.oneofKind) {
    case 'boolValue':
      return value.kind.boolValue;
    case 'numberValue':
      return value.kind.numberValue;
    case 'stringValue':
      return value.kind.stringValue;
    case 'structValue':
      return nimiRuntimeProtoStructToJson(value.kind.structValue);
    case 'listValue':
      return value.kind.listValue.values.map(nimiRuntimeProtoValueToJson);
    default:
      return null;
  }
}

function nimiRuntimeJsonToProtoValue(value: unknown): Value {
  if (value === null || value === undefined) {
    return { kind: { oneofKind: 'nullValue', nullValue: 0 } };
  }
  if (Array.isArray(value)) {
    return {
      kind: {
        oneofKind: 'listValue',
        listValue: { values: value.map(nimiRuntimeJsonToProtoValue) },
      },
    };
  }
  if (typeof value === 'number') {
    return { kind: { oneofKind: 'numberValue', numberValue: value } };
  }
  if (typeof value === 'boolean') {
    return { kind: { oneofKind: 'boolValue', boolValue: value } };
  }
  if (typeof value === 'string') {
    return { kind: { oneofKind: 'stringValue', stringValue: value } };
  }
  return {
    kind: {
      oneofKind: 'structValue',
      structValue: nimiRuntimeJsonToProtoStruct(value as JsonObject),
    },
  };
}

function normalizeCatalogPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return 500;
  }
  return Math.floor(pageSize);
}

function requireCatalogText(value: unknown, message: string, actionHint: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message,
      reasonCode: 'SDK_RUNTIME_MODEL_CATALOG_INPUT_INVALID',
      actionHint,
      source: 'sdk',
    });
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTextList(value: readonly unknown[] | undefined): readonly string[] {
  return (value ?? []).map(normalizeText).filter(Boolean);
}

function mutableTextList(value: readonly unknown[] | undefined): string[] {
  return [...normalizeTextList(value)];
}
