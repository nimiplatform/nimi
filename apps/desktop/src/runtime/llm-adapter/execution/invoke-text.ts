import { emitInferenceAudit } from './inference-audit';
import {
  asRuntimeInvokeError,
  extractRuntimeReasonCode,
  buildRuntimeCallOptions,
  extractTextFromGenerateOutput,
  getRuntimeClient,
  resolveSourceAndModel,
  RUNTIME_MODAL_TEXT,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModLlmInput, InvokeModLlmOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { buildLocalId } from './utils';
import { emitRuntimeLog } from '../../telemetry/logger';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

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

    const responseTraceId = String((response as { traceId?: unknown }).traceId || '').trim();
    const text = extractTextFromGenerateOutput((response as { output?: unknown }).output);
    if (!text) {
      throw createNimiError({
        message: 'provider returned empty content',
        reasonCode: ReasonCode.AI_OUTPUT_INVALID,
        actionHint: 'retry_or_switch_model',
        traceId: responseTraceId,
        source: 'runtime',
      });
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
      promptTraceId: responseTraceId || buildLocalId('prompt-trace'),
    };
  } catch (error) {
    const normalizedError = asRuntimeInvokeError(error);
    const runtimeReasonCode = extractRuntimeReasonCode(normalizedError)
      || normalizedError.reasonCode
      || ReasonCode.RUNTIME_CALL_FAILED;
    const localReasonCode = toLocalAiReasonCode(normalizedError) || undefined;
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved.source,
      provider: resolved.provider,
      modality: 'chat',
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
