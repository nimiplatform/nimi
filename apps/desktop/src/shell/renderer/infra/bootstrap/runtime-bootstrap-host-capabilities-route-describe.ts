import {
  createNimiError,
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
  toProtoStruct,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeCallOptions } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  ModRuntimeResolvedBinding,
  RuntimeRouteDescribeResult,
} from '@nimiplatform/sdk/mod';
import {
  decodeRuntimeRouteDescribeResultFromMetadata,
} from '@nimiplatform/sdk/mod';
import { getPlatformClient } from '@nimiplatform/sdk';
import { buildRuntimeCallOptions } from '@runtime/llm-adapter/execution/runtime-ai-bridge';

const ROUTE_DESCRIBE_PROBE_TIMEOUT_MS = 10_000;
const TEXT_GENERATE_ROUTE_DESCRIBE_PROBE_NAMESPACE = 'nimi.scenario.text_generate.route_describe';
const VOICE_CLONE_ROUTE_DESCRIBE_PROBE_NAMESPACE = 'nimi.scenario.voice_clone.route_describe';
const VOICE_DESIGN_ROUTE_DESCRIBE_PROBE_NAMESPACE = 'nimi.scenario.voice_design.route_describe';
const TEXT_GENERATE_ROUTE_DESCRIBE_PROBE_TEXT = 'runtime.route.describe(text.generate)';
const VOICE_CLONE_ROUTE_DESCRIBE_PROBE_TEXT = 'runtime.route.describe(voice_workflow.tts_v2v)';
const VOICE_DESIGN_ROUTE_DESCRIBE_PROBE_TEXT = 'runtime.route.describe(voice_workflow.tts_t2v)';
const VOICE_CLONE_ROUTE_DESCRIBE_REFERENCE_AUDIO_BYTES = new Uint8Array([0]);

type RouteDescribeCapability =
  | 'text.generate'
  | 'voice_workflow.tts_v2v'
  | 'voice_workflow.tts_t2v';

type RuntimeCallOptionsWithResponseMetadataObserver = RuntimeCallOptions & {
  _responseMetadataObserver?: (metadata: Record<string, string>) => void;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createMetadataUnavailableError(message: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.RUNTIME_ROUTE_UNAVAILABLE,
    actionHint: 'resolve_runtime_route_metadata_truth',
    source: 'runtime',
  });
}

function toRuntimeRoutePolicy(source: ModRuntimeResolvedBinding['source']): RoutePolicy {
  return source === 'cloud' ? RoutePolicy.CLOUD : RoutePolicy.LOCAL;
}

function requireDescribeModelId(resolvedBinding: ModRuntimeResolvedBinding): string {
  const modelId = normalizeText(resolvedBinding.modelId) || normalizeText(resolvedBinding.model);
  if (!modelId) {
    throw createMetadataUnavailableError('runtime.route.describe metadata probe requires model id');
  }
  return modelId;
}

function assertManagedCloudBindingAuthority(resolvedBinding: ModRuntimeResolvedBinding): void {
  if (
    resolvedBinding.source === 'cloud'
    && !normalizeText(resolvedBinding.connectorId)
  ) {
    throw createMetadataUnavailableError(
      'runtime.route.describe metadata probe requires managed connector authority on Desktop; inline cloud bindings remain fail-closed',
    );
  }
}

function buildDescribeProbeExtensions(
  capability: RouteDescribeCapability,
  resolvedBindingRef: string,
  resolvedBinding: ModRuntimeResolvedBinding,
) {
  const namespace = capability === 'text.generate'
    ? TEXT_GENERATE_ROUTE_DESCRIBE_PROBE_NAMESPACE
    : capability === 'voice_workflow.tts_v2v'
      ? VOICE_CLONE_ROUTE_DESCRIBE_PROBE_NAMESPACE
      : VOICE_DESIGN_ROUTE_DESCRIBE_PROBE_NAMESPACE;
  return [{
    namespace,
    payload: toProtoStruct({
      version: 'v1',
      resolvedBindingRef,
      ...(capability === 'text.generate'
        ? {
          localModelId: normalizeText(resolvedBinding.localModelId),
          goRuntimeLocalModelId: normalizeText(resolvedBinding.goRuntimeLocalModelId),
          engine: normalizeText(resolvedBinding.engine),
          modelId: normalizeText(resolvedBinding.modelId) || normalizeText(resolvedBinding.model),
        }
        : {}),
    }),
  }];
}

function buildDescribeProbeSpec(
  capability: RouteDescribeCapability,
  modelId: string,
) {
  if (capability === 'text.generate') {
    return {
      spec: {
        oneofKind: 'textGenerate' as const,
        textGenerate: {
          input: [{
            role: 'user',
            content: TEXT_GENERATE_ROUTE_DESCRIBE_PROBE_TEXT,
            name: '',
            parts: [],
          }],
          systemPrompt: '',
          tools: [],
          temperature: 0,
          topP: 0,
          maxTokens: 1,
        },
      },
    };
  }

  if (capability === 'voice_workflow.tts_v2v') {
    return {
      spec: {
        oneofKind: 'voiceClone' as const,
        voiceClone: {
          targetModelId: modelId,
          input: {
            referenceAudioBytes: VOICE_CLONE_ROUTE_DESCRIBE_REFERENCE_AUDIO_BYTES,
            referenceAudioMime: 'audio/wav',
            text: VOICE_CLONE_ROUTE_DESCRIBE_PROBE_TEXT,
          },
        },
      },
    };
  }

  return {
    spec: {
      oneofKind: 'voiceDesign' as const,
      voiceDesign: {
        targetModelId: modelId,
        input: {
          instructionText: VOICE_DESIGN_ROUTE_DESCRIBE_PROBE_TEXT,
        },
      },
    },
  };
}

function toRouteDescribeScenarioType(capability: RouteDescribeCapability): ScenarioType {
  if (capability === 'text.generate') {
    return ScenarioType.TEXT_GENERATE;
  }
  if (capability === 'voice_workflow.tts_v2v') {
    return ScenarioType.VOICE_CLONE;
  }
  return ScenarioType.VOICE_DESIGN;
}

async function describeRouteViaRuntimeProbe(input: {
  modId: string;
  capability: RouteDescribeCapability;
  resolvedBinding: ModRuntimeResolvedBinding;
  resolvedBindingRef: string;
}): Promise<RuntimeRouteDescribeResult> {
  const runtime = getPlatformClient().runtime;
  const modelId = requireDescribeModelId(input.resolvedBinding);
  assertManagedCloudBindingAuthority(input.resolvedBinding);

  let responseMetadata: Record<string, string> | null = null;
  const callOptions: RuntimeCallOptionsWithResponseMetadataObserver = {
    ...(await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs: ROUTE_DESCRIBE_PROBE_TIMEOUT_MS,
      source: input.resolvedBinding.source,
      connectorId: normalizeText(input.resolvedBinding.connectorId) || undefined,
      providerEndpoint: normalizeText(input.resolvedBinding.endpoint) || undefined,
    })),
    _responseMetadataObserver: (metadata: Record<string, string>) => {
      responseMetadata = metadata;
    },
  };

  await runtime.ai.executeScenario({
    head: {
      appId: runtime.appId,
      modelId,
      routePolicy: toRuntimeRoutePolicy(input.resolvedBinding.source),
      timeoutMs: ROUTE_DESCRIBE_PROBE_TIMEOUT_MS,
      connectorId: normalizeText(input.resolvedBinding.connectorId),
    },
    scenarioType: toRouteDescribeScenarioType(input.capability),
    executionMode: ExecutionMode.SYNC,
    extensions: buildDescribeProbeExtensions(
      input.capability,
      input.resolvedBindingRef,
      input.resolvedBinding,
    ),
    spec: buildDescribeProbeSpec(input.capability, modelId),
  }, callOptions);

  try {
    return decodeRuntimeRouteDescribeResultFromMetadata({
      metadata: responseMetadata,
      expectedCapability: input.capability,
      expectedResolvedBindingRef: input.resolvedBindingRef,
    });
  } catch (error) {
    throw createMetadataUnavailableError(
      `runtime.route.describe metadata probe failed: ${error instanceof Error ? error.message : 'unknown decode failure'}`,
    );
  }
}

export async function describeRuntimeRouteMetadata(input: {
  modId: string;
  capability: RouteDescribeCapability;
  resolvedBinding: ModRuntimeResolvedBinding;
  resolvedBindingRef: string;
}): Promise<RuntimeRouteDescribeResult> {
  return describeRouteViaRuntimeProbe(input);
}
