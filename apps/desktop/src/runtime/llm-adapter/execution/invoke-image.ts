import { emitInferenceAudit } from './inference-audit';
import {
  asRuntimeInvokeError,
  extractRuntimeReasonCode,
  base64FromBytes,
  buildRuntimeRequestMetadata,
  createRuntimeTraceId,
  getRuntimeClient,
  resolveSourceAndModel,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModImageInput, InvokeModImageOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

export async function invokeModImage(input: InvokeModImageInput): Promise<InvokeModImageOutput> {
  const resolved = resolveSourceAndModel({
    ...input,
    model: input.model || input.localProviderModel,
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
    emitInferenceAudit({
      eventType: 'inference_invoked',
      modId: input.modId,
      source: resolved.source,
      routeSource: resolved.source,
      provider: resolved.provider,
      modality: 'image',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      traceId: runtimeTraceId,
    });
    const generated = await runtime.media.image.generate({
      model: resolved.modelId,
      prompt: String(input.prompt || '').trim(),
      route: resolved.source,
      connectorId: String(input.connectorId || '').trim() || undefined,
      fallback: 'deny',
      size: String(input.size || '').trim() || undefined,
      n: typeof input.n === 'number' ? input.n : undefined,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      metadata,
      signal: input.abortSignal,
    });

    const artifacts = generated.artifacts.map((artifact) => ({
      artifactId: String(artifact.artifactId || '').trim(),
      mimeType: String(artifact.mimeType || '').trim(),
      bytes: artifact.bytes instanceof Uint8Array ? artifact.bytes : new Uint8Array(0),
    }));
    if (artifacts.length === 0) {
      throw createNimiError({
        message: 'image response missing data',
        reasonCode: ReasonCode.AI_OUTPUT_INVALID,
        actionHint: 'retry_or_switch_model',
        traceId: runtimeTraceId,
        source: 'runtime',
      });
    }
    const traceId = runtimeTraceId || createRuntimeTraceId('mod-image');

    return {
      images: artifacts.map((artifact) => {
        const b64Json = base64FromBytes(artifact.bytes);
        const mimeType = String(artifact.mimeType || '').trim() || 'application/octet-stream';
        return {
          uri: `data:${mimeType};base64,${b64Json}`,
          b64Json,
          mimeType,
        };
      }),
      traceId,
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
      routeSource: resolved.source,
      provider: resolved.provider,
      modality: 'image',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      traceId: normalizedError.traceId || runtimeTraceId || undefined,
      reasonCode: runtimeReasonCode,
      detail: normalizedError.message,
      extra: localReasonCode ? { localReasonCode } : undefined,
    });
    throw normalizedError;
  }
}
