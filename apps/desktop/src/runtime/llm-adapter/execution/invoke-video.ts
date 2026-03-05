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
import type { InvokeModVideoInput, InvokeModVideoOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { runtimeModMediaCachePut } from '../tauri-bridge';

function extensionFromMimeType(mimeType: string): string | undefined {
  const normalized = String(mimeType || '').trim().toLowerCase();
  if (!normalized) return undefined;
  const [, subtype = ''] = normalized.split('/');
  const clean = subtype.split(';')[0]?.trim() || '';
  if (!clean || clean.length > 12) return undefined;
  return clean.replace(/[^a-z0-9]/g, '') || undefined;
}

export async function invokeModVideo(input: InvokeModVideoInput): Promise<InvokeModVideoOutput> {
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
      modality: 'video',
      adapter: resolved.adapter,
      model: resolved.modelId,
      endpoint: resolved.endpoint,
      traceId: runtimeTraceId,
    });
    const generated = await runtime.media.video.generate({
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
    const traceId = runtimeTraceId || createRuntimeTraceId('mod-video');

    const videos = await Promise.all(artifacts.map(async (artifact) => {
      const mimeType = String(artifact.mimeType || '').trim() || 'application/octet-stream';
      const b64 = base64FromBytes(artifact.bytes);
      const cached = await runtimeModMediaCachePut({
        mediaBase64: b64,
        mimeType,
        extensionHint: extensionFromMimeType(mimeType),
      });
      return {
        uri: cached?.uri || `data:${mimeType};base64,${b64}`,
        mimeType,
      };
    }));

    return {
      videos,
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
      modality: 'video',
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
