import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createRuntimeConfigCatalogClient,
  type NimiRuntimeCatalogPricing,
  type RuntimeConfigCatalogClient,
} from './runtime-config-catalog-sdk-service.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export type PricingEntry = {
  provider: string;
  pricing: NimiRuntimeCatalogPricing;
};

type PricingIndexState = {
  index: Map<string, PricingEntry>;
  loading: boolean;
};

async function buildModelToProviderMap(
  catalog: RuntimeConfigCatalogClient,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const providers = await catalog.listProviders();
  for (const provider of providers) {
    const response = await catalog.listProviderModels(provider.provider);
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
  catalog: RuntimeConfigCatalogClient,
): Promise<Map<string, PricingEntry>> {
  const result = new Map<string, PricingEntry>();
  const fetches = modelIds
    .filter((id) => modelToProvider.has(id))
    .map(async (modelId) => {
      const provider = modelToProvider.get(modelId)!;
      try {
        const detail = await catalog.getModelDetail(provider, modelId);
        result.set(modelId, { provider, pricing: detail.model.pricing });
      } catch {
        // Model detail fetch failed — leave as unknown
      }
    });
  await Promise.all(fetches);
  return result;
}

export function usePricingIndex(modelIds: string[]): PricingIndexState {
  const sdk = useDesktopRendererSdk();
  const catalog = useMemo(
    () => createRuntimeConfigCatalogClient(() => sdk.connectorAdmin()),
    [sdk],
  );
  const [state, setState] = useState<PricingIndexState>({ index: new Map(), loading: false });
  const modelToProviderRef = useRef<Map<string, string> | null>(null);
  const cachedRef = useRef<Map<string, PricingEntry>>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());
  const inFlightCountRef = useRef(0);

  useEffect(() => {
    if (modelIds.length === 0) {
      if (inFlightCountRef.current === 0) {
        setState((prev) => (prev.loading ? { ...prev, loading: false } : prev));
      }
      return;
    }

    const uncached = modelIds.filter((id) => !cachedRef.current.has(id) && !requestedRef.current.has(id));
    if (uncached.length === 0) {
      if (inFlightCountRef.current === 0) {
        setState((prev) => (prev.loading ? { ...prev, loading: false } : prev));
      }
      return;
    }

    for (const id of uncached) requestedRef.current.add(id);

    let canceled = false;
    let settled = false;
    inFlightCountRef.current += 1;
    setState((prev) => ({ ...prev, loading: true }));

    const releaseInFlight = (rollbackUncached: boolean) => {
      if (settled) return;
      settled = true;
      if (rollbackUncached) {
        for (const id of uncached) {
          if (!cachedRef.current.has(id)) {
            requestedRef.current.delete(id);
          }
        }
      }
      inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
    };

    (async () => {
      if (!modelToProviderRef.current) {
        modelToProviderRef.current = await buildModelToProviderMap(catalog);
      }
      if (canceled) {
        releaseInFlight(true);
        return;
      }

      const fetched = await fetchPricingForModels(uncached, modelToProviderRef.current, catalog);
      if (canceled) {
        releaseInFlight(true);
        return;
      }

      for (const [id, entry] of fetched) {
        cachedRef.current.set(id, entry);
      }
      releaseInFlight(false);
      setState({ index: new Map(cachedRef.current), loading: inFlightCountRef.current > 0 });
    })().catch(() => {
      releaseInFlight(true);
      if (!canceled) {
        setState((prev) => ({ ...prev, loading: inFlightCountRef.current > 0 }));
      }
    });

    return () => {
      canceled = true;
      releaseInFlight(true);
    };
  }, [catalog, modelIds.join(',')]);

  return state;
}
