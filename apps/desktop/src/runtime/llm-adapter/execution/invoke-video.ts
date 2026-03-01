import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  base64FromBytes,
  buildRuntimeRequestMetadata,
  getRuntimeClient,
  resolveRuntimeAiCall,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModVideoInput, InvokeModVideoOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { formatProviderError } from './utils';

export async function invokeModVideo(input: InvokeModVideoInput): Promise<InvokeModVideoOutput> {
  const runtimeCall = resolveRuntimeAiCall({
    ...input,
    modality: 'video',
    model: input.model || input.localProviderModel,
  });
  const source = runtimeCall.source;
  const policyGate = runtimeCall.plan.providerHints?.nexa?.policyGate;
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source,
    provider: runtimeCall.plan.providerRef,
    modality: 'video',
    adapter: runtimeCall.plan.adapter,
    model: runtimeCall.modelId,
    endpoint: runtimeCall.plan.endpoint,
    policyGate,
  });

  try {
    const runtime = getRuntimeClient();
    const generated = await runtime.media.video.generate({
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      model: runtimeCall.modelId,
      prompt: String(input.prompt || '').trim(),
      route: source,
      fallback: 'deny',
      durationSec: typeof input.durationSeconds === 'number' ? input.durationSeconds : undefined,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      metadata: await buildRuntimeRequestMetadata({
        source,
        connectorId: input.connectorId,
        providerEndpoint: runtimeCall.plan.endpoint || input.localOpenAiEndpoint,
      }),
      signal: input.abortSignal,
    });

    const artifacts = generated.artifacts.map((artifact) => ({
      mimeType: String(artifact.mimeType || '').trim(),
      bytes: artifact.bytes instanceof Uint8Array ? artifact.bytes : new Uint8Array(0),
    }));
    if (artifacts.length === 0) {
      throw new Error('LOCAL_AI_CAPABILITY_MISSING: video response missing data');
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
    const normalizedError = formatProviderError(error);
    const reasonCode = toLocalAiReasonCode(error) || parseReasonCode(normalizedError);
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source,
      provider: runtimeCall.plan.providerRef,
      modality: 'video',
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
