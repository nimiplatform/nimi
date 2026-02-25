import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  buildRuntimeCallOptions,
  getRuntimeClient,
  resolveRuntimeAiCall,
  resolveTranscribeAudio,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModTranscribeInput, InvokeModTranscribeOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { formatProviderError } from './utils';

export async function invokeModTranscribe(input: InvokeModTranscribeInput): Promise<InvokeModTranscribeOutput> {
  const runtimeCall = resolveRuntimeAiCall({
    ...input,
    modality: 'stt',
    model: input.model || input.localProviderModel,
  });
  const source = runtimeCall.source;
  const policyGate = runtimeCall.plan.providerHints?.nexa?.policyGate;
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source,
    provider: runtimeCall.plan.providerRef,
    modality: 'stt',
    adapter: runtimeCall.plan.adapter,
    model: runtimeCall.modelId,
    endpoint: runtimeCall.plan.endpoint,
    policyGate,
  });

  try {
    const audio = await resolveTranscribeAudio({
      audioUri: input.audioUri,
      audioBase64: input.audioBase64,
      mimeType: input.mimeType,
      fetchImpl: input.fetchImpl,
    });

    const runtime = getRuntimeClient();
    const response = await runtime.ai.transcribeAudio({
      appId: runtime.appId,
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      modelId: runtimeCall.modelId,
      audioBytes: audio.audioBytes,
      mimeType: audio.mimeType,
      routePolicy: runtimeCall.routePolicy,
      fallback: runtimeCall.fallbackPolicy,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
    }, buildRuntimeCallOptions(input.modId, PRIVATE_PROVIDER_TIMEOUT_MS));

    return {
      text: String((response as { text?: unknown }).text || '').trim(),
    };
  } catch (error) {
    const normalizedError = formatProviderError(error);
    const reasonCode = toLocalAiReasonCode(error) || parseReasonCode(normalizedError);
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source,
      provider: runtimeCall.plan.providerRef,
      modality: 'stt',
      adapter: runtimeCall.plan.adapter,
      model: runtimeCall.modelId,
      endpoint: runtimeCall.plan.endpoint,
      reasonCode,
      detail: normalizedError,
      policyGate,
    });
    throw new Error(normalizedError);
  }
}
