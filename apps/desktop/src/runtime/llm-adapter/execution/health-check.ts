import { inferRouteSourceFromEndpoint } from './inference-audit';
import type { CheckLlmHealthInput, ProviderHealth } from './types';
import { formatProviderError } from './utils';
import { getRuntimeClient } from './runtime-ai-bridge';

function normalizeLocalEngine(provider: string): 'localai' | 'nexa' | 'nimi_media' | '' {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'nimi_media' || normalized === 'nimimedia') return 'nimi_media';
  if (normalized === 'nexa') return 'nexa';
  if (normalized === 'localai' || normalized === 'local') return 'localai';
  return '';
}

function normalizeOpenAiProbeUrl(endpoint: string): string {
  const normalized = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (normalized.endsWith('/v1/models')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/models`;
  if (normalized.endsWith('/models')) return normalized;
  return `${normalized}/v1/models`;
}

function normalizeNimiMediaRoot(endpoint: string): string {
  const normalized = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (normalized.endsWith('/v1/catalog')) return normalized.slice(0, -'/v1/catalog'.length);
  if (normalized.endsWith('/v1/models')) return normalized.slice(0, -'/v1/models'.length);
  if (normalized.endsWith('/v1')) return normalized.slice(0, -'/v1'.length);
  return normalized;
}

async function probeOpenAiCompatibleEndpoint(
  fetchImpl: typeof fetch,
  endpoint: string,
): Promise<{ status: ProviderHealth['status']; detail: string }> {
  const response = await fetchImpl(normalizeOpenAiProbeUrl(endpoint), {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });
  return {
    status: response.ok ? 'healthy' : 'degraded',
    detail: response.ok ? '' : `HTTP ${response.status}`,
  };
}

async function probeNimiMediaEndpoint(
  fetchImpl: typeof fetch,
  endpoint: string,
): Promise<{ status: ProviderHealth['status']; detail: string }> {
  const root = normalizeNimiMediaRoot(endpoint);
  const healthResponse = await fetchImpl(`${root}/healthz`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });
  if (!healthResponse.ok) {
    return { status: 'degraded', detail: `HTTP ${healthResponse.status}` };
  }
  const healthPayload = await healthResponse.json().catch(() => null) as { ready?: boolean; detail?: string } | null;
  if (!healthPayload?.ready) {
    return { status: 'degraded', detail: String(healthPayload?.detail || 'ready=false') };
  }

  const catalogResponse = await fetchImpl(`${root}/v1/catalog`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });
  if (!catalogResponse.ok) {
    return { status: 'degraded', detail: `HTTP ${catalogResponse.status}` };
  }
  const catalogPayload = await catalogResponse.json().catch(() => null) as {
    detail?: string;
    models?: Array<{ id?: string; ready?: boolean }>;
  } | null;
  const readyModels = (catalogPayload?.models || []).filter((item) => item?.ready && String(item.id || '').trim());
  if (readyModels.length === 0) {
    return { status: 'degraded', detail: String(catalogPayload?.detail || 'catalog missing ready models') };
  }
  return { status: 'healthy', detail: '' };
}

export async function checkLocalLlmHealth(input: CheckLlmHealthInput): Promise<ProviderHealth> {
  const endpoint = String(input.localProviderEndpoint || input.localOpenAiEndpoint || '').trim();
  const source = inferRouteSourceFromEndpoint(endpoint);
  const model = String(input.localProviderModel || '').trim();
  const provider = String(input.provider || '').trim();
  const engine = normalizeLocalEngine(provider);

  if (endpoint && source === 'local') {
    try {
      const localFetch = input.fetchImpl || fetch;
      const response = engine === 'nimi_media'
        ? await probeNimiMediaEndpoint(localFetch, endpoint)
        : await probeOpenAiCompatibleEndpoint(localFetch, endpoint);
      return {
        provider,
        endpoint,
        model,
        status: response.status,
        detail: response.detail,
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
