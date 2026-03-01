import { resolveProviderExecutionPlan } from './provider-plan';
import type { CheckLlmHealthInput, ProviderHealth } from './types';
import { buildAdapter } from './provider-adapter';
import { formatProviderError } from './utils';
import {
  resolveProviderApiKeyFromCredentialRef,
} from './runtime-ai-bridge';

export async function checkLocalLlmHealth(input: CheckLlmHealthInput): Promise<ProviderHealth> {
  const plan = resolveProviderExecutionPlan(input);
  const localFetch = input.fetchImpl || fetch;
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
  try {
    const apiKey = await resolveProviderApiKeyFromCredentialRef(input.connectorId);
    const adapter = buildAdapter(plan, localFetch, apiKey);
    const health = await adapter.healthCheck(plan.model);
    return {
      providerKind: plan.providerKind,
      provider: plan.providerRef,
      endpoint: plan.endpoint,
      model: plan.model,
      status: health.status,
      detail: health.detail,
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
