import { emitInferenceAudit } from './inference-audit';
import {
  asRuntimeInvokeError,
  createRuntimeTraceId,
  extractRuntimeReasonCode,
  buildRuntimeStreamOptions,
  getRuntimeClient,
  resolveSourceAndModel,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModLlmInput, InvokeModLlmStreamEvent } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { createScopedAbortSignal } from './utils';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

const SCENARIO_TYPE_TEXT_GENERATE = 1;
const EXECUTION_MODE_STREAM = 2;

export async function* invokeModLlmStream(
  input: InvokeModLlmInput,
): AsyncIterable<InvokeModLlmStreamEvent> {
  const resolved = resolveSourceAndModel(input);
  let runtimeTraceId = createRuntimeTraceId('mod-stream');
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source: resolved.source,
    routeSource: resolved.source,
    provider: resolved.provider,
    modality: 'chat',
    adapter: resolved.adapter,
    model: resolved.modelId,
    endpoint: resolved.endpoint,
    traceId: runtimeTraceId,
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
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      detail: 'prompt required',
      extra: { stream: true, localReasonCode: ReasonCode.LOCAL_AI_CAPABILITY_MISSING },
    });
    throw createNimiError({
      message: 'prompt required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_prompt',
      source: 'runtime',
    });
  }

  const scopedAbort = createScopedAbortSignal(PRIVATE_PROVIDER_TIMEOUT_MS, input.abortSignal);
  let doneEmitted = false;
  try {
    const runtime = getRuntimeClient();
    const streamOptions = await buildRuntimeStreamOptions({
      modId: input.modId,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      signal: scopedAbort.signal,
      source: resolved.source,
      connectorId: input.connectorId,
      providerEndpoint: resolved.endpoint,
    });
    runtimeTraceId = streamOptions.metadata.traceId;
    const stream = await runtime.ai.streamScenario({
      head: {
        appId: runtime.appId,
        modelId: resolved.modelId,
        routePolicy: resolved.routePolicy,
        fallback: resolved.fallbackPolicy,
        timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
        connectorId: String(input.connectorId || ''),
      },
      scenarioType: SCENARIO_TYPE_TEXT_GENERATE,
      executionMode: EXECUTION_MODE_STREAM,
      spec: {
        spec: {
          oneofKind: 'textGenerate',
          textGenerate: {
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
          },
        },
      },
      extensions: [],
    }, streamOptions);

    for await (const event of stream as AsyncIterable<{
      traceId?: unknown;
      payload?: {
        oneofKind?: string;
        delta?: { text?: string };
        failed?: { reasonCode?: unknown; actionHint?: unknown };
      };
    }>) {
      runtimeTraceId = String(event?.traceId || '').trim() || runtimeTraceId;
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
        const runtimeReasonCode = extractRuntimeReasonCode({ reasonCode: payload.failed?.reasonCode })
          || ReasonCode.AI_STREAM_BROKEN;
        throw createNimiError({
          message: String(payload.failed?.actionHint || 'stream failed'),
          reasonCode: runtimeReasonCode,
          actionHint: 'retry_or_switch_route',
          traceId: runtimeTraceId,
          source: 'runtime',
        });
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
        routeSource: resolved.source,
        provider: resolved.provider,
        modality: 'chat',
        adapter: resolved.adapter,
        model: resolved.modelId,
        endpoint: resolved.endpoint,
        traceId: runtimeTraceId,
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        detail: `provider did not respond within ${PRIVATE_PROVIDER_TIMEOUT_MS / 1000}s`,
        extra: {
          stream: true,
          localReasonCode: ReasonCode.LOCAL_AI_PROVIDER_TIMEOUT,
        },
      });
      throw createNimiError({
        message: `provider did not respond within ${PRIVATE_PROVIDER_TIMEOUT_MS / 1000}s`,
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_or_switch_route',
        traceId: runtimeTraceId,
        source: 'runtime',
      });
    }
    if (scopedAbort.wasExternallyAborted()) {
      emitInferenceAudit({
        eventType: 'inference_failed',
        modId: input.modId,
        source: resolved.source,
        routeSource: resolved.source,
        provider: resolved.provider,
        modality: 'chat',
        adapter: resolved.adapter,
        model: resolved.modelId,
        endpoint: resolved.endpoint,
        traceId: runtimeTraceId,
        reasonCode: ReasonCode.OPERATION_ABORTED,
        detail: 'stream aborted by caller',
        extra: { stream: true },
      });
      throw createNimiError({
        message: 'stream aborted by caller',
        reasonCode: ReasonCode.OPERATION_ABORTED,
        actionHint: 'none',
        traceId: runtimeTraceId,
        source: 'runtime',
      });
    }
    const normalizedError = asRuntimeInvokeError(error, { traceId: runtimeTraceId });
    const runtimeReasonCode = extractRuntimeReasonCode(normalizedError)
      || normalizedError.reasonCode
      || ReasonCode.RUNTIME_CALL_FAILED;
    const localReasonCode = toLocalAiReasonCode(normalizedError) || undefined;
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved.source,
      routeSource: resolved.source,
      provider: resolved.provider,
      modality: 'chat',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      traceId: normalizedError.traceId || runtimeTraceId || undefined,
      reasonCode: runtimeReasonCode,
      detail: normalizedError.message,
      extra: {
        stream: true,
        ...(localReasonCode ? { localReasonCode } : {}),
      },
    });
    throw normalizedError;
  } finally {
    scopedAbort.dispose();
  }
}
