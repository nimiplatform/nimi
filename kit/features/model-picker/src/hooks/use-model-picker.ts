import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ModelPickerCandidateAdapter, ModelPickerGroup } from '../types.js';

export type UseModelPickerOptions<TCandidate> = {
  readonly adapter: ModelPickerCandidateAdapter<TCandidate>;
  readonly selectedId?: string;
  readonly initialSelectedId?: string;
  readonly onSelectCandidate?: (id: string, candidate: TCandidate) => void;
};

export type UseModelPickerResult<TCandidate> = {
  readonly adapter: ModelPickerCandidateAdapter<TCandidate>;
  readonly candidates: readonly TCandidate[];
  readonly filteredCandidates: readonly TCandidate[];
  readonly groupedCandidates: readonly ModelPickerGroup<TCandidate>[];
  readonly selectedId: string;
  readonly selectedCandidate: TCandidate | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly searchQuery: string;
  readonly capabilityFilter: string;
  readonly sourceFilter: string;
  readonly capabilityOptions: readonly string[];
  readonly sourceOptions: readonly string[];
  readonly setSearchQuery: (value: string) => void;
  readonly setCapabilityFilter: (value: string) => void;
  readonly setSourceFilter: (value: string) => void;
  readonly selectCandidate: (id: string) => void;
  readonly refresh: () => Promise<void>;
};

function normalized(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function useModelPicker<TCandidate>({
  adapter,
  selectedId,
  initialSelectedId = '',
  onSelectCandidate,
}: UseModelPickerOptions<TCandidate>): UseModelPickerResult<TCandidate> {
  const [candidates, setCandidates] = useState<readonly TCandidate[]>([]);
  const [internalSelectedId, setInternalSelectedId] = useState(initialSelectedId);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [capabilityFilter, setCapabilityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const deferredQuery = useDeferredValue(searchQuery);
  const currentSelectedId = selectedId ?? internalSelectedId;

  const refresh = useCallback(async (cancelled?: () => boolean) => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await adapter.listCandidates();
      if (cancelled?.()) return;
      setCandidates(next);
    } catch (nextError) {
      if (cancelled?.()) return;
      setCandidates([]);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      if (!cancelled?.()) setIsLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    let cancelled = false;
    void refresh(() => cancelled);
    return () => { cancelled = true; };
  }, [refresh]);

  const capabilityOptions = useMemo(() => {
    const values = new Set<string>();
    for (const candidate of candidates) {
      for (const capability of adapter.getCapabilities?.(candidate) || []) {
        const value = capability.trim();
        if (value) values.add(value);
      }
    }
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [adapter, candidates]);

  const sourceOptions = useMemo(() => {
    const values = new Set<string>();
    for (const candidate of candidates) {
      const value = adapter.getSource?.(candidate)?.trim();
      if (value) values.add(value);
    }
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [adapter, candidates]);

  const filteredCandidates = useMemo(() => {
    const query = deferredQuery.trim().toLowerCase();
    return candidates.filter((candidate) => {
      const capabilities = adapter.getCapabilities?.(candidate) || [];
      const source = adapter.getSource?.(candidate) || '';
      if (capabilityFilter !== 'all' && !capabilities.includes(capabilityFilter)) return false;
      if (sourceFilter !== 'all' && source !== sourceFilter) return false;
      if (!query) return true;
      const haystack = [
        adapter.getId(candidate),
        adapter.getTitle(candidate),
        adapter.getDescription?.(candidate),
        adapter.getSearchText?.(candidate),
        source,
        ...capabilities,
      ].map(normalized).join(' ');
      return haystack.includes(query);
    });
  }, [adapter, candidates, capabilityFilter, deferredQuery, sourceFilter]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => adapter.getId(candidate) === currentSelectedId) || null,
    [adapter, candidates, currentSelectedId],
  );

  const groupedCandidates = useMemo(() => {
    if (!adapter.getGroupKey) {
      return [{ key: 'all', label: 'All', candidates: filteredCandidates }];
    }
    const groups = new Map<string, TCandidate[]>();
    for (const candidate of filteredCandidates) {
      const key = adapter.getGroupKey(candidate)?.trim() || 'other';
      const entries = groups.get(key);
      if (entries) entries.push(candidate);
      else groups.set(key, [candidate]);
    }
    return [...groups.entries()].map(([key, entries]) => ({
      key,
      label: adapter.getGroupLabel?.(key, entries) || key,
      candidates: entries,
    }));
  }, [adapter, filteredCandidates]);

  const selectCandidate = useCallback((id: string) => {
    const candidate = candidates.find((entry) => adapter.getId(entry) === id);
    if (!candidate) return;
    if (selectedId === undefined) setInternalSelectedId(id);
    onSelectCandidate?.(id, candidate);
  }, [adapter, candidates, onSelectCandidate, selectedId]);

  return {
    adapter,
    candidates,
    filteredCandidates,
    groupedCandidates,
    selectedId: currentSelectedId,
    selectedCandidate,
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
    selectCandidate,
    refresh,
  };
}
