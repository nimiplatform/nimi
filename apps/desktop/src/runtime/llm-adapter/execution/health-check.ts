import { resolveProviderExecutionPlan } from './provider-plan';
import type { CheckLlmHealthInput, ProviderHealth } from './types';
import { formatProviderError } from './utils';
import { getRuntimeClient } from './runtime-ai-bridge';

export async function checkLocalLlmHealth(input: CheckLlmHealthInput): Promise<ProviderHealth> {
  const plan = resolveProviderExecutionPlan(input);
  if (plan.providerKind === 'FALLBACK') {
    return {
      providerKind: plan.providerKind,
      provider: plan.providerRef,
      endpoint: null,
      model: plan.model,
      status: 'unsupported',
      detail: 'fallback provider has no health endpoint',
      checkedAt: new Date().toISOString(),
    };
  }

  // For local runtime providers with an endpoint, use direct endpoint check
  if (plan.endpoint) {
    try {
      const localFetch = input.fetchImpl || fetch;
      const response = await localFetch(`${plan.endpoint}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return {
        providerKind: plan.providerKind,
        provider: plan.providerRef,
        endpoint: plan.endpoint,
        model: plan.model,
        status: response.ok ? 'healthy' : 'degraded',
        detail: response.ok ? '' : `HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        providerKind: plan.providerKind,
        provider: plan.providerRef,
        endpoint: plan.endpoint,
        model: plan.model,
        status: 'unreachable',
        detail: formatProviderError(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // For cloud/token-api providers, use runtime SDK connector test
  if (input.connectorId) {
    try {
      const runtime = getRuntimeClient();
      const result = await runtime.connector.testConnector({
        connectorId: input.connectorId,
        ownerId: 'desktop',
      });
      const ok = result?.ack?.ok !== false;
      return {
        providerKind: plan.providerKind,
        provider: plan.providerRef,
        endpoint: plan.endpoint,
        model: plan.model,
        status: ok ? 'healthy' : 'degraded',
        detail: ok ? '' : (result?.ack?.actionHint || 'connector test failed'),
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        providerKind: plan.providerKind,
        provider: plan.providerRef,
        endpoint: plan.endpoint,
        model: plan.model,
        status: 'unreachable',
        detail: formatProviderError(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  return {
    providerKind: plan.providerKind,
    provider: plan.providerRef,
    endpoint: plan.endpoint,
    model: plan.model,
    status: 'unsupported',
    detail: 'no connector available for health check',
    checkedAt: new Date().toISOString(),
  };
}
