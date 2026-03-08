import { getPlatformClient } from '@runtime/platform-client';
import {
  ModelCatalogProviderSource,
  type ModelCatalogProviderEntry,
} from '@nimiplatform/sdk/runtime';

const CATALOG_CALL_OPTIONS = {
  timeoutMs: 8000,
  metadata: {
    callerKind: 'desktop-core' as const,
    callerId: 'runtime-config.catalog',
    surfaceId: 'runtime.config',
  },
};

export type ProviderCatalogSource = 'builtin' | 'custom' | 'remote' | 'unknown';

export type RuntimeModelCatalogProvider = {
  provider: string;
  version: number;
  catalogVersion: string;
  source: ProviderCatalogSource;
  modelCount: number;
  voiceCount: number;
  yaml: string;
};

function mapProviderSource(source: ModelCatalogProviderSource): ProviderCatalogSource {
  if (source === ModelCatalogProviderSource.BUILTIN) return 'builtin';
  if (source === ModelCatalogProviderSource.CUSTOM) return 'custom';
  if (source === ModelCatalogProviderSource.REMOTE) return 'remote';
  return 'unknown';
}

function normalizeProviderEntry(entry: ModelCatalogProviderEntry): RuntimeModelCatalogProvider {
  return {
    provider: String(entry.provider || '').trim(),
    version: Number.isFinite(entry.version) ? Number(entry.version) : 0,
    catalogVersion: String(entry.catalogVersion || '').trim(),
    source: mapProviderSource(entry.source),
    modelCount: Number.isFinite(entry.modelCount) ? Number(entry.modelCount) : 0,
    voiceCount: Number.isFinite(entry.voiceCount) ? Number(entry.voiceCount) : 0,
    yaml: String(entry.yaml || '').trim(),
  };
}

export async function sdkListModelCatalogProviders(): Promise<RuntimeModelCatalogProvider[]> {
  const runtime = getPlatformClient().runtime;
  const response = await runtime.connector.listModelCatalogProviders({}, CATALOG_CALL_OPTIONS);
  const providers = (response.providers || []).map(normalizeProviderEntry);
  providers.sort((a, b) => a.provider.localeCompare(b.provider));
  return providers;
}

export async function sdkUpsertModelCatalogProvider(provider: string, yaml: string): Promise<RuntimeModelCatalogProvider> {
  const runtime = getPlatformClient().runtime;
  const response = await runtime.connector.upsertModelCatalogProvider(
    {
      provider: String(provider || '').trim(),
      yaml: String(yaml || '').trim(),
    },
    CATALOG_CALL_OPTIONS,
  );
  return normalizeProviderEntry(response.provider || {
    provider: String(provider || '').trim(),
    version: 0,
    catalogVersion: '',
    source: ModelCatalogProviderSource.UNSPECIFIED,
    modelCount: 0,
    voiceCount: 0,
    yaml: String(yaml || '').trim(),
  });
}

export async function sdkDeleteModelCatalogProvider(provider: string): Promise<void> {
  const runtime = getPlatformClient().runtime;
  await runtime.connector.deleteModelCatalogProvider(
    { provider: String(provider || '').trim() },
    CATALOG_CALL_OPTIONS,
  );
}
