import {
  createNimiError,
  ExecutionMode,
  ScenarioJobStatus,
  ScenarioType,
  toProtoStruct,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  buildRuntimeCallOptions,
  buildRuntimeRequestMetadata,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import type {
  AgentImageExecutionRuntimeDiagnostics,
  AgentRuntimeResolvedBinding,
  ChatAgentImageRuntimeInvokeDeps,
  ChatAgentImageRuntimeInvokeInput,
  ChatAgentImageRuntimeInvokeResult,
} from './chat-agent-runtime-types';
import { CORE_CHAT_AGENT_MOD_ID } from './chat-agent-runtime-types';
import {
  asRecord,
  encodeBytesAsDataUrl,
  normalizeText,
  requireValue,
  resolveExecutionSlice,
  sleepWithAbort,
  toRuntimeRoutePolicy,
} from './chat-agent-runtime-shared';
import {
  AGENT_CHAT_IMAGE_EXTENSION_NAMESPACE,
  buildAgentLocalImageWorkflowExtensions,
  parseAgentImageArtifactProtoDiagnostics,
  resolveAgentImageRequestConfig,
  resolveAgentImageScenarioArtifact,
} from './chat-agent-runtime-image-helpers';

export async function generateChatAgentImageRuntime(
  input: ChatAgentImageRuntimeInvokeInput,
  deps: ChatAgentImageRuntimeInvokeDeps = {},
): Promise<ChatAgentImageRuntimeInvokeResult> {
  const prompt = normalizeText(input.prompt);
  if (!prompt) {
    throw createNimiError({
      message: 'agent image prompt is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_image_prompt',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(input.imageExecutionSnapshot, 'image.generate');
  const resolved = slice.resolvedBinding as AgentRuntimeResolvedBinding;
  const imageCapabilityParams = asRecord(input.imageCapabilityParams);
  const {
    responseFormat,
    size,
    seed,
    timeoutMs,
  } = resolveAgentImageRequestConfig(imageCapabilityParams);
  const extensions = buildAgentLocalImageWorkflowExtensions({
    resolved,
    params: imageCapabilityParams,
  });
  const extensionPayload = extensions ? toProtoStruct(extensions) : undefined;
  const modelId = requireValue(
    resolved.modelId || resolved.model || resolved.localModelId,
    ReasonCode.AI_INPUT_INVALID,
    'select_runtime_route_binding',
    'agent image route model is missing',
  );
  const runtimeClient = (deps.getRuntimeClientImpl || getRuntimeClient)();
  let artifact: Record<string, unknown> | null;
  let traceId: string;
  let diagnostics: AgentImageExecutionRuntimeDiagnostics | null = null;

  if (runtimeClient.ai?.submitScenarioJob && runtimeClient.ai?.getScenarioJob && runtimeClient.ai?.getScenarioArtifacts) {
    const callOptions = await (deps.buildRuntimeCallOptionsImpl || buildRuntimeCallOptions)({
      modId: CORE_CHAT_AGENT_MOD_ID,
      timeoutMs: timeoutMs ?? 180_000,
      source: resolved.source,
      connectorId: normalizeText(resolved.connectorId) || undefined,
      providerEndpoint: normalizeText(resolved.endpoint)
        || normalizeText(resolved.localProviderEndpoint)
        || normalizeText(resolved.localOpenAiEndpoint)
        || undefined,
    });
    const submitStartedAt = Date.now();
    const submitResponse = await runtimeClient.ai.submitScenarioJob({
      head: {
        appId: runtimeClient.appId,
        modelId,
        routePolicy: toRuntimeRoutePolicy(resolved.source),
        timeoutMs: timeoutMs ?? 180_000,
        connectorId: normalizeText(resolved.connectorId),
      },
      scenarioType: ScenarioType.IMAGE_GENERATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      requestId: callOptions.idempotencyKey,
      idempotencyKey: callOptions.idempotencyKey,
      labels: {
        surface: 'agent-chat',
      },
      extensions: extensionPayload
        ? [{
          namespace: AGENT_CHAT_IMAGE_EXTENSION_NAMESPACE,
          payload: extensionPayload,
        }]
        : [],
      spec: {
        spec: {
          oneofKind: 'imageGenerate' as const,
          imageGenerate: {
            prompt,
            negativePrompt: '',
            n: 1,
            size: size || '',
            aspectRatio: '',
            quality: '',
            style: '',
            seed: seed !== undefined ? String(seed) : '',
            referenceImages: [],
            mask: '',
            responseFormat: responseFormat || '',
          },
        },
      },
    }, {
      timeoutMs: timeoutMs ?? 180_000,
      metadata: callOptions.metadata,
    });
    const jobId = normalizeText(submitResponse.job?.jobId);
    if (!jobId) {
      throw createNimiError({
        message: 'agent image generation did not return a scenario job id',
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'retry_image_generation',
        source: 'runtime',
      });
    }
    traceId = normalizeText(submitResponse.job?.traceId) || normalizeText(callOptions.metadata.traceId);
    diagnostics = {
      imageJobSubmitMs: Date.now() - submitStartedAt,
      imageLoadMs: null,
      imageGenerateMs: null,
      artifactHydrateMs: null,
      queueWaitMs: null,
      loadCacheHit: null,
      residentReused: null,
      residentRestarted: null,
      queueSerialized: null,
      profileOverrideStep: null,
      profileOverrideCfgScale: null,
      profileOverrideSampler: null,
      profileOverrideScheduler: null,
    };
    for (;;) {
      const jobResponse = await runtimeClient.ai.getScenarioJob({ jobId }, {
        timeoutMs: timeoutMs ?? 180_000,
        metadata: callOptions.metadata,
      });
      const status = Number(jobResponse.job?.status || 0);
      traceId = normalizeText(jobResponse.job?.traceId) || traceId;
      if (status === ScenarioJobStatus.COMPLETED) {
        break;
      }
      if (
        status === ScenarioJobStatus.FAILED
        || status === ScenarioJobStatus.CANCELED
        || status === ScenarioJobStatus.TIMEOUT
      ) {
        throw createNimiError({
          message: normalizeText(jobResponse.job?.reasonDetail)
            || normalizeText(jobResponse.job?.reasonCode)
            || 'agent image generation job failed',
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          actionHint: 'retry_image_generation',
          source: 'runtime',
        });
      }
      await sleepWithAbort(250, input.signal);
    }
    const artifactStartedAt = Date.now();
    const artifactsResponse = await runtimeClient.ai.getScenarioArtifacts({ jobId }, {
      timeoutMs: timeoutMs ?? 180_000,
      metadata: callOptions.metadata,
    });
    diagnostics.artifactHydrateMs = Date.now() - artifactStartedAt;
    traceId = normalizeText(artifactsResponse.traceId) || traceId;
    artifact = resolveAgentImageScenarioArtifact(artifactsResponse);
    const artifactDiagnostics = parseAgentImageArtifactProtoDiagnostics(
      (artifact as { metadata?: unknown } | null)?.metadata,
    );
    if (artifactDiagnostics) {
      diagnostics = {
        ...diagnostics,
        ...artifactDiagnostics,
        imageJobSubmitMs: diagnostics.imageJobSubmitMs,
        artifactHydrateMs: diagnostics.artifactHydrateMs,
      };
    }
  } else {
    const metadata = await (deps.buildRuntimeRequestMetadataImpl || buildRuntimeRequestMetadata)({
      source: resolved.source,
      connectorId: normalizeText(resolved.connectorId) || undefined,
      providerEndpoint: normalizeText(resolved.endpoint)
        || normalizeText(resolved.localProviderEndpoint)
        || normalizeText(resolved.localOpenAiEndpoint)
        || undefined,
    });
    const response = await runtimeClient.media.image.generate({
      model: modelId,
      prompt,
      route: resolved.source,
      connectorId: normalizeText(resolved.connectorId) || undefined,
      responseFormat,
      size,
      seed,
      timeoutMs,
      ...(extensions ? { extensions } : {}),
      metadata,
      signal: input.signal,
    });
    artifact = Array.isArray(response.artifacts)
      ? response.artifacts[0] as unknown as Record<string, unknown> | null
      : null;
    traceId = normalizeText(response.trace?.traceId) || normalizeText(metadata.traceId);
  }
  if (!artifact) {
    throw createNimiError({
      message: 'agent image generation returned no artifacts',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_image_generation',
      source: 'runtime',
    });
  }
  const mimeType = normalizeText((artifact as { mimeType?: unknown }).mimeType) || 'image/png';
  const uri = normalizeText((artifact as { uri?: unknown }).uri);
  const bytes = (artifact as { bytes?: Uint8Array | null }).bytes || null;
  const mediaUrl = uri || (bytes && bytes.length > 0 ? encodeBytesAsDataUrl(mimeType, bytes) : '');
  if (!mediaUrl) {
    throw createNimiError({
      message: 'agent image generation artifact has no uri or bytes',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_image_generation',
      source: 'runtime',
    });
  }
  return {
    mediaUrl,
    mimeType,
    artifactId: normalizeText((artifact as { artifactId?: unknown }).artifactId) || null,
    traceId,
    diagnostics,
  };
}
