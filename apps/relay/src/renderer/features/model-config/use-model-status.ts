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
          const data = modelResult.value as { models?: Array<Record<string, unknown>> };
          for (const m of data.models ?? []) {
            entries.push({
              id: String(m.id ?? m.modelId ?? ''),
              name: String(m.name ?? m.id ?? ''),
              source: 'unknown',
              ...m,
            });
          }
        }

        if (localResult.status === 'fulfilled') {
          const data = localResult.value as { models?: Array<Record<string, unknown>> };
          for (const m of data.models ?? []) {
            const id = String(m.id ?? m.modelId ?? '');
            const existing = entries.find((e) => e.id === id);
            if (existing) {
              existing.source = 'local';
              Object.assign(existing, m);
            } else {
              entries.push({
                id,
                name: String(m.name ?? m.id ?? ''),
                source: 'local',
                ...m,
              });
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
