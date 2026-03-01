import { emitInferenceAudit, parseReasonCode } from '../../../llm-adapter/execution/inference-audit';
import { createHookError } from '../../contracts/errors.js';
import { createHookRecord } from '../utils.js';
import {
  buildRuntimeRequestMetadata,
  getRuntimeClient,
} from '../../../llm-adapter/execution/runtime-ai-bridge';
import { toBase64 } from '../../../util/encoding.js';
import type {
  SpeechServiceInput,
  SpeechSynthesizeInput,
  SpeechSynthesizeResultPayload,
} from './types.js';
import { ReasonCode } from '@nimiplatform/sdk/types';

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

  const resolved = await context.resolveRoute({
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
    source,
    provider: resolved?.provider || 'openai-compatible',
    modality: 'tts',
    adapter: resolved?.adapter || 'openai_compat_adapter',
    model,
    endpoint,
  });

  const runtime = getRuntimeClient();
  let audioUri = '';
  let mimeType = 'audio/mpeg';
  let providerTraceId = '';
  try {
    const generated = await runtime.media.tts.synthesize({
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      model,
      text: input.text,
      voice: input.voiceId,
      audioFormat: input.format,
      sampleRateHz: input.sampleRateHz,
      speed: input.speakingRate,
      pitch: input.pitch,
      language: input.language,
      route: source,
      fallback: 'deny',
      timeoutMs: 60000,
      connectorId,
      metadata: await buildRuntimeRequestMetadata({
        source,
        connectorId,
        providerEndpoint: endpoint,
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
      source,
      provider: resolved?.provider || 'openai-compatible',
      modality: 'tts',
      adapter: resolved?.adapter || 'openai_compat_adapter',
      model,
      endpoint,
      reasonCode: parseReasonCode(detail),
      detail,
    });
    throw error;
  }

  if (!String(audioUri || '').trim()) {
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source,
      provider: resolved?.provider || 'openai-compatible',
      modality: 'tts',
      adapter: resolved?.adapter || 'openai_compat_adapter',
      model,
      endpoint,
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
