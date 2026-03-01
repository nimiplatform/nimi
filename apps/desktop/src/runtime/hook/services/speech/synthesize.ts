import { emitInferenceAudit, parseReasonCode } from '../../../llm-adapter/execution/inference-audit';
import { createHookError } from '../../contracts/errors.js';
import { createHookRecord } from '../utils.js';
import {
  inferProviderTypeFromPrefix,
  normalizeLocalRuntimeProviderRef,
  normalizeSpeechAdapter,
} from './types.js';
import {
  buildRuntimeRequestMetadata,
  getRuntimeClient,
} from '../../../llm-adapter/execution/runtime-ai-bridge';
import type {
  ResolvedRoute,
  SpeechServiceInput,
  SpeechSynthesizeInput,
  SpeechSynthesizeResultPayload,
} from './types.js';
import { ReasonCode } from '@nimiplatform/sdk/types';

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
      connectorId: resolved.connectorId,
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
    connectorId: resolved.connectorId,
    model,
  };
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] || 0);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return '';
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

  const runtime = getRuntimeClient();
  let audioUri = '';
  let mimeType = 'audio/mpeg';
  let providerTraceId = '';
  try {
    const generated = await runtime.media.tts.synthesize({
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      model: route.model,
      text: input.text,
      voice: input.voiceId,
      audioFormat: input.format,
      sampleRateHz: input.sampleRateHz,
      speed: input.speakingRate,
      pitch: input.pitch,
      language: input.language,
      route: route.source,
      fallback: 'deny',
      timeoutMs: 60000,
      metadata: await buildRuntimeRequestMetadata({
        source: route.source,
        connectorId: route.connectorId,
        providerEndpoint: route.endpoint,
      }),
      providerOptions: providerParams,
    });
    const artifact = generated.artifacts[0];
    if (!artifact || !(artifact.bytes instanceof Uint8Array)) {
      throw new Error('speech provider returned empty artifact');
    }
    mimeType = String(artifact.mimeType || '').trim() || 'audio/mpeg';
    const base64 = toBase64(artifact.bytes);
    audioUri = base64 ? `data:${mimeType};base64,${base64}` : '';
    providerTraceId = String(generated.trace.traceId || '').trim();
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

  if (!String(audioUri || '').trim()) {
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: route.source,
      provider: route.provider,
      modality: 'tts',
      adapter: route.adapter,
      model: route.model,
      endpoint: route.endpoint,
      reasonCode: ReasonCode.PLAY_PROVIDER_UNAVAILABLE,
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
    audioUri,
    mimeType,
    durationMs: undefined,
    sampleRateHz: input.sampleRateHz,
    providerTraceId: providerTraceId || `speech:${Date.now().toString(36)}`,
    cacheKey: undefined,
  };
}
