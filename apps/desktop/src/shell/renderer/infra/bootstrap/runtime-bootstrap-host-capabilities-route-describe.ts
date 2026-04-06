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
import { localRuntime } from '@runtime/local-runtime';
import { buildRuntimeCallOptions } from '@runtime/llm-adapter/execution/runtime-ai-bridge';

const TEXT_GENERATE_ROUTE_DESCRIBE_PROBE_NAMESPACE = 'nimi.scenario.text_generate.route_describe';
const TEXT_GENERATE_ROUTE_DESCRIBE_PROBE_TEXT = 'runtime.route.describe(text.generate)';

type RuntimeCallOptionsWithResponseMetadataObserver = RuntimeCallOptions & {
  _responseMetadataObserver?: (metadata: Record<string, string>) => void;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function hasCapability(capabilities: readonly string[] | undefined, expected: string): boolean {
  return (capabilities || []).some((capability) => normalizeText(capability) === expected);
}

function supportsTextPromptFromContractRef(value: string): boolean {
  return /(^|[._/-])(text|prompt)([._/-]|$)/i.test(value);
}

function schemaHasAnyKey(schema: unknown, keys: string[]): boolean {
  const record = asRecord(schema);
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function createMetadataUnavailableError(message: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.RUNTIME_ROUTE_UNAVAILABLE,
    actionHint: 'resolve_runtime_route_metadata_truth',
    source: 'runtime',
  });
}

async function describeVoiceWorkflowCloudRoute(input: {
  capability: 'voice_workflow.tts_v2v' | 'voice_workflow.tts_t2v';
  resolvedBinding: ModRuntimeResolvedBinding;
  resolvedBindingRef: string;
}): Promise<RuntimeRouteDescribeResult> {
  const provider = normalizeText(input.resolvedBinding.provider);
  const modelId = normalizeText(input.resolvedBinding.modelId) || normalizeText(input.resolvedBinding.model);
  if (!provider || !modelId) {
    throw createMetadataUnavailableError('voice workflow cloud route metadata requires provider and model id');
  }

  const runtime = getPlatformClient().runtime;
  const detail = await runtime.connector.getCatalogModelDetail({
    provider,
    modelId,
  });
  const model = detail.model;
  const workflowType = input.capability === 'voice_workflow.tts_v2v' ? 'tts_v2v' : 'tts_t2v';
  const workflow = model?.voiceWorkflowModels.find((entry) => normalizeText(entry.workflowType) === workflowType) || null;
  if (!model || !workflow) {
    throw createMetadataUnavailableError(`voice workflow metadata missing for ${input.capability}`);
  }

  const requiresTargetSynthesisBinding = Boolean(
    model.modelWorkflowBinding
    && model.modelWorkflowBinding.workflowTypes.some((entry) => normalizeText(entry) === workflowType)
    && model.modelWorkflowBinding.workflowModelRefs.length > 0,
  );

  if (input.capability === 'voice_workflow.tts_v2v') {
    return {
      capability: input.capability,
      metadataVersion: 'v1',
      resolvedBindingRef: input.resolvedBindingRef,
      metadataKind: input.capability,
      metadata: {
        workflowType: 'tts_v2v',
        supportsReferenceAudioInput: true,
        supportsTextPromptInput: supportsTextPromptFromContractRef(normalizeText(workflow.inputContractRef)),
        requiresTargetSynthesisBinding,
      },
    };
  }

  return {
    capability: input.capability,
    metadataVersion: 'v1',
    resolvedBindingRef: input.resolvedBindingRef,
    metadataKind: input.capability,
    metadata: {
      workflowType: 'tts_t2v',
      supportsReferenceAudioInput: false,
      supportsTextPromptInput: true,
      requiresTargetSynthesisBinding,
    },
  };
}

async function describeVoiceWorkflowLocalRoute(input: {
  capability: 'voice_workflow.tts_v2v' | 'voice_workflow.tts_t2v';
  resolvedBinding: ModRuntimeResolvedBinding;
  resolvedBindingRef: string;
}): Promise<RuntimeRouteDescribeResult> {
  const nodes = await localRuntime.listNodesCatalog({
    capability: input.capability,
    provider: normalizeText(input.resolvedBinding.provider) || undefined,
  });
  const node = nodes.find((entry) => (
    entry.available && hasCapability(entry.capabilities, input.capability)
  )) || null;
  if (!node) {
    throw createMetadataUnavailableError(`local voice workflow node missing for ${input.capability}`);
  }

  const requiresTargetSynthesisBinding = schemaHasAnyKey(node.inputSchema, [
    'targetModel',
    'target_model',
    'synthesisModel',
    'target_synthesis_binding',
  ]);

  if (input.capability === 'voice_workflow.tts_v2v') {
    return {
      capability: input.capability,
      metadataVersion: 'v1',
      resolvedBindingRef: input.resolvedBindingRef,
      metadataKind: input.capability,
      metadata: {
        workflowType: 'tts_v2v',
        supportsReferenceAudioInput: true,
        supportsTextPromptInput: schemaHasAnyKey(node.inputSchema, [
          'text',
          'textPrompt',
          'text_prompt',
          'prompt',
        ]),
        requiresTargetSynthesisBinding,
      },
    };
  }

  return {
    capability: input.capability,
    metadataVersion: 'v1',
    resolvedBindingRef: input.resolvedBindingRef,
    metadataKind: input.capability,
    metadata: {
      workflowType: 'tts_t2v',
      supportsReferenceAudioInput: false,
      supportsTextPromptInput: true,
      requiresTargetSynthesisBinding,
    },
  };
}

function toRuntimeRoutePolicy(source: ModRuntimeResolvedBinding['source']): RoutePolicy {
  return source === 'cloud' ? RoutePolicy.CLOUD : RoutePolicy.LOCAL;
}

async function describeTextGenerateRoute(input: {
  modId: string;
  resolvedBinding: ModRuntimeResolvedBinding;
  resolvedBindingRef: string;
}): Promise<RuntimeRouteDescribeResult> {
  const runtime = getPlatformClient().runtime;
  const modelId = normalizeText(input.resolvedBinding.modelId) || normalizeText(input.resolvedBinding.model);
  if (!modelId) {
    throw createMetadataUnavailableError('text.generate route metadata requires model id');
  }
  if (input.resolvedBinding.source === 'cloud' && !normalizeText(input.resolvedBinding.connectorId)) {
    throw createMetadataUnavailableError(
      'text.generate route metadata requires managed connector authority on Desktop; inline cloud bindings remain fail-closed',
    );
  }

  let responseMetadata: Record<string, string> | null = null;
  const callOptions: RuntimeCallOptionsWithResponseMetadataObserver = {
    ...(await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs: 10_000,
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
      timeoutMs: 10_000,
      connectorId: normalizeText(input.resolvedBinding.connectorId),
    },
    scenarioType: ScenarioType.TEXT_GENERATE,
    executionMode: ExecutionMode.SYNC,
    extensions: [{
      namespace: TEXT_GENERATE_ROUTE_DESCRIBE_PROBE_NAMESPACE,
      payload: toProtoStruct({
        version: 'v1',
        resolvedBindingRef: input.resolvedBindingRef,
        localModelId: normalizeText(input.resolvedBinding.localModelId),
        goRuntimeLocalModelId: normalizeText(input.resolvedBinding.goRuntimeLocalModelId),
        engine: normalizeText(input.resolvedBinding.engine),
        modelId,
      }),
    }],
    spec: {
      spec: {
        oneofKind: 'textGenerate',
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
    },
  }, callOptions);

  try {
    return decodeRuntimeRouteDescribeResultFromMetadata({
      metadata: responseMetadata,
      expectedCapability: 'text.generate',
      expectedResolvedBindingRef: input.resolvedBindingRef,
    });
  } catch (error) {
    throw createMetadataUnavailableError(
      `text.generate route metadata probe failed: ${error instanceof Error ? error.message : 'unknown decode failure'}`,
    );
  }
}

export async function describeRuntimeRouteMetadata(input: {
  modId: string;
  capability: 'text.generate' | 'voice_workflow.tts_v2v' | 'voice_workflow.tts_t2v';
  resolvedBinding: ModRuntimeResolvedBinding;
  resolvedBindingRef: string;
}): Promise<RuntimeRouteDescribeResult> {
  if (input.capability === 'text.generate') {
    return describeTextGenerateRoute({
      modId: input.modId,
      resolvedBinding: input.resolvedBinding,
      resolvedBindingRef: input.resolvedBindingRef,
    });
  }

  const workflowInput = input as {
    modId: string;
    capability: 'voice_workflow.tts_v2v' | 'voice_workflow.tts_t2v';
    resolvedBinding: ModRuntimeResolvedBinding;
    resolvedBindingRef: string;
  };
  if (workflowInput.resolvedBinding.source === 'cloud') {
    return describeVoiceWorkflowCloudRoute(workflowInput);
  }
  return describeVoiceWorkflowLocalRoute(workflowInput);
}
