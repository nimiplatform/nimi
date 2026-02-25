import type {
  SpeechSynthesizeRequest,
  SpeechSynthesizeResult,
} from '../../../llm-adapter/speech/types.js';
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
  SpeechSynthesizeInput,
  SpeechSynthesizeResultPayload,
} from './types.js';

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

export async function synthesizeModSpeech(
  context: SpeechServiceInput,
  input: SpeechSynthesizeInput,
): Promise<SpeechSynthesizeResultPayload> {
  const startedAt = Date.now();
  const permission = context.evaluatePermission({
    modId: input.modId,
    sourceType: input.sourceType,
    hookType: 'llm',
    target: 'llm.speech.synthesize',
    capabilityKey: 'llm.speech.synthesize',
    startedAt,
  });

  const route = await resolveSpeechRoute(context, {
    modId: input.modId,
    providerId: input.providerId,
    routeSource: input.routeSource,
    connectorId: input.connectorId,
    model: input.model,
  });
  const providerParams: Record<string, unknown> = {
    pitch: input.pitch,
    targetId: input.targetId,
    sessionId: input.sessionId,
  };
  if (String(input.language || '').trim()) {
    providerParams.language = String(input.language || '').trim();
  }
  if (String(input.stylePrompt || '').trim()) {
    providerParams.instruct = String(input.stylePrompt || '').trim();
  }
  const request: SpeechSynthesizeRequest = {
    model: route.model,
    text: input.text,
    voice: input.voiceId,
    format: input.format,
    speed: input.speakingRate,
    sampleRateHz: input.sampleRateHz,
    providerParams,
  };

  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source: route.source,
    provider: route.provider,
    modality: 'tts',
    adapter: route.adapter,
    model: route.model,
    endpoint: route.endpoint,
  });

  let result: SpeechSynthesizeResult;
  try {
    result = await context.speechEngine.synthesize({
      providerType: route.providerType,
      endpoint: route.endpoint,
      apiKey: route.apiKey,
      request,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: route.source,
      provider: route.provider,
      modality: 'tts',
      adapter: route.adapter,
      model: route.model,
      endpoint: route.endpoint,
      reasonCode: parseReasonCode(detail),
      detail,
    });
    throw error;
  }

  if (!String(result.audioUri || '').trim()) {
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: route.source,
      provider: route.provider,
      modality: 'tts',
      adapter: route.adapter,
      model: route.model,
      endpoint: route.endpoint,
      reasonCode: 'PLAY_PROVIDER_UNAVAILABLE',
      detail: 'speech provider returned empty audioUri',
    });
    throw createHookError(
      'HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE',
      'speech provider returned empty audioUri',
      { modId: input.modId },
    );
  }

  context.audit.append(createHookRecord({
    modId: input.modId,
    hookType: 'llm',
    target: 'llm.speech.synthesize',
    decision: 'ALLOW',
    reasonCodes: permission.reasonCodes,
    startedAt,
  }));

  return {
    audioUri: result.audioUri,
    mimeType: result.mimeType,
    durationMs: result.durationMs,
    sampleRateHz: result.sampleRateHz,
    providerTraceId: `speech:${Date.now().toString(36)}`,
    cacheKey: undefined,
  };
}
