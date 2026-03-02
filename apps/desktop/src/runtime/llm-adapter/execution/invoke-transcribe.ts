import { emitInferenceAudit } from './inference-audit';
import {
  asRuntimeInvokeError,
  extractRuntimeReasonCode,
  buildRuntimeRequestMetadata,
  getRuntimeClient,
  resolveSourceAndModel,
  resolveTranscribeAudio,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModTranscribeInput, InvokeModTranscribeOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { ReasonCode } from '@nimiplatform/sdk/types';

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

  let runtimeTraceId = '';
  try {
    const audio = await resolveTranscribeAudio({
      audioUri: input.audioUri,
      audioBase64: input.audioBase64,
      mimeType: input.mimeType,
      fetchImpl: input.fetchImpl,
    });

    const runtime = getRuntimeClient();
    const metadata = await buildRuntimeRequestMetadata({
      source: resolved.source,
      connectorId: input.connectorId,
      providerEndpoint: resolved.endpoint,
    });
    runtimeTraceId = String(metadata.traceId || metadata['x-nimi-trace-id'] || '').trim();
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
      connectorId: String(input.connectorId || '').trim() || undefined,
      fallback: 'deny',
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      metadata,
      signal: input.abortSignal,
    });

    return {
      text: String((response as { text?: unknown }).text || '').trim(),
    };
  } catch (error) {
    const normalizedError = asRuntimeInvokeError(error, {
      traceId: runtimeTraceId,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
    });
    const runtimeReasonCode = extractRuntimeReasonCode(normalizedError)
      || normalizedError.reasonCode
      || ReasonCode.RUNTIME_CALL_FAILED;
    const localReasonCode = toLocalAiReasonCode(normalizedError) || undefined;
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved.source,
      provider: resolved.provider,
      modality: 'stt',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      reasonCode: runtimeReasonCode,
      detail: normalizedError.message,
      extra: localReasonCode ? { localReasonCode } : undefined,
    });
    throw normalizedError;
  }
}
