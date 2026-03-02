import { emitInferenceAudit } from './inference-audit';
import {
  asRuntimeInvokeError,
  extractRuntimeReasonCode,
  base64FromBytes,
  buildRuntimeRequestMetadata,
  getRuntimeClient,
  resolveSourceAndModel,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModVideoInput, InvokeModVideoOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

export async function invokeModVideo(input: InvokeModVideoInput): Promise<InvokeModVideoOutput> {
  const resolved = resolveSourceAndModel({
    ...input,
    model: input.model || input.localProviderModel,
  });
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source: resolved.source,
    provider: resolved.provider,
    modality: 'video',
    adapter: resolved.adapter,
    model: resolved.modelId,
    endpoint: resolved.endpoint,
  });

  let runtimeTraceId = '';
  try {
    const runtime = getRuntimeClient();
    const metadata = await buildRuntimeRequestMetadata({
      source: resolved.source,
      connectorId: input.connectorId,
      providerEndpoint: resolved.endpoint,
    });
    runtimeTraceId = String(metadata.traceId || metadata['x-nimi-trace-id'] || '').trim();
    const generated = await runtime.media.video.generate({
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      model: resolved.modelId,
      prompt: String(input.prompt || '').trim(),
      route: resolved.source,
      connectorId: String(input.connectorId || '').trim() || undefined,
      fallback: 'deny',
      durationSec: typeof input.durationSeconds === 'number' ? input.durationSeconds : undefined,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      metadata,
      signal: input.abortSignal,
    });

    const artifacts = generated.artifacts.map((artifact) => ({
      mimeType: String(artifact.mimeType || '').trim(),
      bytes: artifact.bytes instanceof Uint8Array ? artifact.bytes : new Uint8Array(0),
    }));
    if (artifacts.length === 0) {
      throw createNimiError({
        message: 'video response missing data',
        reasonCode: ReasonCode.AI_OUTPUT_INVALID,
        actionHint: 'retry_or_switch_model',
        traceId: runtimeTraceId,
        source: 'runtime',
      });
    }

    return {
      videos: artifacts.map((artifact) => {
        const mimeType = String(artifact.mimeType || '').trim() || 'application/octet-stream';
        const b64 = base64FromBytes(artifact.bytes);
        return {
          uri: `data:${mimeType};base64,${b64}`,
          mimeType,
        };
      }),
    };
  } catch (error) {
    const normalizedError = asRuntimeInvokeError(error, { traceId: runtimeTraceId });
    const runtimeReasonCode = extractRuntimeReasonCode(normalizedError)
      || normalizedError.reasonCode
      || ReasonCode.RUNTIME_CALL_FAILED;
    const localReasonCode = toLocalAiReasonCode(normalizedError) || undefined;
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source: resolved.source,
      provider: resolved.provider,
      modality: 'video',
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
