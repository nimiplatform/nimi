import { createProviderAdapter } from '../providers/factory';
import type { FetchImpl, ProviderPlan } from './types';
import { resolveAdapterType } from './provider-plan';

export function buildAdapter(plan: ProviderPlan, fetchImpl: FetchImpl, apiKey?: string) {
  const headers: Record<string, string> = {};
  if (apiKey && plan.providerKind !== 'FALLBACK') {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return createProviderAdapter(resolveAdapterType(plan), {
    name: plan.providerRef || plan.providerKind.toLowerCase(),
    endpoint: plan.endpoint ?? 'fallback://local',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    fetch: fetchImpl,
  });
}
