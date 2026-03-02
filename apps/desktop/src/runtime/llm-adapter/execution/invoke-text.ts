import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  buildRuntimeCallOptions,
  extractTextFromGenerateOutput,
  getRuntimeClient,
  resolveSourceAndModel,
  RUNTIME_MODAL_TEXT,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModLlmInput, InvokeModLlmOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { buildLocalId, formatProviderError } from './utils';
import { emitRuntimeLog } from '../../telemetry/logger';

export async function invokeModLlm(input: InvokeModLlmInput): Promise<InvokeModLlmOutput> {
  const resolved = resolveSourceAndModel(input);
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source: resolved.source,
    provider: resolved.provider,
    modality: 'chat',
    adapter: resolved.adapter,
    model: resolved.modelId,
    endpoint: resolved.endpoint,
  });

  try {
    const runtime = getRuntimeClient();
    const response = await runtime.ai.generate({
      appId: runtime.appId,
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      modelId: resolved.modelId,
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
      routePolicy: resolved.routePolicy,
      fallback: resolved.fallbackPolicy,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      connectorId: String(input.connectorId || ''),
    }, await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      source: resolved.source,
      connectorId: input.connectorId,
      providerEndpoint: resolved.endpoint,
    }));

    const text = extractTextFromGenerateOutput((response as { output?: unknown }).output);
    if (!text) {
      throw new Error('LOCAL_AI_CAPABILITY_MISSING: provider returned empty content');
    }

    if (String(input.modId || '').trim().startsWith('world.nimi.')) {
      emitRuntimeLog({
        level: 'info',
        area: 'mods-test-diag',
        message: '[MODS-TEST-DIAG] llm raw text output',
        details: {
          modId: input.modId,
          source: resolved.source,
          modelId: resolved.modelId,
          textLength: text.length,
          text,
        },
      });
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
      source: resolved.source,
      provider: resolved.provider,
      modality: 'chat',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      reasonCode,
      detail: normalizedError,
    });
    throw new Error(normalizedError);
  }
}
