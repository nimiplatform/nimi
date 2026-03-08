import { inferRouteSourceFromEndpoint } from './inference-audit';
import type { CheckLlmHealthInput, ProviderHealth } from './types';
import { formatProviderError } from './utils';
import { getRuntimeClient } from './runtime-ai-bridge';

export async function checkLocalLlmHealth(input: CheckLlmHealthInput): Promise<ProviderHealth> {
  const endpoint = String(input.localProviderEndpoint || input.localOpenAiEndpoint || '').trim();
  const source = inferRouteSourceFromEndpoint(endpoint);
  const model = String(input.localProviderModel || '').trim();
  const provider = String(input.provider || '').trim();

  if (endpoint && source === 'local') {
    try {
      const localFetch = input.fetchImpl || fetch;
      const response = await localFetch(`${endpoint}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return {
        provider,
        endpoint,
        model,
        status: response.ok ? 'healthy' : 'degraded',
        detail: response.ok ? '' : `HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider,
        endpoint,
        model,
        status: 'unreachable',
        detail: formatProviderError(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  if (input.connectorId) {
    try {
      const runtime = getRuntimeClient();
      const result = await runtime.connector.testConnector({
        connectorId: input.connectorId,
      });
      const ok = result?.ack?.ok !== false;
      return {
        provider,
        endpoint,
        model,
        status: ok ? 'healthy' : 'degraded',
        detail: ok ? '' : (result?.ack?.actionHint || 'connector test failed'),
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider,
        endpoint,
        model,
        status: 'unreachable',
        detail: formatProviderError(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  return {
    provider,
    endpoint: null,
    model,
    status: 'unsupported',
    detail: 'no endpoint or connector available for health check',
    checkedAt: new Date().toISOString(),
  };
}
