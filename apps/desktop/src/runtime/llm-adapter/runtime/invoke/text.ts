import { routeWithFallback, type RoutingExecutionResult } from '../../routing/fallback-runner';
import { classifyError } from '../../errors/classify';
import type {
  CapabilityRequest,
  InvokeRequest,
  InvokeResponse,
  RoutingDecision,
} from '../../types';
import { buildRecoveryAction, recoverMessagesForOverflow } from '../recovery-service';
import type { InvokeServiceContext, InvokeWithFallbackOptions } from './types';

export async function invokeText(
  context: InvokeServiceContext,
  decision: RoutingDecision,
  request: InvokeRequest,
  options?: { signal?: AbortSignal; caller?: string },
) {
  const binding = context.routingService.resolveBinding(
    decision.modelProfile.id,
    decision.modelProfile.providerType,
  );
  if (!binding) {
    throw new Error(`No provider adapter bound for model: ${decision.modelProfile.id}`);
  }

  const authHeaders = await context.routingService.resolveAuthHeaders(decision, binding);
  const startedAt = Date.now();

  try {
    const result = await binding.adapter.invoke(request, {
      signal: options?.signal,
      headers: authHeaders,
    });
    let recoveryAction: string | undefined;

    if (!String(result.content || '').trim()) {
      throw new Error('provider returned empty content');
    }

    context.rotationManager.markUsed(decision.credentialRef.refId);
    context.rotationManager.markRecovered(decision.credentialRef.refId);

    await context.usageService.recordUsage({
      caller: options?.caller ?? 'core',
      modelId: decision.modelProfile.id,
      providerType: decision.modelProfile.providerType,
      inputTokens: result.usage?.input ?? context.usageService.estimatePromptTokens(request),
      outputTokens: result.usage?.output ?? context.usageService.estimateCompletionTokens(result.content),
      cacheReadTokens: result.usage?.cacheRead,
      cacheWriteTokens: result.usage?.cacheWrite,
      totalTokens:
        result.usage?.total ??
        context.usageService.estimatePromptTokens(request) +
          context.usageService.estimateCompletionTokens(result.content),
      latencyMs: Date.now() - startedAt,
      success: true,
      recoveryAction,
    });

    return result;
  } catch (error) {
    const classified = classifyError(error, {
      provider: decision.modelProfile.providerType,
      model: decision.modelProfile.model,
    });

    let recoveryAction: string | undefined;
    let recoveredResult: InvokeResponse | undefined;

    if (classified.code === 'CONTEXT_OVERFLOW') {
      const compactedMessages = recoverMessagesForOverflow(request.messages);
      recoveryAction = buildRecoveryAction(request.messages.length, compactedMessages.length);

      if (recoveryAction) {
        try {
          recoveredResult = await binding.adapter.invoke(
            {
              ...request,
              messages: compactedMessages,
            },
            {
              signal: options?.signal,
              headers: authHeaders,
            },
          );
        } catch (retryError) {
          const retryClassified = classifyError(retryError, {
            provider: decision.modelProfile.providerType,
            model: decision.modelProfile.model,
          });
          await context.usageService.recordUsage({
            caller: options?.caller ?? 'core',
            modelId: decision.modelProfile.id,
            providerType: decision.modelProfile.providerType,
            inputTokens: context.usageService.estimatePromptTokens(request),
            outputTokens: 0,
            totalTokens: context.usageService.estimatePromptTokens(request),
            latencyMs: Date.now() - startedAt,
            success: false,
            errorCode: retryClassified.code,
            recoveryAction,
          });
          throw retryClassified;
        }
      }
    }

    if (recoveredResult) {
      context.rotationManager.markUsed(decision.credentialRef.refId);
      context.rotationManager.markRecovered(decision.credentialRef.refId);
      await context.usageService.recordUsage({
        caller: options?.caller ?? 'core',
        modelId: decision.modelProfile.id,
        providerType: decision.modelProfile.providerType,
        inputTokens:
          recoveredResult.usage?.input ?? context.usageService.estimatePromptTokens(request),
        outputTokens:
          recoveredResult.usage?.output ??
          context.usageService.estimateCompletionTokens(recoveredResult.content),
        cacheReadTokens: recoveredResult.usage?.cacheRead,
        cacheWriteTokens: recoveredResult.usage?.cacheWrite,
        totalTokens:
          recoveredResult.usage?.total ??
          context.usageService.estimatePromptTokens(request) +
            context.usageService.estimateCompletionTokens(recoveredResult.content),
        latencyMs: Date.now() - startedAt,
        success: true,
        recoveryAction,
      });
      return recoveredResult;
    }

    if (
      classified.code === 'RATE_LIMITED' ||
      classified.code === 'AUTH_FAILED' ||
      classified.code === 'PROVIDER_UNREACHABLE'
    ) {
      context.rotationManager.markError(decision.credentialRef.refId, classified.retryAfterMs);
    }

    await context.usageService.recordUsage({
      caller: options?.caller ?? 'core',
      modelId: decision.modelProfile.id,
      providerType: decision.modelProfile.providerType,
      inputTokens: context.usageService.estimatePromptTokens(request),
      outputTokens: 0,
      totalTokens: context.usageService.estimatePromptTokens(request),
      latencyMs: Date.now() - startedAt,
      success: false,
      errorCode: classified.code,
    });

    throw classified;
  }
}

export async function invokeTextWithFallback(
  context: InvokeServiceContext,
  capabilityRequest: CapabilityRequest,
  invokeRequest: InvokeRequest,
  options?: InvokeWithFallbackOptions,
): Promise<RoutingExecutionResult<InvokeResponse>> {
  if (options?.preflightHealth) {
    await context.routingService.preflightHealth();
  }

  const candidates = options?.candidates ?? context.routingService.route(capabilityRequest, options);
  return routeWithFallback(
    capabilityRequest,
    candidates,
    (decision) =>
      invokeText(context, decision, invokeRequest, {
        signal: options?.signal,
        caller: capabilityRequest.caller,
      }),
    {
      signal: options?.signal,
    },
  );
}
