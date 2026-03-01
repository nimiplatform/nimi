import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  buildRuntimeCallOptions,
  extractEmbeddings,
  getRuntimeClient,
  resolveRuntimeAiCall,
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
  const runtimeCall = resolveRuntimeAiCall({
    ...input,
    modality: 'embedding',
    model: input.model,
  });
  const source = runtimeCall.source;
  const policyGate = runtimeCall.plan.providerHints?.nexa?.policyGate;
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source,
    provider: runtimeCall.plan.providerRef,
    modality: 'embedding',
    adapter: runtimeCall.plan.adapter,
    model: runtimeCall.modelId,
    endpoint: runtimeCall.plan.endpoint,
    policyGate,
  });

  const inputs = normalizeEmbeddingInputs(input.input);
  if (inputs.length === 0) {
    const detail = 'embedding input required';
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source,
      provider: runtimeCall.plan.providerRef,
      modality: 'embedding',
      adapter: runtimeCall.plan.adapter,
      model: runtimeCall.modelId,
      endpoint: runtimeCall.plan.endpoint,
      reasonCode: ReasonCode.LOCAL_AI_CAPABILITY_MISSING,
      detail,
      policyGate,
    });
    throw new Error(`LOCAL_AI_CAPABILITY_MISSING: ${detail}`);
  }

  try {
    const runtime = getRuntimeClient();
    const response = await runtime.ai.embed({
      appId: runtime.appId,
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      modelId: runtimeCall.modelId,
      inputs,
      routePolicy: runtimeCall.routePolicy,
      fallback: runtimeCall.fallbackPolicy,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      connectorId: String(input.connectorId || ''),
    }, await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      source,
      connectorId: input.connectorId,
      providerEndpoint: runtimeCall.plan.endpoint || input.localOpenAiEndpoint,
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
      source,
      provider: runtimeCall.plan.providerRef,
      modality: 'embedding',
      adapter: runtimeCall.plan.adapter,
      model: runtimeCall.modelId,
      endpoint: runtimeCall.plan.endpoint,
      reasonCode,
      detail: normalizedError,
      policyGate,
    });
    throw new Error(normalizedError);
  }
}
