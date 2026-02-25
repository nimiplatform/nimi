import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  buildRuntimeCallOptions,
  extractTextFromGenerateOutput,
  getRuntimeClient,
  resolveRuntimeAiCall,
  RUNTIME_MODAL_TEXT,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModLlmInput, InvokeModLlmOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { buildLocalId, formatProviderError } from './utils';

export async function invokeModLlm(input: InvokeModLlmInput): Promise<InvokeModLlmOutput> {
  const runtimeCall = resolveRuntimeAiCall({
    ...input,
    modality: 'chat',
  });
  const source = runtimeCall.source;
  const policyGate = runtimeCall.plan.providerHints?.nexa?.policyGate;
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source,
    provider: runtimeCall.plan.providerRef,
    modality: 'chat',
    adapter: runtimeCall.plan.adapter,
    model: runtimeCall.modelId,
    endpoint: runtimeCall.plan.endpoint,
    policyGate,
  });

  try {
    const runtime = getRuntimeClient();
    const response = await runtime.ai.generate({
      appId: runtime.appId,
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      modelId: runtimeCall.modelId,
      modal: RUNTIME_MODAL_TEXT,
      input: [{
        role: 'user',
        content: String(input.prompt || '').trim(),
        name: '',
      }],
      systemPrompt: String(input.systemPrompt || ''),
      tools: [],
      temperature: typeof input.temperature === 'number' ? input.temperature : 0,
      topP: 0,
      maxTokens: input.maxTokens ?? 0,
      routePolicy: runtimeCall.routePolicy,
      fallback: runtimeCall.fallbackPolicy,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
    }, buildRuntimeCallOptions(input.modId, PRIVATE_PROVIDER_TIMEOUT_MS));

    const text = extractTextFromGenerateOutput((response as { output?: unknown }).output);
    if (!text) {
      throw new Error('LOCAL_AI_CAPABILITY_MISSING: provider returned empty content');
    }

    return {
      text,
      promptTraceId: String((response as { traceId?: unknown }).traceId || '').trim() || buildLocalId('prompt-trace'),
    };
  } catch (error) {
    const normalizedError = formatProviderError(error);
    const reasonCode = toLocalAiReasonCode(error) || parseReasonCode(normalizedError);
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source,
      provider: runtimeCall.plan.providerRef,
      modality: 'chat',
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
