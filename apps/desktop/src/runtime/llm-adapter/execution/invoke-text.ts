import { emitInferenceAudit } from './inference-audit';
import {
  asRuntimeInvokeError,
  extractRuntimeReasonCode,
  buildRuntimeCallOptions,
  ensureRuntimeLocalModelWarm,
  createRuntimeTraceId,
  extractTextFromGenerateOutput,
  getRuntimeClient,
  resolveSourceAndModel,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModLlmInput, InvokeModLlmOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { buildLocalId } from './utils';
import { emitRuntimeLog } from '../../telemetry/logger';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

const SCENARIO_TYPE_TEXT_GENERATE = 1;
const EXECUTION_MODE_SYNC = 1;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeFinishReason(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'UNKNOWN';
  if (numeric === 1) return 'STOP';
  if (numeric === 2) return 'LENGTH';
  if (numeric === 3) return 'TOOL_CALL';
  if (numeric === 4) return 'CONTENT_FILTER';
  if (numeric === 5) return 'ERROR';
  if (numeric === 0) return 'UNSPECIFIED';
  return `UNKNOWN_${Math.trunc(numeric)}`;
}

function normalizeRouteDecision(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'UNKNOWN';
  if (numeric === 1) return 'LOCAL_RUNTIME';
  if (numeric === 2) return 'TOKEN_API';
  if (numeric === 0) return 'UNSPECIFIED';
  return `UNKNOWN_${Math.trunc(numeric)}`;
}

export async function invokeModLlm(input: InvokeModLlmInput): Promise<InvokeModLlmOutput> {
  const resolved = resolveSourceAndModel(input);
  let runtimeTraceId = '';

  try {
    const runtime = getRuntimeClient();
    await ensureRuntimeLocalModelWarm({
      modId: input.modId,
      source: resolved.source,
      modelId: resolved.modelId,
      engine: resolved.provider,
      endpoint: resolved.endpoint,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
    });
    const callOptions = await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      source: resolved.source,
      connectorId: input.connectorId,
      providerEndpoint: resolved.endpoint,
    });
    runtimeTraceId = String(callOptions.metadata.traceId || '').trim();
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
    });
    const response = await runtime.ai.executeScenario({
      head: {
        appId: runtime.appId,
        modelId: resolved.modelId,
        routePolicy: resolved.routePolicy,
        fallback: resolved.fallbackPolicy,
        timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
        connectorId: String(input.connectorId || ''),
      },
      scenarioType: SCENARIO_TYPE_TEXT_GENERATE,
      executionMode: EXECUTION_MODE_SYNC,
      spec: {
        spec: {
          oneofKind: 'textGenerate',
          textGenerate: {
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
          },
        },
      },
      extensions: [],
    }, callOptions);

    const responseRecord = asRecord(response);
    const responseTraceId = String(responseRecord.traceId || '').trim() || runtimeTraceId;
    runtimeTraceId = responseTraceId;
    const responseModelResolved = String(responseRecord.modelResolved || '').trim();
    const responseFinishReasonRaw = Number(responseRecord.finishReason);
    const responseRouteDecisionRaw = Number(responseRecord.routeDecision);
    const usageRecord = asRecord(responseRecord.usage);
    const usageInputTokensRaw = Number(usageRecord.inputTokens);
    const usageOutputTokensRaw = Number(usageRecord.outputTokens);
    const usageComputeMsRaw = Number(usageRecord.computeMs);
    const text = extractTextFromGenerateOutput(responseRecord.output);
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
        message: '[MODS-TEST-DIAG] llm runtime generate meta',
        details: {
          modId: input.modId,
          traceId: responseTraceId || null,
          source: resolved.source,
          provider: resolved.provider,
          connectorId: String(input.connectorId || '').trim() || null,
          modelRequested: resolved.modelId,
          modelResolved: responseModelResolved || null,
          routeDecision: normalizeRouteDecision(responseRouteDecisionRaw),
          routeDecisionRaw: Number.isFinite(responseRouteDecisionRaw) ? responseRouteDecisionRaw : null,
          finishReason: normalizeFinishReason(responseFinishReasonRaw),
          finishReasonRaw: Number.isFinite(responseFinishReasonRaw) ? responseFinishReasonRaw : null,
          maxTokensRequested: Number.isFinite(Number(input.maxTokens))
            ? Number(input.maxTokens)
            : null,
          usageInputTokens: Number.isFinite(usageInputTokensRaw) ? usageInputTokensRaw : null,
          usageOutputTokens: Number.isFinite(usageOutputTokensRaw) ? usageOutputTokensRaw : null,
          usageComputeMs: Number.isFinite(usageComputeMsRaw) ? usageComputeMsRaw : null,
          textLength: text.length,
        },
      });
      emitRuntimeLog({
        level: 'info',
        area: 'mods-test-diag',
        message: '[MODS-TEST-DIAG] llm raw text output',
        details: {
          modId: input.modId,
          traceId: responseTraceId || null,
          source: resolved.source,
          modelId: resolved.modelId,
          textLength: text.length,
          text,
        },
      });
    }

    const traceId = responseTraceId || createRuntimeTraceId('mod-text');
    return {
      text,
      promptTraceId: traceId || buildLocalId('prompt-trace'),
      traceId,
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
      modality: 'chat',
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
