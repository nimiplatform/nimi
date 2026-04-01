import { listLocalRuntimeAssets } from '@runtime/local-runtime';
import { inferRouteSourceFromEndpoint } from './inference-audit';
import type { CheckLlmHealthInput, ProviderHealth } from './types';
import { formatProviderError } from './utils';
import { getRuntimeClient } from './runtime-ai-bridge';

function normalizeLocalEngine(provider: string): 'llama' | 'media' | 'speech' | 'sidecar' | '' {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'media') return 'media';
  if (normalized === 'speech') return 'speech';
  if (normalized === 'sidecar') return 'sidecar';
  if (normalized === 'llama' || normalized === 'local') return 'llama';
  return '';
}

function usesCanonicalCatalogProbe(engine: ReturnType<typeof normalizeLocalEngine>): boolean {
  return engine === 'media' || engine === 'speech';
}

function normalizeOpenAiProbeUrl(endpoint: string): string {
  const normalized = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (normalized.endsWith('/v1/models')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/models`;
  if (normalized.endsWith('/models')) return normalized;
  return `${normalized}/v1/models`;
}

function normalizeMediaRoot(endpoint: string): string {
  const normalized = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (normalized.endsWith('/v1/models')) return normalized.slice(0, -'/v1/models'.length);
  if (normalized.endsWith('/v1')) return normalized.slice(0, -'/v1'.length);
  return normalized;
}

function normalizeModelRoot(model: string): string {
  const normalized = String(model || '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower.startsWith('llama/')) return normalized.slice('llama/'.length).trim();
  if (lower.startsWith('media/')) return normalized.slice('media/'.length).trim();
  if (lower.startsWith('speech/')) return normalized.slice('speech/'.length).trim();
  if (lower.startsWith('sidecar/')) return normalized.slice('sidecar/'.length).trim();
  if (lower.startsWith('local/')) return normalized.slice('local/'.length).trim();
  return normalized;
}

function normalizeLocalStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function usesRuntimeAuthoritativeLocalTextHealth(engine: ReturnType<typeof normalizeLocalEngine>): boolean {
  return engine === 'llama';
}

async function checkRuntimeAuthoritativeLocalTextHealth(
  input: CheckLlmHealthInput,
  provider: string,
  endpoint: string,
  model: string,
): Promise<ProviderHealth> {
  const hintedStatus = normalizeLocalStatus(input.goRuntimeStatus);
  if (hintedStatus === 'degraded' || hintedStatus === 'unavailable' || hintedStatus === 'removed') {
    return {
      provider,
      endpoint,
      model,
      status: 'unreachable',
      detail: `runtime local route unavailable (${hintedStatus})`,
      checkedAt: new Date().toISOString(),
    };
  }

  const listAssets = input.listRuntimeLocalModelsSnapshot
    || (async () => (await listLocalRuntimeAssets()) as unknown as Array<Record<string, unknown>>);
  const assets = await listAssets();
  const targetLocalModelId = String(input.goRuntimeLocalModelId || input.localModelId || '').trim();
  const targetModelRoot = normalizeModelRoot(model);
  const targetEngine = normalizeLocalEngine(provider);

  const candidates = assets
    .map((item: Record<string, unknown>) => ({
      localModelId: String(item.localAssetId || '').trim(),
      modelId: String(item.assetId || '').trim(),
      engine: normalizeLocalEngine(String(item.engine || '').trim()),
      status: normalizeLocalStatus(item.status),
      healthDetail: String(item.healthDetail || '').trim(),
    }))
    .filter((item: { localModelId: string; modelId: string; engine: string; status: string; healthDetail: string }) => item.status !== 'removed');

  const candidate = (targetLocalModelId
    ? candidates.find((item) => item.localModelId === targetLocalModelId)
    : undefined)
    || candidates.find((item) => normalizeModelRoot(item.modelId) === targetModelRoot && item.engine === targetEngine)
    || candidates.find((item) => normalizeModelRoot(item.modelId) === targetModelRoot)
    || null;

  if (!candidate) {
    return {
      provider,
      endpoint,
      model,
      status: 'unreachable',
      detail: 'runtime local model unavailable',
      checkedAt: new Date().toISOString(),
    };
  }

  if (candidate.status === 'unhealthy') {
    return {
      provider,
      endpoint,
      model,
      status: 'unreachable',
      detail: candidate.healthDetail || 'runtime local model unhealthy',
      checkedAt: new Date().toISOString(),
    };
  }

  if (candidate.status !== 'active' && candidate.status !== 'installed' && candidate.status !== '') {
    return {
      provider,
      endpoint,
      model,
      status: 'unreachable',
      detail: `runtime local model unavailable (${candidate.status})`,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    provider,
    endpoint,
    model,
    status: 'healthy',
    detail: '',
    checkedAt: new Date().toISOString(),
  };
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

async function probeMediaEndpoint(
  fetchImpl: typeof fetch,
  endpoint: string,
): Promise<{ status: ProviderHealth['status']; detail: string }> {
  const root = normalizeMediaRoot(endpoint);
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

  const modelsResponse = await fetchImpl(`${root}/v1/catalog`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });
  if (!modelsResponse.ok) {
    return { status: 'degraded', detail: `HTTP ${modelsResponse.status}` };
  }
  const modelsPayload = await modelsResponse.json().catch(() => null) as {
    detail?: string;
    models?: Array<{ id?: string; ready?: boolean }>;
  } | null;
  const listedModels = (modelsPayload?.models || []).filter((item) => String(item?.id || '').trim());
  if (listedModels.length === 0) {
    return { status: 'degraded', detail: String(modelsPayload?.detail || 'models missing ready entries') };
  }
  return { status: 'healthy', detail: '' };
}

export async function checkLocalLlmHealth(input: CheckLlmHealthInput): Promise<ProviderHealth> {
  const endpoint = String(input.localProviderEndpoint || input.localOpenAiEndpoint || '').trim();
  const source = inferRouteSourceFromEndpoint(endpoint);
  const model = String(input.localProviderModel || '').trim();
  const provider = String(input.provider || '').trim();
  const engine = normalizeLocalEngine(provider);

  if ((endpoint && source === 'local') || (usesRuntimeAuthoritativeLocalTextHealth(engine) && !input.connectorId)) {
    try {
      if (usesRuntimeAuthoritativeLocalTextHealth(engine)) {
        return await checkRuntimeAuthoritativeLocalTextHealth(input, provider, endpoint, model);
      }
      const localFetch = input.fetchImpl || fetch;
      const response = usesCanonicalCatalogProbe(engine)
        ? await probeMediaEndpoint(localFetch, endpoint)
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
