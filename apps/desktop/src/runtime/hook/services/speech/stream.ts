import type { SpeechStreamOpenResult } from '../../../llm-adapter/speech/types.js';
import { emitInferenceAudit } from '../../../llm-adapter/execution/inference-audit';
import { createHookError } from '../../contracts/errors.js';
import { createHookRecord } from '../utils.js';
import {
  asRuntimeInvokeError,
  extractRuntimeReasonCode,
  toLocalAiReasonCode,
} from '../../../llm-adapter/execution/runtime-ai-bridge';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  RouteResolverResult,
  SpeechServiceInput,
  SpeechStreamControlInput,
  SpeechStreamCloseInput,
  SpeechStreamOpenInput,
} from './types.js';
import { resolveSpeechVoiceId } from './voice-resolution.js';

type SpeechStreamOpenResultPayload = {
  streamId: string;
  eventTopic: string;
  format: 'mp3' | 'wav' | 'opus' | 'pcm';
  sampleRateHz: number;
  channels: number;
  providerTraceId?: string;
};

function toSpeechStreamUnsupportedError(modId: string, error: unknown) {
  return createHookError(
    'HOOK_LLM_SPEECH_STREAM_UNSUPPORTED',
    error instanceof Error ? error.message : String(error),
    { modId },
  );
}

export async function openSpeechStream(
  context: SpeechServiceInput,
  input: SpeechStreamOpenInput,
): Promise<SpeechStreamOpenResultPayload> {
  const startedAt = Date.now();
  const permission = context.evaluatePermission({
    modId: input.modId,
    sourceType: input.sourceType,
    hookType: 'llm',
    target: 'llm.speech.stream.open',
    capabilityKey: 'llm.speech.stream.open',
    startedAt,
  });

  let resolved: RouteResolverResult | null = null;
  try {
    resolved = await context.resolveRoute({
      modId: input.modId,
      providerId: input.providerId,
      routeSource: input.routeSource,
      connectorId: input.connectorId,
      model: input.model,
    });
    const source = String(resolved?.source || '').trim() as 'local-runtime' | 'token-api';
    const model = String(resolved?.model || '').trim();
    const connectorId = String(resolved?.connectorId || '').trim();
    const endpoint = String(resolved?.localProviderEndpoint || resolved?.localOpenAiEndpoint || '').trim();

    const providerParams: Record<string, unknown> = {
      targetId: input.targetId,
      sessionId: input.sessionId,
    };
    if (String(input.language || '').trim()) {
      providerParams.language = String(input.language || '').trim();
    }
    if (String(input.stylePrompt || '').trim()) {
      providerParams.instruct = String(input.stylePrompt || '').trim();
    }
    emitInferenceAudit({
      eventType: 'inference_invoked',
      modId: input.modId,
      source,
      provider: resolved?.provider || 'openai-compatible',
      modality: 'tts',
      adapter: resolved?.adapter || 'openai_compat_adapter',
      model,
      endpoint,
      extra: { stream: true },
    });
    const resolvedVoiceId = await resolveSpeechVoiceId({
      context,
      providerId: input.providerId || resolved?.provider,
      routeSource: source,
      connectorId,
      model,
      providerEndpoint: endpoint,
      requestedVoiceId: input.voiceId,
    });
    const result: SpeechStreamOpenResult = await context.speechEngine.openStream({
      model,
      routeSource: source,
      connectorId,
      providerEndpoint: endpoint,
      open: {
        format: input.format,
        sampleRateHz: input.sampleRateHz,
      },
      request: {
        model,
        text: input.text,
        voice: resolvedVoiceId,
        format: input.format,
        sampleRateHz: input.sampleRateHz,
        providerParams,
      },
    });

    context.ensureEventTopic(result.eventTopic);
    context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'llm',
      target: 'llm.speech.stream.open',
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));

    return {
      streamId: result.streamId,
      eventTopic: result.eventTopic,
      format: result.format,
      sampleRateHz: result.sampleRateHz,
      channels: result.channels,
      providerTraceId: result.providerTraceId,
    };
  } catch (error) {
    const normalizedError = asRuntimeInvokeError(error, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_or_check_runtime_status',
    });
    const runtimeReasonCode = extractRuntimeReasonCode(normalizedError)
      || normalizedError.reasonCode
      || ReasonCode.RUNTIME_CALL_FAILED;
    const localReasonCode = toLocalAiReasonCode(normalizedError) || undefined;
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved?.source || 'token-api',
      provider: resolved?.provider || 'openai-compatible',
      modality: 'tts',
      adapter: resolved?.adapter || 'openai_compat_adapter',
      model: resolved?.model,
      endpoint: String(resolved?.localProviderEndpoint || resolved?.localOpenAiEndpoint || '').trim(),
      reasonCode: runtimeReasonCode,
      detail: normalizedError.message,
      extra: {
        stream: true,
        ...(localReasonCode ? { localReasonCode } : {}),
      },
    });
    throw toSpeechStreamUnsupportedError(input.modId, normalizedError);
  }
}

export async function controlSpeechStream(
  context: SpeechServiceInput,
  input: SpeechStreamControlInput,
): Promise<{ ok: boolean }> {
  const startedAt = Date.now();
  const permission = context.evaluatePermission({
    modId: input.modId,
    sourceType: input.sourceType,
    hookType: 'llm',
    target: 'llm.speech.stream.control',
    capabilityKey: 'llm.speech.stream.control',
    startedAt,
  });
  const result = await context.speechEngine.controlStream(input.streamId, input.action);
  context.audit.append(createHookRecord({
    modId: input.modId,
    hookType: 'llm',
    target: 'llm.speech.stream.control',
    decision: 'ALLOW',
    reasonCodes: permission.reasonCodes,
    startedAt,
  }));
  return result;
}

export async function closeSpeechStream(
  context: SpeechServiceInput,
  input: SpeechStreamCloseInput,
): Promise<{ ok: boolean }> {
  const startedAt = Date.now();
  const permission = context.evaluatePermission({
    modId: input.modId,
    sourceType: input.sourceType,
    hookType: 'llm',
    target: 'llm.speech.stream.close',
    capabilityKey: 'llm.speech.stream.close',
    startedAt,
  });
  const result = await context.speechEngine.closeStream(input.streamId);
  context.audit.append(createHookRecord({
    modId: input.modId,
    hookType: 'llm',
    target: 'llm.speech.stream.close',
    decision: 'ALLOW',
    reasonCodes: permission.reasonCodes,
    startedAt,
  }));
  return result;
}
