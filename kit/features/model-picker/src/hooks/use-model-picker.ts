import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ModelCatalogAdapter, ModelPickerGroup } from '../types.js';

export type UseModelPickerOptions<TModel> = {
  adapter: ModelCatalogAdapter<TModel>;
  selectedId?: string;
  initialSelectedId?: string;
  onSelectModel?: (id: string, model: TModel | null) => void;
};

export type UseModelPickerResult<TModel> = {
  adapter: ModelCatalogAdapter<TModel>;
  models: readonly TModel[];
  filteredModels: readonly TModel[];
  groupedModels: readonly ModelPickerGroup<TModel>[];
  selectedId: string;
  selectedModel: TModel | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  capabilityFilter: string;
  sourceFilter: string;
  capabilityOptions: readonly string[];
  sourceOptions: readonly string[];
  setSearchQuery: (value: string) => void;
  setCapabilityFilter: (value: string) => void;
  setSourceFilter: (value: string) => void;
  selectModel: (id: string) => void;
  refresh: () => Promise<void>;
};

function asLowerString(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function useModelPicker<TModel>({
  adapter,
  selectedId,
  initialSelectedId = '',
  onSelectModel,
}: UseModelPickerOptions<TModel>): UseModelPickerResult<TModel> {
  const [models, setModels] = useState<readonly TModel[]>([]);
  const [internalSelectedId, setInternalSelectedId] = useState(initialSelectedId);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [capabilityFilter, setCapabilityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const deferredQuery = useDeferredValue(searchQuery);

  const currentSelectedId = selectedId ?? internalSelectedId;

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextModels = await adapter.listModels();
      setModels(nextModels);
    } catch (nextError) {
      setModels([]);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const capabilityOptions = useMemo(() => {
    const values = new Set<string>();
    for (const model of models) {
      for (const capability of adapter.getCapabilities?.(model) || []) {
        const trimmed = capability.trim();
        if (trimmed) {
          values.add(trimmed);
        }
      }
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [adapter, models]);

  const sourceOptions = useMemo(() => {
    const values = new Set<string>();
    for (const model of models) {
      const source = adapter.getSource?.(model)?.trim();
      if (source) {
        values.add(source);
      }
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [adapter, models]);

  const filteredModels = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    return models.filter((model) => {
      const capabilities = adapter.getCapabilities?.(model) || [];
      const source = adapter.getSource?.(model) || '';
      if (capabilityFilter !== 'all' && !capabilities.some((item) => item === capabilityFilter)) {
        return false;
      }
      if (sourceFilter !== 'all' && source !== sourceFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        adapter.getId(model),
        adapter.getTitle(model),
        adapter.getDescription?.(model),
        adapter.getSearchText?.(model),
        source,
        ...capabilities,
      ].map(asLowerString).join(' ');
      return haystack.includes(normalizedQuery);
    });
  }, [adapter, capabilityFilter, deferredQuery, models, sourceFilter]);

  const selectedModel = useMemo(
    () => models.find((model) => adapter.getId(model) === currentSelectedId) || null,
    [adapter, currentSelectedId, models],
  );

  const groupedModels = useMemo(() => {
    if (!adapter.getGroupKey) {
      return [{
        key: 'all',
        label: 'All Models',
        models: filteredModels,
      }];
    }

    const groups = new Map<string, TModel[]>();
    for (const model of filteredModels) {
      const key = adapter.getGroupKey(model)?.trim() || 'other';
      const current = groups.get(key);
      if (current) {
        current.push(model);
      } else {
        groups.set(key, [model]);
      }
    }

    return Array.from(groups.entries()).map(([key, entries]) => ({
      key,
      label: adapter.getGroupLabel?.(key, entries) || key,
      models: entries,
    }));
  }, [adapter, filteredModels]);

  useEffect(() => {
    const firstModel = models[0];
    if (!firstModel) {
      return;
    }
    const nextSelectedId = currentSelectedId && models.some((model) => adapter.getId(model) === currentSelectedId)
      ? currentSelectedId
      : adapter.getId(firstModel);
    if (selectedId === undefined) {
      setInternalSelectedId(nextSelectedId);
    }
    if (nextSelectedId !== currentSelectedId) {
      const model = models.find((item) => adapter.getId(item) === nextSelectedId) || null;
      onSelectModel?.(nextSelectedId, model);
    }
  }, [adapter, currentSelectedId, models, onSelectModel, selectedId]);

  const selectModel = useCallback((id: string) => {
    const model = models.find((item) => adapter.getId(item) === id) || null;
    if (selectedId === undefined) {
      setInternalSelectedId(id);
    }
    onSelectModel?.(id, model);
  }, [adapter, models, onSelectModel, selectedId]);

  return {
    adapter,
    models,
    filteredModels,
    groupedModels,
    selectedId: currentSelectedId,
    selectedModel,
    isLoading,
    error,
    searchQuery,
    capabilityFilter,
    sourceFilter,
    capabilityOptions,
    sourceOptions,
    setSearchQuery,
    setCapabilityFilter,
    setSourceFilter,
    selectModel,
    refresh,
  };
}
