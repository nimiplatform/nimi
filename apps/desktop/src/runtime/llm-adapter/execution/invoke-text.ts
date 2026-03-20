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
  toLocalRuntimeReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModLlmInput, InvokeModLlmOutput } from './types';
import { TEXT_GENERATE_TIMEOUT_MS } from './types';
import { buildLocalId } from './utils';
import { emitRuntimeLog } from '../../telemetry/logger';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

const SCENARIO_TYPE_TEXT_GENERATE = 1;
const EXECUTION_MODE_SYNC = 1;
const MAX_PROMPT_CHARS = 24_000;
const MAX_SYSTEM_PROMPT_CHARS = 12_000;

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
  if (numeric === 1) return 'LOCAL';
  if (numeric === 2) return 'CLOUD';
  if (numeric === 0) return 'UNSPECIFIED';
  return `UNKNOWN_${Math.trunc(numeric)}`;
}

function hasDisallowedControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13) {
      continue;
    }
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

export function sanitizeScenarioTextInput(
  value: unknown,
  fieldName: 'prompt' | 'systemPrompt',
): string {
  const normalized = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  const maxLength = fieldName === 'prompt' ? MAX_PROMPT_CHARS : MAX_SYSTEM_PROMPT_CHARS;

  if (fieldName === 'prompt' && !normalized) {
    throw createNimiError({
      message: 'prompt must not be empty',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'fix_input',
      source: 'runtime',
    });
  }
  if (normalized.length > maxLength) {
    throw createNimiError({
      message: `${fieldName} exceeds maximum length`,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'reduce_input',
      source: 'runtime',
    });
  }
  if (hasDisallowedControlCharacters(normalized)) {
    throw createNimiError({
      message: `${fieldName} contains unsupported control characters`,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'fix_input',
      source: 'runtime',
    });
  }

  return normalized;
}

export async function invokeModLlm(input: InvokeModLlmInput): Promise<InvokeModLlmOutput> {
  const resolved = resolveSourceAndModel(input);
  let runtimeTraceId = '';
  const prompt = sanitizeScenarioTextInput(input.prompt, 'prompt');
  const systemPrompt = sanitizeScenarioTextInput(input.systemPrompt, 'systemPrompt');

  try {
    const runtime = getRuntimeClient();
    await ensureRuntimeLocalModelWarm({
      modId: input.modId,
      source: resolved.source,
      modelId: resolved.modelId,
      engine: resolved.provider,
      endpoint: resolved.endpoint,
      timeoutMs: TEXT_GENERATE_TIMEOUT_MS,
    });
    const callOptions = await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs: TEXT_GENERATE_TIMEOUT_MS,
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
        timeoutMs: TEXT_GENERATE_TIMEOUT_MS,
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
              content: prompt,
              name: '',
              parts: [],
            }],
            systemPrompt,
            tools: [],
            temperature: typeof input.temperature === 'number' ? input.temperature : 0,
            topP: 0,
            maxTokens: input.maxTokens ?? 0,
          },
        },
      },
      extensions: [],
    }, callOptions);

    const responseTraceId = String(response.traceId || '').trim() || runtimeTraceId;
    runtimeTraceId = responseTraceId;
    const responseModelResolved = String(response.modelResolved || '').trim();
    const responseFinishReasonRaw = Number(response.finishReason);
    const responseRouteDecisionRaw = Number(response.routeDecision);
    const usageInputTokensRaw = Number(response.usage?.inputTokens);
    const usageOutputTokensRaw = Number(response.usage?.outputTokens);
    const usageComputeMsRaw = Number(response.usage?.computeMs);
    const text = extractTextFromGenerateOutput(response.output);
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
    const localReasonCode = toLocalRuntimeReasonCode(normalizedError) || undefined;
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
