import { classifyError } from '../errors/classify';
import { isAbortError } from '../errors/fallback-policy';
import type { LlmAdapterError } from '../errors/codes';
import type { CapabilityRequest, RoutingDecision } from '../types';
import { isFallbackErrorCode } from './scoring';

export type RoutingAttempt = {
  decision: RoutingDecision;
  success: boolean;
  error?: LlmAdapterError;
  at: string;
};

export type RoutingExecutionResult<T> = {
  result: T;
  decision: RoutingDecision;
  attempts: RoutingAttempt[];
};

type RouteWithFallbackOptions = {
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

async function defaultSleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);

    if (!signal) {
      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function routeWithFallback<T>(
  request: CapabilityRequest,
  candidates: RoutingDecision[],
  execute: (decision: RoutingDecision) => Promise<T>,
  options?: RouteWithFallbackOptions,
): Promise<RoutingExecutionResult<T>> {
  const attempts: RoutingAttempt[] = [];
  const sleep = options?.sleep ?? defaultSleep;
  let lastError: LlmAdapterError | undefined;

  for (const decision of candidates) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const result = await execute(decision);
      attempts.push({
        decision,
        success: true,
        at: new Date().toISOString(),
      });

      return {
        result,
        decision,
        attempts,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const classified = classifyError(error, {
        provider: decision.modelProfile.providerType,
        model: decision.modelProfile.model,
      });

      attempts.push({
        decision,
        success: false,
        error: classified,
        at: new Date().toISOString(),
      });

      lastError = classified;

      if (classified.code === 'RATE_LIMITED' && classified.retryAfterMs && classified.retryAfterMs < 5000) {
        await sleep(classified.retryAfterMs, options?.signal);

        try {
          const retriedResult = await execute(decision);
          attempts.push({
            decision,
            success: true,
            at: new Date().toISOString(),
          });

          return {
            result: retriedResult,
            decision,
            attempts,
          };
        } catch (retryError) {
          if (isAbortError(retryError)) {
            throw retryError;
          }

          const retryClassified = classifyError(retryError, {
            provider: decision.modelProfile.providerType,
            model: decision.modelProfile.model,
          });

          attempts.push({
            decision,
            success: false,
            error: retryClassified,
            at: new Date().toISOString(),
          });

          lastError = retryClassified;
        }
      }

      if (!isFallbackErrorCode(classified.code)) {
        throw classified;
      }
    }
  }

  throw (
    lastError ?? {
      code: 'UNKNOWN',
      message: `No route succeeded for capability: ${request.capability}`,
    }
  );
}
