import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  base64FromBytes,
  buildRuntimeRequestMetadata,
  getRuntimeClient,
  resolveRuntimeAiCall,
  toLocalAiReasonCode,
} from './runtime-ai-bridge';
import type { InvokeModImageInput, InvokeModImageOutput } from './types';
import { PRIVATE_PROVIDER_TIMEOUT_MS } from './types';
import { formatProviderError } from './utils';

export async function invokeModImage(input: InvokeModImageInput): Promise<InvokeModImageOutput> {
  const runtimeCall = resolveRuntimeAiCall({
    ...input,
    modality: 'image',
    model: input.model || input.localProviderModel,
  });
  const source = runtimeCall.source;
  const policyGate = runtimeCall.plan.providerHints?.nexa?.policyGate;
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source,
    provider: runtimeCall.plan.providerRef,
    modality: 'image',
    adapter: runtimeCall.plan.adapter,
    model: runtimeCall.modelId,
    endpoint: runtimeCall.plan.endpoint,
    policyGate,
  });

  try {
    const runtime = getRuntimeClient();
    const generated = await runtime.media.image.generate({
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      model: runtimeCall.modelId,
      prompt: String(input.prompt || '').trim(),
      route: source,
      fallback: 'deny',
      size: String(input.size || '').trim() || undefined,
      n: typeof input.n === 'number' ? input.n : undefined,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
      metadata: await buildRuntimeRequestMetadata({
        source,
        connectorId: input.connectorId,
        providerEndpoint: runtimeCall.plan.endpoint || input.localOpenAiEndpoint,
      }),
      signal: input.abortSignal,
    });

    const artifacts = generated.artifacts.map((artifact) => ({
      artifactId: String(artifact.artifactId || '').trim(),
      mimeType: String(artifact.mimeType || '').trim(),
      bytes: artifact.bytes instanceof Uint8Array ? artifact.bytes : new Uint8Array(0),
    }));
    if (artifacts.length === 0) {
      throw new Error('LOCAL_AI_CAPABILITY_MISSING: image response missing data');
    }

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
    };
  } catch (error) {
    const normalizedError = formatProviderError(error);
    const reasonCode = toLocalAiReasonCode(error) || parseReasonCode(normalizedError);
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source,
      provider: runtimeCall.plan.providerRef,
      modality: 'image',
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
