import { useEffect, useRef, useState } from 'react';
import {
  sdkListModelCatalogProviders,
  sdkListCatalogProviderModels,
  sdkGetCatalogModelDetail,
  type RuntimeCatalogPricing,
} from './runtime-config-catalog-sdk-service.js';

export type PricingEntry = {
  provider: string;
  pricing: RuntimeCatalogPricing;
};

type PricingIndexState = {
  index: Map<string, PricingEntry>;
  loading: boolean;
};

async function buildModelToProviderMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const providers = await sdkListModelCatalogProviders();
  for (const provider of providers) {
    const response = await sdkListCatalogProviderModels(provider.provider);
    for (const model of response.models) {
      if (!map.has(model.modelId)) {
        map.set(model.modelId, model.provider);
      }
    }
  }
  return map;
}

async function fetchPricingForModels(
  modelIds: string[],
  modelToProvider: Map<string, string>,
): Promise<Map<string, PricingEntry>> {
  const result = new Map<string, PricingEntry>();
  const fetches = modelIds
    .filter((id) => modelToProvider.has(id))
    .map(async (modelId) => {
      const provider = modelToProvider.get(modelId)!;
      try {
        const detail = await sdkGetCatalogModelDetail(provider, modelId);
        result.set(modelId, { provider, pricing: detail.model.pricing });
      } catch {
        // Model detail fetch failed — leave as unknown
      }
    });
  await Promise.all(fetches);
  return result;
}

export function usePricingIndex(modelIds: string[]): PricingIndexState {
  const [state, setState] = useState<PricingIndexState>({ index: new Map(), loading: false });
  const modelToProviderRef = useRef<Map<string, string> | null>(null);
  const cachedRef = useRef<Map<string, PricingEntry>>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (modelIds.length === 0) return;

    const uncached = modelIds.filter((id) => !cachedRef.current.has(id) && !requestedRef.current.has(id));
    if (uncached.length === 0) return;

    for (const id of uncached) requestedRef.current.add(id);

    let canceled = false;
    setState((prev) => ({ ...prev, loading: true }));

    (async () => {
      if (!modelToProviderRef.current) {
        modelToProviderRef.current = await buildModelToProviderMap();
      }
      if (canceled) return;

      const fetched = await fetchPricingForModels(uncached, modelToProviderRef.current);
      if (canceled) return;

      for (const [id, entry] of fetched) {
        cachedRef.current.set(id, entry);
      }
      setState({ index: new Map(cachedRef.current), loading: false });
    })().catch(() => {
      if (!canceled) setState((prev) => ({ ...prev, loading: false }));
    });

    return () => { canceled = true; };
  }, [modelIds.join(',')]);

  return state;
}
