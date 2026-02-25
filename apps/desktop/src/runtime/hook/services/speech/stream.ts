import type { SpeechStreamOpenResult } from '../../../llm-adapter/speech/types.js';
import { emitInferenceAudit, parseReasonCode } from '../../../llm-adapter/execution/inference-audit';
import { createHookError } from '../../contracts/errors.js';
import { createHookRecord } from '../utils.js';
import {
  inferProviderTypeFromPrefix,
  normalizeLocalRuntimeProviderRef,
  normalizeSpeechAdapter,
} from './types.js';
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

async function resolveSpeechRoute(
  context: SpeechServiceInput,
  input: {
    modId: string;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    connectorId?: string;
    model?: string;
  },
): Promise<ResolvedRoute> {
  const resolved = await context.resolveRoute({
    modId: input.modId,
    providerId: input.providerId,
    routeSource: input.routeSource,
    connectorId: input.connectorId,
    model: input.model,
  });

  const source = String(resolved?.source || '').trim();
  if (source !== 'local-runtime' && source !== 'token-api') {
    throw createHookError(
      'HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE',
      `unsupported speech route source: ${source || 'unknown'}`,
      { modId: input.modId, providerId: input.providerId || null },
    );
  }

  if (source === 'local-runtime') {
    const model = String(resolved.model || '').trim();
    const adapter = normalizeSpeechAdapter(resolved.adapter);
    return {
      source,
      provider: normalizeLocalRuntimeProviderRef({
        provider: resolved.provider,
        engine: resolved.engine,
        adapter,
        model,
      }),
      adapter,
      providerType: 'OPENAI_COMPATIBLE',
      endpoint: String(resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || '').trim(),
      apiKey: String(resolved.localOpenAiApiKey || '').trim() || undefined,
      model,
    };
  }

  const model = String(resolved.model || '').trim();
  const providerStr = String(resolved.provider || '').trim();
  const prefix = providerStr.includes(':') ? String(providerStr.split(':')[0] || '') : 'openai-compatible';
  const providerType = inferProviderTypeFromPrefix(prefix);
  return {
    source,
    provider: providerStr || `openai-compatible:${model}`,
    adapter: normalizeSpeechAdapter(resolved.adapter),
    providerType,
    endpoint: String(resolved.localOpenAiEndpoint || '').trim(),
    apiKey: String(resolved.localOpenAiApiKey || '').trim(),
    model,
  };
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
      providerType: route.providerType,
      endpoint: route.endpoint,
      apiKey: route.apiKey,
      open: {
        providerType: route.providerType,
        endpoint: route.endpoint,
        apiKey: route.apiKey,
        model: route.model,
        text: input.text,
        voice: input.voiceId,
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
