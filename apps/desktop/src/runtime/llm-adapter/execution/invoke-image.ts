import { emitInferenceAudit, parseReasonCode } from './inference-audit';
import {
  base64FromBytes,
  buildRuntimeStreamOptions,
  collectRuntimeArtifacts,
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
    const stream = await runtime.ai.generateImage({
      appId: runtime.appId,
      subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
      modelId: runtimeCall.modelId,
      prompt: String(input.prompt || '').trim(),
      routePolicy: runtimeCall.routePolicy,
      fallback: runtimeCall.fallbackPolicy,
      timeoutMs: PRIVATE_PROVIDER_TIMEOUT_MS,
    }, buildRuntimeStreamOptions(input.modId, PRIVATE_PROVIDER_TIMEOUT_MS, input.abortSignal));

    const artifacts = await collectRuntimeArtifacts(stream, source);
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
