import { emitInferenceAudit } from './inference-audit';
import {
  asRuntimeInvokeError,
  createRuntimeTraceId,
  extractRuntimeReasonCode,
  buildRuntimeCallOptions,
  getRuntimeClient,
  resolveSourceAndModel,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModEmbeddingInput, InvokeModEmbeddingOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

const SCENARIO_TYPE_TEXT_EMBED = 2;
const EXECUTION_MODE_SYNC = 1;

function normalizeEmbeddingInputs(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : [input];
  return raw.map((item) => String(item || '').trim()).filter(Boolean);
}

export async function invokeModEmbedding(input: InvokeModEmbeddingInput): Promise<InvokeModEmbeddingOutput> {
  const resolved = resolveSourceAndModel({
    ...input,
    model: input.model,
  });
  let runtimeTraceId = createRuntimeTraceId('mod-embedding');
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source: resolved.source,
    routeSource: resolved.source,
    provider: resolved.provider,
    modality: 'embedding',
    adapter: resolved.adapter,
    model: resolved.modelId,
    endpoint: resolved.endpoint,
    traceId: runtimeTraceId,
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
      traceId: runtimeTraceId,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      detail,
      extra: { localReasonCode: ReasonCode.LOCAL_AI_CAPABILITY_MISSING },
    });
    throw createNimiError({
      message: detail,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_embedding_input',
      traceId: runtimeTraceId,
      source: 'runtime',
    });
  }

  try {
    const runtime = getRuntimeClient();
    const callOptions = await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      source: resolved.source,
      connectorId: input.connectorId,
      providerEndpoint: resolved.endpoint,
    });
    runtimeTraceId = String(callOptions.metadata.traceId || '').trim() || runtimeTraceId;
    const response = await runtime.ai.executeScenario({
      head: {
        appId: runtime.appId,
        modelId: resolved.modelId,
        routePolicy: resolved.routePolicy,
        fallback: resolved.fallbackPolicy,
        timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
        connectorId: String(input.connectorId || ''),
      },
      scenarioType: SCENARIO_TYPE_TEXT_EMBED,
      executionMode: EXECUTION_MODE_SYNC,
      spec: {
        spec: {
          oneofKind: 'textEmbed',
          textEmbed: {
            inputs,
          },
        },
      },
      extensions: [],
    }, callOptions);
    return {
      embeddings: extractEmbeddingsFromScenario((response as { output?: unknown }).output),
      traceId: runtimeTraceId || createRuntimeTraceId('mod-embedding'),
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
      routeSource: resolved.source,
      provider: resolved.provider,
      modality: 'embedding',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      traceId: normalizedError.traceId || runtimeTraceId || undefined,
      reasonCode: runtimeReasonCode,
      detail: normalizedError.message,
      extra: localReasonCode ? { localReasonCode } : undefined,
    });
    throw normalizedError;
  }
}

function extractEmbeddingsFromScenario(output: unknown): number[][] {
  const fields = (output && typeof output === 'object')
    ? (output as { fields?: Record<string, unknown> }).fields || {}
    : {};
  const vectors = fields.vectors as { kind?: { oneofKind?: string; listValue?: { values?: unknown[] } } } | undefined;
  const vectorValues = vectors?.kind?.oneofKind === 'listValue'
    ? vectors.kind.listValue?.values || []
    : [];
  return vectorValues.map((entry) => {
    const row = entry as { kind?: { oneofKind?: string; listValue?: { values?: unknown[] } } };
    const values = row?.kind?.oneofKind === 'listValue'
      ? row.kind.listValue?.values || []
      : [];
    return values.map((item) => {
      const value = item as { kind?: { oneofKind?: string; numberValue?: unknown } };
      if (value?.kind?.oneofKind !== 'numberValue') {
        return null;
      }
      const parsed = Number(value.kind.numberValue);
      return Number.isFinite(parsed) ? parsed : null;
    }).filter((item): item is number => item !== null);
  });
}
