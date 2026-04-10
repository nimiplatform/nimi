import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type { NimiRoutePolicy } from '@nimiplatform/sdk/runtime';
import type { ResolvedRouteInfo } from './tester-types.js';
import { asString } from './tester-utils.js';
import {
  buildRuntimeRequestMetadata,
  createRuntimeTraceId,
  ensureRuntimeLocalModelWarm,
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge.js';

export { getRuntimeClient } from '@runtime/llm-adapter/execution/runtime-ai-bridge.js';

const TESTER_MOD_ID = 'core.tester';
const TESTER_DEFAULT_WARM_TIMEOUT_MS = 120_000;
const LOCAL_ASSET_LIST_PAGE_SIZE = 100;
const LOCAL_ASSET_LIST_MAX_PAGES = 20;

/**
 * Resolve the runtime-facing model ID (assetId) from a local binding.
 *
 * The model picker stores `localModelId` (ULID) as the binding `model` field,
 * but the Go runtime's scenario validation matches by `assetId` (model name).
 * This function looks up the local asset list to translate ULID → assetId.
 */
async function resolveLocalAssetModelId(binding: RuntimeRouteBinding): Promise<string | null> {
  const localModelId = asString(binding.goRuntimeLocalModelId || binding.localModelId);
  if (!localModelId) return null;

  const runtime = (await import('@runtime/llm-adapter/execution/runtime-ai-bridge.js')).getRuntimeClient();
  let pageToken = '';
  for (let page = 0; page < LOCAL_ASSET_LIST_MAX_PAGES; page++) {
    const response = await runtime.local.listLocalAssets({
      statusFilter: 0,
      kindFilter: 0,
      engineFilter: '',
      pageSize: LOCAL_ASSET_LIST_PAGE_SIZE,
      pageToken,
    });
    for (const asset of response.assets || []) {
      const record = asset as unknown as Record<string, unknown>;
      if (asString(record.localAssetId) === localModelId) {
        const assetId = asString(record.assetId);
        return assetId || null;
      }
    }
    pageToken = asString((response as unknown as Record<string, unknown>).nextPageToken);
    if (!pageToken) break;
  }
  return null;
}

const LOCAL_ENGINE_PREFIXES = ['llama/', 'media/', 'speech/', 'sidecar/', 'local/'];

function isLocalEnginePrefix(model: string): boolean {
  const lower = model.toLowerCase();
  return LOCAL_ENGINE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export type TesterCallParams = {
  model: string;
  route: NimiRoutePolicy;
  connectorId?: string;
  metadata: Record<string, string>;
};

export async function resolveCallParams(binding: RuntimeRouteBinding | undefined): Promise<TesterCallParams> {
  if (!binding) {
    return {
      model: '',
      route: 'local',
      metadata: await buildRuntimeRequestMetadata({ source: 'local' }),
    };
  }
  const source = asString(binding.source) || 'local';
  const connectorId = asString(binding.connectorId) || undefined;
  const model = asString(binding.modelId || binding.model);
  const provider = asString(binding.provider);
  const endpoint = asString(binding.endpoint);

  // When the binding's model field is a localAssetId (ULID) rather than an
  // assetId (model name), resolve the assetId from the runtime's local asset
  // list so the Go runtime can match the model correctly.
  let effectiveModel = model;
  if (source === 'local') {
    const assetId = await resolveLocalAssetModelId(binding);
    if (assetId) {
      effectiveModel = assetId;
    }
  }

  let resolvedModel = effectiveModel;
  let resolvedEndpoint = endpoint;
  let resolvedProvider = provider;

  if (source === 'local') {
    // For local models, build the engine-qualified model ID directly.
    // Do NOT use resolveSourceAndModel because it infers source from
    // endpoint; when endpoint is empty (common for picker bindings) it
    // defaults to 'cloud', producing a cloud/ prefixed model ID that
    // causes AI_ROUTE_FALLBACK_DENIED in the Go runtime.
    const engine = asString(binding.engine) || 'llama';
    if (isLocalEnginePrefix(effectiveModel)) {
      // Already has an engine prefix (llama/, media/, etc.) — use as-is.
      resolvedModel = effectiveModel;
    } else if (effectiveModel.includes('/')) {
      // Has a non-engine prefix (e.g., local-import/) — the Go runtime
      // accepts these directly without an engine prefix.
      resolvedModel = effectiveModel;
    } else {
      // Bare model name — add the engine prefix.
      resolvedModel = `${engine}/${effectiveModel}`;
    }
  } else {
    try {
      const resolved = resolveSourceAndModel({
        provider: provider || 'cloud',
        model: effectiveModel,
        connectorId,
        localProviderEndpoint: undefined,
      });
      resolvedModel = resolved.modelId;
      resolvedEndpoint = resolved.endpoint || endpoint;
      resolvedProvider = resolved.provider || provider;
    } catch {
      // keep effectiveModel as-is for cloud
    }
  }

  if (source === 'local') {
    // Only warm llama-engine models. Media/speech/sidecar models are loaded
    // on-demand by the runtime during scenario execution; the warm endpoint
    // rejects them with AI_MODALITY_NOT_SUPPORTED.
    const warmEngine = asString(binding.engine) || resolvedProvider;
    const normalizedEngine = warmEngine.toLowerCase();
    if (!normalizedEngine || normalizedEngine === 'llama' || normalizedEngine === 'local') {
      await ensureRuntimeLocalModelWarm({
        modId: TESTER_MOD_ID,
        source: 'local',
        modelId: resolvedModel,
        localModelId: asString(binding.localModelId) || undefined,
        goRuntimeLocalModelId: asString(binding.goRuntimeLocalModelId) || undefined,
        engine: warmEngine,
        endpoint: resolvedEndpoint,
        timeoutMs: TESTER_DEFAULT_WARM_TIMEOUT_MS,
      });
    }
  }

  const metadata = await buildRuntimeRequestMetadata({
    source: source as 'local' | 'cloud',
    connectorId,
    providerEndpoint: endpoint || undefined,
  });

  return {
    model: resolvedModel,
    route: source as NimiRoutePolicy,
    connectorId,
    metadata,
  };
}

export function bindingToRouteInfo(binding: RuntimeRouteBinding | null | undefined): ResolvedRouteInfo | null {
  if (!binding) return null;
  return {
    source: asString(binding.source) || undefined,
    provider: asString(binding.provider) || undefined,
    model: asString(binding.model) || undefined,
    modelId: asString(binding.modelId) || undefined,
    connectorId: asString(binding.connectorId) || undefined,
    endpoint: asString(binding.endpoint) || undefined,
    adapter: asString(binding.adapter) || undefined,
    engine: asString(binding.engine) || undefined,
    localModelId: asString(binding.localModelId) || undefined,
    goRuntimeLocalModelId: asString(binding.goRuntimeLocalModelId) || undefined,
    goRuntimeStatus: asString(binding.goRuntimeStatus) || undefined,
    localProviderEndpoint: asString(binding.endpoint) || undefined,
  };
}

export { createRuntimeTraceId };
