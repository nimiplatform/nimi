import { getPlatformClient } from '@nimiplatform/sdk';
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
  type ModelCatalogProviderEntry,
} from '@nimiplatform/sdk/runtime';

type JsonObject = Record<string, unknown>;
type JsonValue = unknown;

const CATALOG_CALL_OPTIONS = {
  timeoutMs: 8000,
  metadata: {
    callerKind: 'desktop-core' as const,
    callerId: 'runtime-config.catalog',
    surfaceId: 'runtime.config',
  },
};

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

export type ProviderCatalogSource = 'builtin' | 'custom' | 'overridden' | 'remote' | 'unknown';
export type RuntimeCatalogModelSource = 'builtin' | 'custom' | 'overridden' | 'unknown';

export type RuntimeCatalogOverlayWarning = { code: string; message: string };
export type RuntimeCatalogPricing = { unit: string; input: string; output: string; currency: string; asOf: string; notes: string };
export type RuntimeCatalogSourceRef = { url: string; retrievedAt: string; note: string };
export type RuntimeCatalogVoiceEntry = { voiceSetId: string; provider: string; voiceId: string; name: string; langs: string[]; modelIds: string[]; sourceRef: RuntimeCatalogSourceRef };
export type RuntimeCatalogWorkflowModel = { workflowModelId: string; workflowType: string; inputContractRef: string; outputPersistence: string; targetModelRefs: string[]; langs: string[]; sourceRef: RuntimeCatalogSourceRef };
export type RuntimeCatalogWorkflowBinding = { modelId: string; workflowModelRefs: string[]; workflowTypes: string[] };
export type RuntimeCatalogVideoGeneration = { modes: string[]; inputRoles: Array<{ key: string; values: string[] }>; limits: JsonObject; optionSupports: string[]; optionConstraints: JsonObject; outputs: { videoUrl: boolean; lastFrameUrl: boolean } };

export type RuntimeModelCatalogProvider = {
  provider: string;
  version: number;
  catalogVersion: string;
  source: ProviderCatalogSource;
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

function mapProviderSource(source: ModelCatalogProviderSource): ProviderCatalogSource {
  if (source === ModelCatalogProviderSource.BUILTIN) return 'builtin';
  if (source === ModelCatalogProviderSource.CUSTOM) return 'custom';
  if (source === ModelCatalogProviderSource.OVERRIDDEN) return 'overridden';
  if (source === ModelCatalogProviderSource.REMOTE) return 'remote';
  return 'unknown';
}

function mapModelSource(source: CatalogModelSource): RuntimeCatalogModelSource {
  if (source === CatalogModelSource.BUILTIN) return 'builtin';
  if (source === CatalogModelSource.CUSTOM) return 'custom';
  if (source === CatalogModelSource.OVERRIDDEN) return 'overridden';
  return 'unknown';
}

function normalizeWarnings(warnings: CatalogOverlayWarning[] | undefined): RuntimeCatalogOverlayWarning[] {
  return (warnings || []).map((warning) => ({ code: String(warning.code || '').trim(), message: String(warning.message || '').trim() }));
}

function normalizeSourceRef(sourceRef?: CatalogSourceRef): RuntimeCatalogSourceRef {
  return { url: String(sourceRef?.url || '').trim(), retrievedAt: String(sourceRef?.retrievedAt || '').trim(), note: String(sourceRef?.note || '').trim() };
}

export function normalizeProviderEntry(entry: ModelCatalogProviderEntry): RuntimeModelCatalogProvider {
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

export function normalizeModelSummary(entry: CatalogModelSummary): RuntimeCatalogModelSummary {
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

function normalizeModelCore(entry?: Partial<CatalogModelSummary & CatalogModelDetail>): RuntimeCatalogModelSummary {
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

export function normalizeModelDetail(entry?: CatalogModelDetail): RuntimeCatalogModelDetail {
  const summary = normalizeModelCore(entry);
  return {
    ...summary,
    pricing: { unit: String(entry?.pricing?.unit || '').trim(), input: String(entry?.pricing?.input || '').trim(), output: String(entry?.pricing?.output || '').trim(), currency: String(entry?.pricing?.currency || '').trim(), asOf: String(entry?.pricing?.asOf || '').trim(), notes: String(entry?.pricing?.notes || '').trim() },
    voiceSetId: String(entry?.voiceSetId || '').trim(),
    voiceDiscoveryMode: String(entry?.voiceDiscoveryMode || '').trim(),
    voiceRefKinds: (entry?.voiceRefKinds || []).map((item) => String(item || '').trim()).filter(Boolean),
    videoGeneration: normalizeVideoGeneration(entry?.videoGeneration),
    sourceRef: normalizeSourceRef(entry?.sourceRef),
    warnings: normalizeWarnings(entry?.warnings),
    voices: (entry?.voices || []).map((voice) => ({ voiceSetId: String(voice.voiceSetId || '').trim(), provider: String(voice.provider || '').trim(), voiceId: String(voice.voiceId || '').trim(), name: String(voice.name || '').trim(), langs: (voice.langs || []).map((item) => String(item || '').trim()).filter(Boolean), modelIds: (voice.modelIds || []).map((item) => String(item || '').trim()).filter(Boolean), sourceRef: normalizeSourceRef(voice.sourceRef) })),
    voiceWorkflowModels: (entry?.voiceWorkflowModels || []).map((workflow) => ({ workflowModelId: String(workflow.workflowModelId || '').trim(), workflowType: String(workflow.workflowType || '').trim(), inputContractRef: String(workflow.inputContractRef || '').trim(), outputPersistence: String(workflow.outputPersistence || '').trim(), targetModelRefs: (workflow.targetModelRefs || []).map((item) => String(item || '').trim()).filter(Boolean), langs: (workflow.langs || []).map((item) => String(item || '').trim()).filter(Boolean), sourceRef: normalizeSourceRef(workflow.sourceRef) })),
    modelWorkflowBinding: entry?.modelWorkflowBinding ? { modelId: String(entry.modelWorkflowBinding.modelId || '').trim(), workflowModelRefs: (entry.modelWorkflowBinding.workflowModelRefs || []).map((item) => String(item || '').trim()).filter(Boolean), workflowTypes: (entry.modelWorkflowBinding.workflowTypes || []).map((item) => String(item || '').trim()).filter(Boolean) } : null,
  };
}

function normalizeVideoGeneration(video?: CatalogVideoGenerationCapability): RuntimeCatalogVideoGeneration | null {
  if (!video) return null;
  return {
    modes: (video.modes || []).map((item) => String(item || '').trim()).filter(Boolean),
    inputRoles: (video.inputRoles || []).map((item) => ({ key: String(item.key || '').trim(), values: (item.values || []).map((value) => String(value || '').trim()).filter(Boolean) })),
    limits: protoStructToJson(video.limits as ProtoStruct | undefined),
    optionSupports: (video.optionSupports || []).map((item) => String(item || '').trim()).filter(Boolean),
    optionConstraints: protoStructToJson(video.optionConstraints as ProtoStruct | undefined),
    outputs: { videoUrl: Boolean(video.outputs?.videoUrl), lastFrameUrl: Boolean(video.outputs?.lastFrameUrl) },
  };
}

function runtimeAdmin() {
  return getPlatformClient().domains.runtimeAdmin;
}

export function jsonToProtoStruct(value: JsonObject): ProtoStruct { return { fields: Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [key, jsonToProtoValue(item)])) }; }
function jsonToProtoValue(value: JsonValue): ProtoValue { if (value === null || value === undefined) return { kind: { oneofKind: 'nullValue', nullValue: 0 } }; if (Array.isArray(value)) return { kind: { oneofKind: 'listValue', listValue: { values: value.map(jsonToProtoValue) } } }; if (typeof value === 'number') return { kind: { oneofKind: 'numberValue', numberValue: value } }; if (typeof value === 'boolean') return { kind: { oneofKind: 'boolValue', boolValue: value } }; if (typeof value === 'string') return { kind: { oneofKind: 'stringValue', stringValue: value } }; return { kind: { oneofKind: 'structValue', structValue: jsonToProtoStruct(value as JsonObject) } }; }
export function protoStructToJson(value?: ProtoStruct): JsonObject { const output: JsonObject = {}; for (const [key, item] of Object.entries(value?.fields || {})) output[key] = protoValueToJson(item); return output; }
function protoValueToJson(value?: ProtoValue): JsonValue { switch (value?.kind.oneofKind) { case 'boolValue': return value.kind.boolValue; case 'numberValue': return value.kind.numberValue; case 'stringValue': return value.kind.stringValue; case 'structValue': return protoStructToJson(value.kind.structValue); case 'listValue': return (value.kind.listValue?.values || []).map(protoValueToJson); default: return null; } }

function detailToProtoInput(provider: string, detail: RuntimeCatalogModelDetail): CatalogModelInput {
  return {
    provider: provider.trim(),
    modelId: detail.modelId.trim(),
    modelType: detail.modelType.trim(),
    updatedAt: detail.updatedAt.trim(),
    capabilities: detail.capabilities.map((item) => item.trim()).filter(Boolean),
    pricing: { unit: detail.pricing.unit.trim(), input: detail.pricing.input.trim(), output: detail.pricing.output.trim(), currency: detail.pricing.currency.trim(), asOf: detail.pricing.asOf.trim(), notes: detail.pricing.notes.trim() } satisfies CatalogPricing,
    voiceSetId: detail.voiceSetId.trim(),
    voiceDiscoveryMode: detail.voiceDiscoveryMode.trim(),
    voiceRefKinds: detail.voiceRefKinds.map((item) => item.trim()).filter(Boolean),
    videoGeneration: detail.videoGeneration ? { modes: detail.videoGeneration.modes, inputRoles: detail.videoGeneration.inputRoles, limits: jsonToProtoStruct(detail.videoGeneration.limits), optionSupports: detail.videoGeneration.optionSupports, optionConstraints: jsonToProtoStruct(detail.videoGeneration.optionConstraints), outputs: detail.videoGeneration.outputs } : undefined,
    sourceRef: { url: detail.sourceRef.url.trim(), retrievedAt: detail.sourceRef.retrievedAt.trim(), note: detail.sourceRef.note.trim() } satisfies CatalogSourceRef,
  };
}

export async function sdkListModelCatalogProviders(): Promise<RuntimeModelCatalogProvider[]> { const response = await runtimeAdmin().listModelCatalogProviders({}, CATALOG_CALL_OPTIONS); return (response.providers || []).map(normalizeProviderEntry).sort((a, b) => a.provider.localeCompare(b.provider)); }
export async function sdkListCatalogProviderModels(provider: string, pageSize = 500, pageToken = ''): Promise<RuntimeCatalogProviderModelsResponse> { const response = await runtimeAdmin().listCatalogProviderModels({ provider: provider.trim(), pageSize, pageToken }, CATALOG_CALL_OPTIONS); return { provider: normalizeProviderEntry(response.provider || {} as ModelCatalogProviderEntry), models: (response.models || []).map(normalizeModelSummary), nextPageToken: String(response.nextPageToken || '').trim(), warnings: normalizeWarnings(response.warnings) }; }
export async function sdkGetCatalogModelDetail(provider: string, modelId: string): Promise<RuntimeCatalogModelDetailResponse> { const response = await runtimeAdmin().getCatalogModelDetail({ provider: provider.trim(), modelId: modelId.trim() }, CATALOG_CALL_OPTIONS); return { provider: normalizeProviderEntry(response.provider || {} as ModelCatalogProviderEntry), model: normalizeModelDetail(response.model), warnings: normalizeWarnings(response.warnings) }; }
export async function sdkUpsertCatalogModelOverlay(provider: string, input: RuntimeCatalogModelOverlayInput): Promise<RuntimeCatalogModelDetailResponse> { const response = await runtimeAdmin().upsertCatalogModelOverlay({ provider: provider.trim(), model: detailToProtoInput(provider, input.model), voices: (input.voices || []).map((voice) => ({ voiceSetId: voice.voiceSetId.trim(), provider: provider.trim(), voiceId: voice.voiceId.trim(), name: voice.name.trim(), langs: voice.langs.map((item) => item.trim()).filter(Boolean), modelIds: voice.modelIds.map((item) => item.trim()).filter(Boolean), sourceRef: { url: voice.sourceRef.url.trim(), retrievedAt: voice.sourceRef.retrievedAt.trim(), note: voice.sourceRef.note.trim() } } satisfies CatalogVoiceEntry)), voiceWorkflowModels: (input.voiceWorkflowModels || []).map((workflow) => ({ workflowModelId: workflow.workflowModelId.trim(), workflowType: workflow.workflowType.trim(), inputContractRef: workflow.inputContractRef.trim(), outputPersistence: workflow.outputPersistence.trim(), targetModelRefs: workflow.targetModelRefs.map((item) => item.trim()).filter(Boolean), langs: workflow.langs.map((item) => item.trim()).filter(Boolean), sourceRef: { url: workflow.sourceRef.url.trim(), retrievedAt: workflow.sourceRef.retrievedAt.trim(), note: workflow.sourceRef.note.trim() } } satisfies CatalogWorkflowModel)), modelWorkflowBinding: input.modelWorkflowBinding ? { modelId: input.modelWorkflowBinding.modelId.trim(), workflowModelRefs: input.modelWorkflowBinding.workflowModelRefs.map((item) => item.trim()).filter(Boolean), workflowTypes: input.modelWorkflowBinding.workflowTypes.map((item) => item.trim()).filter(Boolean) } satisfies CatalogModelWorkflowBinding : undefined }, CATALOG_CALL_OPTIONS); return { provider: normalizeProviderEntry(response.provider || {} as ModelCatalogProviderEntry), model: normalizeModelDetail(response.model), warnings: normalizeWarnings(response.warnings) }; }
export async function sdkDeleteCatalogModelOverlay(provider: string, modelId: string): Promise<RuntimeModelCatalogProvider> { const response = await runtimeAdmin().deleteCatalogModelOverlay({ provider: provider.trim(), modelId: modelId.trim() }, CATALOG_CALL_OPTIONS); return normalizeProviderEntry(response.provider || {} as ModelCatalogProviderEntry); }
export async function sdkUpsertModelCatalogProvider(provider: string, yaml: string): Promise<RuntimeModelCatalogProvider> { const response = await runtimeAdmin().upsertModelCatalogProvider({ provider: provider.trim(), yaml: yaml.trim() }, CATALOG_CALL_OPTIONS); return normalizeProviderEntry(response.provider || {} as ModelCatalogProviderEntry); }
export async function sdkDeleteModelCatalogProvider(provider: string): Promise<void> { await runtimeAdmin().deleteModelCatalogProvider({ provider: provider.trim() }, CATALOG_CALL_OPTIONS); }
