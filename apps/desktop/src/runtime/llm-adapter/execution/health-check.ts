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

function normalizeCapability(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isAdmittedPlainSpeechCapability(value: unknown): boolean {
  const normalized = normalizeCapability(value);
  return normalized === 'audio.synthesize' || normalized === 'audio.transcribe';
}

function normalizeEndpointForPlane(endpoint: string): string {
  const normalized = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (normalized.endsWith('/v1')) return normalized;
  return normalized;
}

function canonicalLocalPlaneForEngine(
  engine: ReturnType<typeof normalizeLocalEngine>,
): string {
  if (engine === 'speech') return 'http://127.0.0.1:8330/v1';
  if (engine === 'media') return 'http://127.0.0.1:8321/v1';
  if (engine === 'llama') return 'http://127.0.0.1:1234/v1';
  return '';
}

function resolveHealthPlane(
  engine: ReturnType<typeof normalizeLocalEngine>,
  endpoint: string,
  connectorId: string | undefined,
): 'local-supervised' | 'attached-endpoint' | 'cloud-connector' | 'unknown' {
  if (String(connectorId || '').trim()) return 'cloud-connector';
  const normalizedEndpoint = normalizeEndpointForPlane(endpoint);
  if (!normalizedEndpoint) return 'unknown';
  if (inferRouteSourceFromEndpoint(normalizedEndpoint) !== 'local') return 'attached-endpoint';
  const canonical = canonicalLocalPlaneForEngine(engine);
  if (canonical && normalizeEndpointForPlane(canonical) === normalizedEndpoint) {
    return 'local-supervised';
  }
  return 'attached-endpoint';
}

function withPlaneDetail(
  plane: ReturnType<typeof resolveHealthPlane>,
  detail: string,
): string {
  const base = String(detail || '').trim();
  if (!plane || plane === 'unknown') return base;
  return base ? `plane=${plane}; ${base}` : `plane=${plane}`;
}

function isVoiceWorkflowCapability(value: unknown): boolean {
  const normalized = normalizeCapability(value);
  return normalized === 'voice_workflow.tts_v2v' || normalized === 'voice_workflow.tts_t2v';
}

function hasRuntimeAuthoritativeLocalModelRef(input: CheckLlmHealthInput): boolean {
  return Boolean(
    String(input.goRuntimeLocalModelId || '').trim()
    || String(input.goRuntimeStatus || '').trim()
    || String(input.localModelId || '').trim(),
  );
}

function usesRuntimeAuthoritativeLocalModelHealth(engine: ReturnType<typeof normalizeLocalEngine>): boolean {
  return engine === 'llama';
}

function usesRuntimeAuthoritativeLocalMediaHealth(
  engine: ReturnType<typeof normalizeLocalEngine>,
  endpoint: string,
  input: CheckLlmHealthInput,
): boolean {
  return engine === 'media' && (!endpoint || hasRuntimeAuthoritativeLocalModelRef(input));
}

async function checkRuntimeAuthoritativeLocalModelHealth(
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
  engine: ReturnType<typeof normalizeLocalEngine>,
  model: string,
  capability: string,
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
    ready?: boolean;
    detail?: string;
    models?: Array<{ id?: string; ready?: boolean; capabilities?: string[] }>;
  } | null;
  const readyRows = (modelsPayload?.models || []).filter(
    (item) => String(item?.id || '').trim() && item?.ready,
  );
  if (engine === 'speech' && !modelsPayload?.ready) {
    return { status: 'degraded', detail: String(modelsPayload?.detail || 'catalog ready=false') };
  }
  if (readyRows.length === 0) {
    return { status: 'degraded', detail: String(modelsPayload?.detail || 'models missing ready entries') };
  }

  if (engine === 'speech') {
    const normalizedModel = normalizeModelRoot(model);
    const requiredCapability = isAdmittedPlainSpeechCapability(capability) ? normalizeCapability(capability) : '';
    const matchedRow = normalizedModel
      ? readyRows.find((item) => normalizeModelRoot(String(item?.id || '')) === normalizedModel)
      : undefined;
    if (normalizedModel && !matchedRow) {
      return { status: 'degraded', detail: `speech catalog missing ready target model ${JSON.stringify(normalizedModel)}` };
    }
    if (requiredCapability) {
      const candidateRows = matchedRow ? [matchedRow] : readyRows;
      const hasCapability = candidateRows.some((item) => (item.capabilities || []).some((current) => normalizeCapability(current) === requiredCapability));
      if (!hasCapability) {
        return {
          status: 'degraded',
          detail: matchedRow
            ? `speech catalog missing required capability ${JSON.stringify(requiredCapability)} for target model`
            : `speech catalog missing required capability ${JSON.stringify(requiredCapability)}`,
        };
      }
    }
  }
  return { status: 'healthy', detail: '' };
}

export async function checkLocalLlmHealth(input: CheckLlmHealthInput): Promise<ProviderHealth> {
  const endpoint = String(input.localProviderEndpoint || input.localOpenAiEndpoint || '').trim();
  const source = inferRouteSourceFromEndpoint(endpoint);
  const model = String(input.localProviderModel || '').trim();
  const provider = String(input.provider || '').trim();
  const engine = normalizeLocalEngine(provider);
  const capability = normalizeCapability(input.capability);
  const plane = engine === 'speech'
    ? resolveHealthPlane(engine, endpoint, input.connectorId)
    : 'unknown';

  if (
    engine === 'speech'
    && isVoiceWorkflowCapability(capability)
    && (!input.connectorId && (!endpoint || source === 'local'))
  ) {
    return {
      provider,
      endpoint,
      model,
      status: 'unsupported',
      detail: withPlaneDetail(plane, 'local workflow health requires capability-scoped readiness and is not admitted on the canonical local speech path'),
      checkedAt: new Date().toISOString(),
    };
  }

  const runtimeAuthoritativeLocalHealth = !input.connectorId && (
    usesRuntimeAuthoritativeLocalModelHealth(engine)
    || usesRuntimeAuthoritativeLocalMediaHealth(engine, endpoint, input)
  );
  if ((endpoint && !input.connectorId) || runtimeAuthoritativeLocalHealth) {
    try {
      if (runtimeAuthoritativeLocalHealth) {
        return await checkRuntimeAuthoritativeLocalModelHealth(input, provider, endpoint, model);
      }
      const localFetch = input.fetchImpl || fetch;
      const response = usesCanonicalCatalogProbe(engine)
        ? await probeMediaEndpoint(localFetch, endpoint, engine, model, capability)
        : await probeOpenAiCompatibleEndpoint(localFetch, endpoint);
      return {
        provider,
        endpoint,
        model,
        status: response.status,
        detail: engine === 'speech' ? withPlaneDetail(plane, response.detail) : response.detail,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider,
        endpoint,
        model,
        status: 'unreachable',
        detail: engine === 'speech' ? withPlaneDetail(plane, formatProviderError(error)) : formatProviderError(error),
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
        detail: engine === 'speech'
          ? withPlaneDetail(plane, ok ? '' : (result?.ack?.actionHint || 'connector test failed'))
          : (ok ? '' : (result?.ack?.actionHint || 'connector test failed')),
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider,
        endpoint,
        model,
        status: 'unreachable',
        detail: engine === 'speech' ? withPlaneDetail(plane, formatProviderError(error)) : formatProviderError(error),
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
