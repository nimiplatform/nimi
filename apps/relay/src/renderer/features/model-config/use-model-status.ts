// RL-FEAT-008 — Model status aggregation hook
// Fetches model list + local model list and merges into unified view

import { useEffect, useState } from 'react';
import { getBridge } from '../../bridge/electron-bridge.js';

export interface ModelStatusEntry {
  id: string;
  name?: string;
  source: 'local' | 'cloud' | 'unknown';
  status?: string;
  [key: string]: unknown;
}

export interface ModelStatus {
  models: ModelStatusEntry[];
  loading: boolean;
  error: string | null;
}

function toModelStatusEntry(
  model: object,
  source: ModelStatusEntry['source'],
): ModelStatusEntry {
  const value = model as {
    id?: string;
    modelId?: string;
    name?: string;
    status?: string;
  };
  return {
    id: String(value.id ?? value.modelId ?? ''),
    name: String(value.name ?? value.id ?? value.modelId ?? ''),
    source,
    status: value.status,
    ...value,
  };
}

export function useModelStatus(): ModelStatus {
  const [models, setModels] = useState<ModelStatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      const bridge = getBridge();
      try {
        const [modelResult, localResult] = await Promise.allSettled([
          bridge.model.list(),
          bridge.local.listModels(),
        ]);

        if (cancelled) return;

        const entries: ModelStatusEntry[] = [];

        if (modelResult.status === 'fulfilled') {
          for (const model of modelResult.value.models ?? []) {
            entries.push(toModelStatusEntry(model, 'unknown'));
          }
        }

        if (localResult.status === 'fulfilled') {
          for (const model of localResult.value.assets ?? []) {
            const next = toModelStatusEntry(model, 'local');
            const id = next.id;
            const existing = entries.find((e) => e.id === id);
            if (existing) {
              existing.source = 'local';
              Object.assign(existing, next);
            } else {
              entries.push(next);
            }
          }
        }

        setModels(entries);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchModels();
    return () => { cancelled = true; };
  }, []);

  return { models, loading, error };
}
