import type {
  ScenarioSpec,
} from './generated/runtime/v1/ai.js';
import {
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
} from './generated/runtime/v1/ai.js';
import { toProtoStruct } from './runtime-proto-struct-codec.js';
import { createNimiError } from '../core/errors.js';
import type {
  RuntimeAiExecuteScenarioRequestInput,
} from './types-runtime-modules.js';
import type {
  RuntimeCallOptions,
  RuntimeResponseMetadataObserver,
} from './types.js';
import type {
  RuntimeRouteHealthResult,
} from './runtime-route-types.js';
import { ReasonCode } from '../types/index.js';
import {
  decodeRuntimeRouteDescribeResultFromMetadata,
  runtimeRouteCallTargetFromResolvedBinding,
  selectRuntimeLocalWarmCandidateFromResolvedBinding,
  type RuntimeRouteBinding,
  type RuntimeCanonicalCapability,
  type RuntimeRouteLocalWarmAssetEvidence,
  type RuntimeRouteLocalWarmCandidate,
  type RuntimeResolvedBinding,
  type RuntimeRouteDescribeResult,
  type RuntimeRouteOptionsSnapshot,
  type RuntimeRouteSource,
} from './runtime-route.js';
import {
  buildRuntimeRouteOptionsProjection,
  type RuntimeRouteConnectorModelDescriptorProjectionInput,
  type RuntimeRouteLocalAssetProjectionInput,
  type RuntimeRouteLocalStatusMismatch,
  type RuntimeRouteNodeCatalogProjectionInput,
} from './runtime-route-options.js';
import type { JsonObject } from '../internal/utils.js';
export * from './runtime-route-host-local-warm.js';

export const RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS = 30_000;

const ROUTE_DESCRIBE_PROBE_TEXT = 'route describe probe';
const ROUTE_DESCRIBE_PROBE_AUDIO_BYTES = new Uint8Array([0]);

export type RuntimeRouteDescribeScenarioProbe = {
  namespace: string;
  scenarioType: ScenarioType;
  spec: ScenarioSpec;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export type RuntimeRouteHostHealthInput = {
  provider: string;
  capability?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  connectorId?: string;
};

export type RuntimeRouteHostProviderHealth = {
  provider?: string;
  endpoint?: string | null;
  model?: string;
  status?: 'healthy' | 'degraded' | 'unsupported' | 'unreachable' | 'unavailable' | string;
  detail?: string;
};

export type RuntimeRouteDescribeCallOptions = RuntimeCallOptions & {
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeRouteDescribeCallOptionsInput = {
  targetId: string;
  timeoutMs: number;
  source: RuntimeRouteSource;
  connectorId?: string;
  providerEndpoint?: string;
};

export type RuntimeRouteDescribeCallOptionsBuilder = (
  input: RuntimeRouteDescribeCallOptionsInput,
) => Promise<RuntimeRouteDescribeCallOptions>;

export type RuntimeRouteExecuteScenario = (
  request: RuntimeAiExecuteScenarioRequestInput,
  options: RuntimeRouteDescribeCallOptions,
) => Promise<unknown>;

export type RuntimeRouteHostConnectorDescriptor = {
  id?: string;
  label?: string;
  vendor?: string;
  provider?: string;
};

export type RuntimeRouteHostLocalMetadata = {
  snapshotAssets?: RuntimeRouteLocalAssetProjectionInput[];
  nodeCatalog?: RuntimeRouteNodeCatalogProjectionInput[];
  runtimeLocalModels?: RuntimeRouteLocalAssetProjectionInput[];
};

export type RuntimeRouteHostOptionsContext = {
  capability: RuntimeCanonicalCapability;
  targetId?: string;
};

export type RuntimeRouteHostConnectorModelDescriptorsContext = RuntimeRouteHostOptionsContext & {
  connectorId: string;
};

export type RuntimeRouteHostLocalMetadataFallback = {
  metadata: RuntimeRouteHostLocalMetadata;
  localMetadataDegraded?: boolean;
};

export type RuntimeRouteHostOptionsDeps = {
  scope?: object;
  listConnectors: () => Promise<RuntimeRouteHostConnectorDescriptor[]>;
  listConnectorModelDescriptors: (
    connectorId: string,
  ) => Promise<RuntimeRouteConnectorModelDescriptorProjectionInput[]>;
  loadLocalRouteMetadata: (
    context: RuntimeRouteHostOptionsContext,
  ) => Promise<RuntimeRouteHostLocalMetadata>;
  onListConnectorsError?: (
    error: unknown,
    context: RuntimeRouteHostOptionsContext,
  ) => Promise<RuntimeRouteHostConnectorDescriptor[]> | RuntimeRouteHostConnectorDescriptor[];
  onListConnectorModelDescriptorsError?: (
    error: unknown,
    context: RuntimeRouteHostConnectorModelDescriptorsContext,
  ) => Promise<RuntimeRouteConnectorModelDescriptorProjectionInput[]> | RuntimeRouteConnectorModelDescriptorProjectionInput[];
  onLocalRouteMetadataError?: (
    error: unknown,
    context: RuntimeRouteHostOptionsContext,
  ) => Promise<RuntimeRouteHostLocalMetadataFallback> | RuntimeRouteHostLocalMetadataFallback;
  onLocalStatusMismatch?: (mismatch: RuntimeRouteLocalStatusMismatch) => void;
};

type RuntimeRouteHostOptionsData = {
  connectors: RuntimeRouteHostConnectorProjection[];
  localMetadata: RuntimeRouteHostLocalMetadata;
  localMetadataDegraded: boolean;
};

type RuntimeRouteHostConnectorProjection = {
  descriptor: RuntimeRouteHostConnectorDescriptor & { id: string };
  modelDescriptors: RuntimeRouteConnectorModelDescriptorProjectionInput[];
};

const DEFAULT_RUNTIME_ROUTE_HOST_OPTIONS_SCOPE: Record<string, never> = {};
const runtimeRouteHostOptionsInflightByScope = new WeakMap<object, Map<string, Promise<RuntimeRouteHostOptionsData>>>();

function getRuntimeRouteHostOptionsInflightMap(scope: object): Map<string, Promise<RuntimeRouteHostOptionsData>> {
  const existing = runtimeRouteHostOptionsInflightByScope.get(scope);
  if (existing) {
    return existing;
  }
  const created = new Map<string, Promise<RuntimeRouteHostOptionsData>>();
  runtimeRouteHostOptionsInflightByScope.set(scope, created);
  return created;
}

async function listRuntimeRouteHostOptionsData(
  context: RuntimeRouteHostOptionsContext,
  deps: RuntimeRouteHostOptionsDeps,
): Promise<RuntimeRouteHostOptionsData> {
  const connectorDescriptorsPromise = deps.listConnectors().catch((error) => {
    if (deps.onListConnectorsError) {
      return deps.onListConnectorsError(error, context);
    }
    throw error;
  });

  let localMetadataDegraded = false;
  const localMetadataPromise = deps.loadLocalRouteMetadata(context).catch(async (error) => {
    if (!deps.onLocalRouteMetadataError) {
      throw error;
    }
    const fallback = await deps.onLocalRouteMetadataError(error, context);
    localMetadataDegraded = Boolean(fallback.localMetadataDegraded);
    return fallback.metadata;
  });

  const [connectorDescriptors, localMetadata] = await Promise.all([
    connectorDescriptorsPromise,
    localMetadataPromise,
  ]);

  const connectorResults: Array<RuntimeRouteHostConnectorProjection | null> = await Promise.all((connectorDescriptors || []).map(async (connector) => {
    const connectorId = normalizeText(connector.id);
    if (!connectorId) {
      return null;
    }
    const modelDescriptors = await deps.listConnectorModelDescriptors(connectorId).catch((error) => {
      if (deps.onListConnectorModelDescriptorsError) {
        return deps.onListConnectorModelDescriptorsError(error, {
          ...context,
          connectorId,
        });
      }
      throw error;
    });
    return {
      descriptor: {
        id: connectorId,
        label: connector.label,
        vendor: connector.vendor,
        provider: connector.provider,
      },
      modelDescriptors,
    };
  }));

  return {
    connectors: connectorResults.filter((connector): connector is RuntimeRouteHostConnectorProjection => connector !== null),
    localMetadata,
    localMetadataDegraded,
  };
}

async function listRuntimeRouteHostOptionsDataSingleFlight(
  context: RuntimeRouteHostOptionsContext,
  deps: RuntimeRouteHostOptionsDeps,
): Promise<RuntimeRouteHostOptionsData> {
  const scope = deps.scope || DEFAULT_RUNTIME_ROUTE_HOST_OPTIONS_SCOPE;
  const inflight = getRuntimeRouteHostOptionsInflightMap(scope);
  const existing = inflight.get(context.capability);
  if (existing) {
    return existing;
  }
  const request = listRuntimeRouteHostOptionsData(context, deps)
    .finally(() => {
      if (inflight.get(context.capability) === request) {
        inflight.delete(context.capability);
      }
    });
  inflight.set(context.capability, request);
  return request;
}

export async function listRuntimeRouteOptionsWithHost(input: {
  capability: RuntimeCanonicalCapability;
  targetId?: string;
  selectedBinding?: RuntimeRouteBinding | null;
}, deps: RuntimeRouteHostOptionsDeps): Promise<RuntimeRouteOptionsSnapshot> {
  const context = {
    capability: input.capability,
    targetId: normalizeText(input.targetId) || undefined,
  };
  const data = await listRuntimeRouteHostOptionsDataSingleFlight(context, deps);
  return buildRuntimeRouteOptionsProjection({
    capability: input.capability,
    selectedBinding: input.selectedBinding,
    connectors: data.connectors,
    snapshotAssets: data.localMetadata.snapshotAssets,
    nodeCatalog: data.localMetadata.nodeCatalog,
    runtimeLocalModels: data.localMetadata.runtimeLocalModels,
    localMetadataDegraded: data.localMetadataDegraded,
    onLocalStatusMismatch: deps.onLocalStatusMismatch,
  });
}

export function runtimeRouteHealthInputFromResolvedBinding(
  resolved: RuntimeResolvedBinding,
): RuntimeRouteHostHealthInput {
  return {
    provider: normalizeText(resolved.provider || resolved.engine),
    capability: resolved.capability,
    localProviderEndpoint: normalizeText(resolved.localProviderEndpoint || resolved.endpoint) || undefined,
    localProviderModel: normalizeText(resolved.modelId || resolved.model || resolved.localModelId) || undefined,
    localOpenAiEndpoint: normalizeText(resolved.localOpenAiEndpoint || resolved.endpoint) || undefined,
    localModelId: normalizeText(resolved.localModelId) || undefined,
    goRuntimeLocalModelId: normalizeText(resolved.goRuntimeLocalModelId || resolved.localModelId) || undefined,
    connectorId: normalizeText(resolved.connectorId) || undefined,
  };
}

export function runtimeRouteHealthResultFromProviderHealth(input: {
  resolved: RuntimeResolvedBinding;
  health: RuntimeRouteHostProviderHealth;
}): RuntimeRouteHealthResult {
  const available = input.health.status === 'healthy' || input.health.status === 'degraded';
  return {
    healthy: available,
    status: available ? input.health.status : 'unavailable',
    provider: normalizeText(input.health.provider || input.resolved.provider),
    detail: normalizeText(input.health.detail),
    actionHint: available
      ? 'none'
      : (input.resolved.source === 'cloud' ? 'verify-connector' : 'install-local-model'),
  };
}

export async function checkRuntimeRouteHealthWithHost(input: {
  resolved: RuntimeResolvedBinding;
  checkHealth: (request: RuntimeRouteHostHealthInput) => Promise<RuntimeRouteHostProviderHealth>;
}): Promise<RuntimeRouteHealthResult> {
  const health = await input.checkHealth(runtimeRouteHealthInputFromResolvedBinding(input.resolved));
  return runtimeRouteHealthResultFromProviderHealth({
    resolved: input.resolved,
    health,
  });
}

export function buildRuntimeRouteDescribeScenarioProbe(input: {
  capability: RuntimeCanonicalCapability;
  modelId: string;
}): RuntimeRouteDescribeScenarioProbe {
  if (input.capability === 'text.generate') {
    return {
      namespace: 'nimi.scenario.text_generate.route_describe',
      scenarioType: ScenarioType.TEXT_GENERATE,
      spec: {
        spec: {
          oneofKind: 'textGenerate',
          textGenerate: {
            input: [{
              role: 'user',
              content: ROUTE_DESCRIBE_PROBE_TEXT,
              name: '',
              parts: [],
            }],
            systemPrompt: '',
            tools: [],
            temperature: 0,
            topP: 0,
            maxTokens: 0,
          },
        },
      },
    };
  }
  if (input.capability === 'audio.synthesize') {
    return {
      namespace: 'nimi.scenario.speech_synthesize.route_describe',
      scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
      spec: {
        spec: {
          oneofKind: 'speechSynthesize',
          speechSynthesize: {
            text: ROUTE_DESCRIBE_PROBE_TEXT,
            audioFormat: 'mp3',
            language: '',
            sampleRateHz: 0,
            speed: 0,
            pitch: 0,
            volume: 0,
            emotion: '',
            timingMode: 3,
          },
        },
      },
    };
  }
  if (input.capability === 'audio.transcribe') {
    return {
      namespace: 'nimi.scenario.speech_transcribe.route_describe',
      scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
      spec: {
        spec: {
          oneofKind: 'speechTranscribe',
          speechTranscribe: {
            mimeType: 'audio/wav',
            language: '',
            timestamps: false,
            diarization: false,
            speakerCount: 0,
            prompt: '',
            responseFormat: 'json',
            audioSource: {
              source: {
                oneofKind: 'audioBytes',
                audioBytes: ROUTE_DESCRIBE_PROBE_AUDIO_BYTES,
              },
            },
          },
        },
      },
    };
  }
  if (input.capability === 'voice_workflow.voice_clone') {
    return {
      namespace: 'nimi.scenario.voice_clone.route_describe',
      scenarioType: ScenarioType.VOICE_CLONE,
      spec: {
        spec: {
          oneofKind: 'voiceClone',
          voiceClone: {
            targetModelId: input.modelId,
            input: {
              referenceAudioBytes: ROUTE_DESCRIBE_PROBE_AUDIO_BYTES,
              referenceAudioMime: 'audio/wav',
              referenceAudioUri: '',
              text: '',
              preferredName: 'route-describe-probe',
              languageHints: [],
            },
          },
        },
      },
    };
  }
  if (input.capability === 'voice_workflow.voice_design') {
    return {
      namespace: 'nimi.scenario.voice_design.route_describe',
      scenarioType: ScenarioType.VOICE_DESIGN,
      spec: {
        spec: {
          oneofKind: 'voiceDesign',
          voiceDesign: {
            targetModelId: input.modelId,
            input: {
              instructionText: ROUTE_DESCRIBE_PROBE_TEXT,
              previewText: ROUTE_DESCRIBE_PROBE_TEXT,
              language: '',
              preferredName: 'route-describe-probe',
            },
          },
        },
      },
    };
  }
  throw new Error('RUNTIME_ROUTE_DESCRIBE_METADATA_MISSING');
}

export function buildRuntimeRouteDescribeExecuteScenarioRequest(input: {
  appId: string;
  capability: RuntimeCanonicalCapability;
  resolvedBindingRef: string;
  resolved: RuntimeResolvedBinding;
  timeoutMs?: number;
}): RuntimeAiExecuteScenarioRequestInput {
  const modelId = normalizeText(input.resolved.modelId || input.resolved.model || input.resolved.localModelId);
  if (!modelId) {
    throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  }
  const probe = buildRuntimeRouteDescribeScenarioProbe({
    capability: input.capability,
    modelId,
  });
  const payload = toProtoStruct(Object.fromEntries(Object.entries({
    version: 'v1',
    resolvedBindingRef: input.resolvedBindingRef,
    localModelId: normalizeText(input.resolved.localModelId) || undefined,
    goRuntimeLocalModelId: normalizeText(input.resolved.goRuntimeLocalModelId) || undefined,
    engine: normalizeText(input.resolved.engine || input.resolved.provider) || undefined,
    modelId,
  }).filter(([, value]) => value !== undefined)));
  if (!payload) {
    throw new Error('RUNTIME_ROUTE_DESCRIBE_PAYLOAD_INVALID');
  }
  return {
    head: {
      appId: input.appId,
      modelId,
      routePolicy: input.resolved.source === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD,
      timeoutMs: input.timeoutMs ?? RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS,
      connectorId: normalizeText(input.resolved.connectorId),
    },
    scenarioType: probe.scenarioType,
    executionMode: ExecutionMode.SYNC,
    spec: probe.spec,
    extensions: [{
      namespace: probe.namespace,
      payload,
    }],
  };
}

export async function describeRuntimeRouteWithHost(input: {
  appId: string;
  targetId: string;
  capability: RuntimeCanonicalCapability;
  resolvedBindingRef: string;
  resolved: RuntimeResolvedBinding;
  buildCallOptions: RuntimeRouteDescribeCallOptionsBuilder;
  executeScenario: RuntimeRouteExecuteScenario;
  timeoutMs?: number;
}): Promise<RuntimeRouteDescribeResult> {
  const timeoutMs = input.timeoutMs ?? RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS;
  const request = buildRuntimeRouteDescribeExecuteScenarioRequest({
    appId: input.appId,
    capability: input.capability,
    resolvedBindingRef: input.resolvedBindingRef,
    resolved: input.resolved,
    timeoutMs,
  });
  const responseMetadata: Record<string, string> = {};
  const baseOptions = await input.buildCallOptions({
    targetId: input.targetId,
    timeoutMs,
    source: input.resolved.source,
    connectorId: normalizeText(input.resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(
      input.resolved.endpoint || input.resolved.localProviderEndpoint || input.resolved.localOpenAiEndpoint,
    ) || undefined,
  });
  const baseObserver = baseOptions._responseMetadataObserver;
  await input.executeScenario(request, {
    ...baseOptions,
    _responseMetadataObserver: (metadata) => {
      Object.assign(responseMetadata, metadata);
      baseObserver?.(metadata);
    },
  });
  return decodeRuntimeRouteDescribeResultFromMetadata({
    metadata: responseMetadata,
    expectedCapability: input.capability,
    expectedResolvedBindingRef: input.resolvedBindingRef,
  });
}
