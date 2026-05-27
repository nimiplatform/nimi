import type {
  ScenarioSpec,
} from '../runtime/generated/runtime/v1/ai.js';
import {
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
} from '../runtime/generated/runtime/v1/ai.js';
import { toProtoStruct } from '../runtime/helpers.js';
import type {
  RuntimeAiExecuteScenarioRequestInput,
} from '../runtime/types-runtime-modules.js';
import type {
  RuntimeCallOptions,
  RuntimeResponseMetadataObserver,
} from '../runtime/types.js';
import type {
  RuntimeRouteHealthResult,
} from './types.js';
import {
  decodeRuntimeRouteDescribeResultFromMetadata,
  type RuntimeCanonicalCapability,
  type RuntimeResolvedBinding,
  type RuntimeRouteDescribeResult,
  type RuntimeRouteSource,
} from './runtime-route.js';

export const RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS = 30_000;

const ROUTE_DESCRIBE_PROBE_TEXT = 'route describe probe';
const ROUTE_DESCRIBE_PROBE_AUDIO_BYTES = new Uint8Array([0]);

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

export type RuntimeRouteDescribeScenarioProbe = {
  namespace: string;
  scenarioType: ScenarioType;
  spec: ScenarioSpec;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  const payload = toProtoStruct({
    version: 'v1',
    resolvedBindingRef: input.resolvedBindingRef,
    localModelId: normalizeText(input.resolved.localModelId) || undefined,
    goRuntimeLocalModelId: normalizeText(input.resolved.goRuntimeLocalModelId) || undefined,
    engine: normalizeText(input.resolved.engine || input.resolved.provider) || undefined,
    modelId,
  });
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
