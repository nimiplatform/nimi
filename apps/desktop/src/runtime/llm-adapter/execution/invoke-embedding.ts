import { emitInferenceAudit } from './inference-audit';
import {
  asRuntimeInvokeError,
  extractRuntimeReasonCode,
  buildRuntimeCallOptions,
  extractEmbeddings,
  getRuntimeClient,
  resolveSourceAndModel,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModEmbeddingInput, InvokeModEmbeddingOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

function normalizeEmbeddingInputs(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : [input];
  return raw.map((item) => String(item || '').trim()).filter(Boolean);
}

export async function invokeModEmbedding(input: InvokeModEmbeddingInput): Promise<InvokeModEmbeddingOutput> {
  const resolved = resolveSourceAndModel({
    ...input,
    model: input.model,
  });
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source: resolved.source,
    provider: resolved.provider,
    modality: 'embedding',
    adapter: resolved.adapter,
    model: resolved.modelId,
    endpoint: resolved.endpoint,
  });

  const inputs = normalizeEmbeddingInputs(input.input);
  if (inputs.length === 0) {
    const detail = 'embedding input required';
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved.source,
      provider: resolved.provider,
      modality: 'embedding',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      detail,
      extra: { localReasonCode: ReasonCode.LOCAL_AI_CAPABILITY_MISSING },
    });
    throw createNimiError({
      message: detail,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_embedding_input',
      source: 'runtime',
    });
  }

  let runtimeTraceId = '';
  try {
    const runtime = getRuntimeClient();
    const callOptions = await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      source: resolved.source,
      connectorId: input.connectorId,
      providerEndpoint: resolved.endpoint,
    });
    runtimeTraceId = callOptions.metadata.traceId;
    const response = await runtime.ai.embed({
      appId: runtime.appId,
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      modelId: resolved.modelId,
      inputs,
      routePolicy: resolved.routePolicy,
      fallback: resolved.fallbackPolicy,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      connectorId: String(input.connectorId || ''),
    }, callOptions);
    return {
      embeddings: extractEmbeddings((response as { vectors?: unknown }).vectors),
    };
  } catch (error) {
    const normalizedError = asRuntimeInvokeError(error, { traceId: runtimeTraceId });
    const runtimeReasonCode = extractRuntimeReasonCode(normalizedError)
      || normalizedError.reasonCode
      || ReasonCode.RUNTIME_CALL_FAILED;
    const localReasonCode = toLocalAiReasonCode(normalizedError) || undefined;
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved.source,
      provider: resolved.provider,
      modality: 'embedding',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      reasonCode: runtimeReasonCode,
      detail: normalizedError.message,
      extra: localReasonCode ? { localReasonCode } : undefined,
    });
    throw normalizedError;
  }
}
