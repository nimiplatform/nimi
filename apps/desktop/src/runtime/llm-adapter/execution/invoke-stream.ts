import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  buildRuntimeStreamOptions,
  getRuntimeClient,
  resolveSourceAndModel,
  RUNTIME_MODAL_TEXT,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModLlmInput, InvokeModLlmStreamEvent } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { createScopedAbortSignal, formatProviderError } from './utils';
import { ReasonCode } from '@nimiplatform/sdk/types';

export async function* invokeModLlmStream(
  input: InvokeModLlmInput,
): AsyncIterable<InvokeModLlmStreamEvent> {
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
    extra: { stream: true },
  });

  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved.source,
      provider: resolved.provider,
      modality: 'chat',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      reasonCode: ReasonCode.LOCAL_AI_CAPABILITY_MISSING,
      detail: 'prompt required',
      extra: { stream: true },
    });
    throw new Error('LOCAL_AI_CAPABILITY_MISSING: prompt required');
  }

  const scopedAbort = createScopedAbortSignal(PRIVATE_PROVIDER_TIMEOUT_MS, input.abortSignal);
  let doneEmitted = false;
  try {
    const runtime = getRuntimeClient();
    const stream = await runtime.ai.streamGenerate({
      appId: runtime.appId,
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      modelId: resolved.modelId,
      modal: RUNTIME_MODAL_TEXT,
      input: [{
        role: 'user',
        content: prompt,
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
    }, await buildRuntimeStreamOptions({
      modId: input.modId,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      signal: scopedAbort.signal,
      source: resolved.source,
      connectorId: input.connectorId,
      providerEndpoint: resolved.endpoint || input.localOpenAiEndpoint,
    }));

    for await (const event of stream as AsyncIterable<{
      payload?: {
        oneofKind?: string;
        delta?: { text?: string };
        failed?: { reasonCode?: unknown; actionHint?: unknown };
      };
    }>) {
      const payload = event?.payload;
      if (payload?.oneofKind === 'delta') {
        const textDelta = String(payload.delta?.text || '');
        if (!textDelta) continue;
        yield { type: 'text_delta', textDelta };
        continue;
      }
      if (payload?.oneofKind === 'completed') {
        doneEmitted = true;
        yield { type: 'done' };
        return;
      }
      if (payload?.oneofKind === 'failed') {
        const reasonCode = toLocalAiReasonCode({ reasonCode: payload.failed?.reasonCode }) || 'LOCAL_AI_PROVIDER_INTERNAL_ERROR';
        throw new Error(`${reasonCode}: ${String(payload.failed?.actionHint || 'stream failed')}`);
      }
    }

    if (!doneEmitted) {
      yield { type: 'done' };
    }
  } catch (error) {
    if (scopedAbort.wasTimedOut()) {
      emitInferenceAudit({
        eventType: 'inference_failed',
        modId: input.modId,
        source: resolved.source,
        provider: resolved.provider,
        modality: 'chat',
        adapter: resolved.adapter,
        model: resolved.modelId,
        endpoint: resolved.endpoint,
        reasonCode: ReasonCode.LOCAL_AI_PROVIDER_TIMEOUT,
        detail: `provider did not respond within ${PRIVATE_PROVIDER_TIMEOUT_MS / 1000}s`,
        extra: { stream: true },
      });
      throw new Error(`LOCAL_AI_PROVIDER_TIMEOUT: provider did not respond within ${PRIVATE_PROVIDER_TIMEOUT_MS / 1000}s`);
    }
    if (scopedAbort.wasExternallyAborted()) {
      emitInferenceAudit({
        eventType: 'inference_failed',
        modId: input.modId,
        source: resolved.source,
        provider: resolved.provider,
        modality: 'chat',
        adapter: resolved.adapter,
        model: resolved.modelId,
        endpoint: resolved.endpoint,
        reasonCode: ReasonCode.LOCAL_AI_PROVIDER_TIMEOUT,
        detail: 'stream aborted by caller',
        extra: { stream: true },
      });
      throw new Error('LOCAL_AI_PROVIDER_TIMEOUT: stream aborted by caller');
    }
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
      extra: { stream: true },
    });
    throw new Error(normalizedError);
  } finally {
    scopedAbort.dispose();
  }
}
