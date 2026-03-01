import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  buildRuntimeCallOptions,
  extractEmbeddings,
  getRuntimeClient,
  resolveSourceAndModel,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModEmbeddingInput, InvokeModEmbeddingOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { formatProviderError } from './utils';
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
      reasonCode: ReasonCode.LOCAL_AI_CAPABILITY_MISSING,
      detail,
    });
    throw new Error(`LOCAL_AI_CAPABILITY_MISSING: ${detail}`);
  }

  try {
    const runtime = getRuntimeClient();
    const response = await runtime.ai.embed({
      appId: runtime.appId,
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      modelId: resolved.modelId,
      inputs,
      routePolicy: resolved.routePolicy,
      fallback: resolved.fallbackPolicy,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      connectorId: String(input.connectorId || ''),
    }, await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      source: resolved.source,
      connectorId: input.connectorId,
      providerEndpoint: resolved.endpoint || input.localOpenAiEndpoint,
    }));
    return {
      embeddings: extractEmbeddings((response as { vectors?: unknown }).vectors),
    };
  } catch (error) {
    const normalizedError = formatProviderError(error);
    const reasonCode = toLocalAiReasonCode(error) || parseReasonCode(normalizedError);
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved.source,
      provider: resolved.provider,
      modality: 'embedding',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      reasonCode,
      detail: normalizedError,
    });
    throw new Error(normalizedError);
  }
}
