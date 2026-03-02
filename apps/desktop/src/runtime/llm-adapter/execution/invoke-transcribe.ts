import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  buildRuntimeRequestMetadata,
  getRuntimeClient,
  resolveSourceAndModel,
  resolveTranscribeAudio,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModTranscribeInput, InvokeModTranscribeOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { formatProviderError } from './utils';

export async function invokeModTranscribe(input: InvokeModTranscribeInput): Promise<InvokeModTranscribeOutput> {
  const resolved = resolveSourceAndModel({
    ...input,
    model: input.model || input.localProviderModel,
  });
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source: resolved.source,
    provider: resolved.provider,
    modality: 'stt',
    adapter: resolved.adapter,
    model: resolved.modelId,
    endpoint: resolved.endpoint,
  });

  try {
    const audio = await resolveTranscribeAudio({
      audioUri: input.audioUri,
      audioBase64: input.audioBase64,
      mimeType: input.mimeType,
      fetchImpl: input.fetchImpl,
    });

    const runtime = getRuntimeClient();
    const response = await runtime.media.stt.transcribe({
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      model: resolved.modelId,
      audio: {
        kind: 'bytes',
        bytes: audio.audioBytes,
      },
      mimeType: audio.mimeType,
      language: String(input.language || '').trim() || undefined,
      route: resolved.source,
      fallback: 'deny',
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      metadata: await buildRuntimeRequestMetadata({
        source: resolved.source,
        connectorId: input.connectorId,
        providerEndpoint: resolved.endpoint,
      }),
      signal: input.abortSignal,
    });

    return {
      text: String((response as { text?: unknown }).text || '').trim(),
    };
  } catch (error) {
    const normalizedError = formatProviderError(error);
    const reasonCode = toLocalAiReasonCode(error) || parseReasonCode(normalizedError);
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved.source,
      provider: resolved.provider,
      modality: 'stt',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      reasonCode,
      detail: normalizedError,
    });
    throw new Error(normalizedError);
  }
}
