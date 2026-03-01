import type { SpeechStreamOpenResult } from '../../../llm-adapter/speech/types.js';
import { emitInferenceAudit, parseReasonCode } from '../../../llm-adapter/execution/inference-audit';
import { createHookError } from '../../contracts/errors.js';
import { createHookRecord } from '../utils.js';
import { resolveSpeechRoute } from './resolve-route.js';
import type {
  ResolvedRoute,
  SpeechServiceInput,
  SpeechStreamControlInput,
  SpeechStreamCloseInput,
  SpeechStreamOpenInput,
} from './types.js';

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

  let route: ResolvedRoute | null = null;
  try {
    route = await resolveSpeechRoute(context, {
      modId: input.modId,
      providerId: input.providerId,
      routeSource: input.routeSource,
      connectorId: input.connectorId,
      model: input.model,
    });
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
      source: route.source,
      provider: route.provider,
      modality: 'tts',
      adapter: route.adapter,
      model: route.model,
      endpoint: route.endpoint,
      extra: { stream: true },
    });
    const result: SpeechStreamOpenResult = await context.speechEngine.openStream({
      model: route.model,
      routeSource: route.source,
      connectorId: route.connectorId,
      providerEndpoint: route.endpoint,
      providerType: route.providerType,
      endpoint: route.endpoint,
      open: {
        format: input.format,
        sampleRateHz: input.sampleRateHz,
      },
      request: {
        model: route.model,
        text: input.text,
        voice: input.voiceId,
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
    const detail = error instanceof Error ? error.message : String(error || '');
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: route?.source || 'token-api',
      provider: route?.provider || 'openai-compatible',
      modality: 'tts',
      adapter: route?.adapter || 'openai_compat_adapter',
      model: route?.model,
      endpoint: route?.endpoint,
      reasonCode: parseReasonCode(detail),
      detail,
      extra: { stream: true },
    });
    throw toSpeechStreamUnsupportedError(input.modId, error);
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
