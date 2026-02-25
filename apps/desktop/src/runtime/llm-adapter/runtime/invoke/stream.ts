import { classifyError } from '../../errors/classify';
import { isFallbackCandidate } from '../../errors/fallback-policy';
import type {
  CapabilityRequest,
  InvokeRequest,
  LlmStreamEvent,
} from '../../types';
import { sleep } from '../recovery-service';
import type { InvokeServiceContext, InvokeWithFallbackOptions } from './types';

export async function* invokeStreamWithFallback(
  context: InvokeServiceContext,
  capabilityRequest: CapabilityRequest,
  invokeRequest: InvokeRequest,
  options?: InvokeWithFallbackOptions,
): AsyncIterable<LlmStreamEvent> {
  const candidates = options?.candidates ?? context.routingService.route(capabilityRequest, options);
  let lastError: unknown;

  for (const decision of candidates) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const binding = context.routingService.resolveBinding(
      decision.modelProfile.id,
      decision.modelProfile.providerType,
    );
    if (!binding) {
      continue;
    }

    const authHeaders = await context.routingService.resolveAuthHeaders(decision, binding);
    const startedAt = Date.now();
    let firstTokenAt: number | undefined;

    try {
      for await (const event of binding.adapter.invokeStream(invokeRequest, {
        signal: options?.signal,
        headers: authHeaders,
      })) {
        if (!firstTokenAt && event.type === 'text_delta') {
          firstTokenAt = Date.now();
        }

        if (event.type === 'error') {
          throw event.raw ?? new Error('stream failed');
        }

        if (event.type === 'done') {
          context.rotationManager.markUsed(decision.credentialRef.refId);
          context.rotationManager.markRecovered(decision.credentialRef.refId);

          await context.usageService.recordUsage({
            caller: capabilityRequest.caller,
            modelId: decision.modelProfile.id,
            providerType: decision.modelProfile.providerType,
            inputTokens: event.usage?.input ?? context.usageService.estimatePromptTokens(invokeRequest),
            outputTokens: event.usage?.output ?? 0,
            cacheReadTokens: event.usage?.cacheRead,
            cacheWriteTokens: event.usage?.cacheWrite,
            totalTokens: event.usage?.total ?? context.usageService.estimatePromptTokens(invokeRequest),
            ttftMs: firstTokenAt ? firstTokenAt - startedAt : undefined,
            latencyMs: event.latencyMs ?? Date.now() - startedAt,
            success: true,
          });
        }

        yield event;
      }

      return;
    } catch (error) {
      const classified = classifyError(error, {
        provider: decision.modelProfile.providerType,
        model: decision.modelProfile.model,
      });
      lastError = classified;

      await context.usageService.recordUsage({
        caller: capabilityRequest.caller,
        modelId: decision.modelProfile.id,
        providerType: decision.modelProfile.providerType,
        inputTokens: context.usageService.estimatePromptTokens(invokeRequest),
        outputTokens: 0,
        totalTokens: context.usageService.estimatePromptTokens(invokeRequest),
        ttftMs: firstTokenAt ? firstTokenAt - startedAt : undefined,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCode: classified.code,
      });

      if (
        classified.code === 'RATE_LIMITED' ||
        classified.code === 'AUTH_FAILED' ||
        classified.code === 'PROVIDER_UNREACHABLE'
      ) {
        context.rotationManager.markError(decision.credentialRef.refId, classified.retryAfterMs);
      }

      if (classified.code === 'RATE_LIMITED' && classified.retryAfterMs && classified.retryAfterMs < 5000) {
        await sleep(classified.retryAfterMs, options?.signal);
        continue;
      }

      if (!isFallbackCandidate(classified)) {
        throw classified;
      }
    }
  }

  throw (
    lastError ?? {
      code: 'UNKNOWN',
      message: `No stream route succeeded for capability: ${capabilityRequest.capability}`,
    }
  );
}
