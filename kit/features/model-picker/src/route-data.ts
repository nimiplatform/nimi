/**
 * Route Model Picker Data Layer
 *
 * Provides a transport-agnostic data provider interface and a complete React hook
 * that manages local model discovery, cloud connector listing, source toggle,
 * and model selection — so apps only need to render RouteModelPickerPanel.
 *
 * Usage (Stable capability-first route authority — preferred):
 *   const provider = createSnapshotRouteDataProvider(
 *     () => modClient.route.listOptions({ capability: 'text.generate' }),
 *   );
 *   const state = useRouteModelPickerData({ provider, capability: 'text.generate' });
 *   <RouteModelPickerPanel {...state.panelProps} />
 *
 * Usage (Electron apps like Relay):
 *   const provider: RouteModelPickerDataProvider = { listLocalModels: bridge..., ... };
 *   const state = useRouteModelPickerData({ provider, capability: 'text.generate' });
 *   <RouteModelPickerPanel {...state.panelProps} />
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { runtimeNimiRouteCapabilitiesMatch } from '@nimiplatform/kit/core/sdk-contract';
import { useModelPicker, type UseModelPickerResult } from './hooks/use-model-picker.js';
import type { ModelCatalogAdapter } from './types.js';
import type { RouteModelPickerPanelProps, RouteModelPickerSource } from './components/route-model-picker-panel.js';

// ---------------------------------------------------------------------------
// Data types — shared contract between provider and UI
// ---------------------------------------------------------------------------

export type RouteLocalModel = {
  localModelId: string;
  goRuntimeLocalModelId?: string;
  profileBindingId?: string;
  readinessRef?: string;
  modelId: string;
  label: string;
  engine: string;
  status: 'active' | 'installed' | 'unhealthy' | 'removed' | 'unspecified';
  capabilities: string[];
};

export type RouteConnector = {
  connectorId: string;
  provider: string;
  label: string;
  status: string;
};

export type RouteConnectorModel = {
  modelId: string;
  remoteModelCatalogId: string;
  providerModelId: string;
  provider?: string;
  modelLabel: string;
  available: boolean;
  capabilities: string[];
};

// ---------------------------------------------------------------------------
// Data provider interface — apps implement this per their transport
// ---------------------------------------------------------------------------

export interface RouteModelPickerDataProvider {
  listLocalModels(): Promise<RouteLocalModel[]>;
  listConnectors(): Promise<RouteConnector[]>;
  listConnectorModels(connectorId: string): Promise<RouteConnectorModel[]>;
  invalidate?(): void;
}

// ---------------------------------------------------------------------------
// SDK-direct provider (for Tauri apps that call runtime from renderer)
// ---------------------------------------------------------------------------

type LocalModelStatusCode = 0 | 1 | 2 | 3 | 4;

const STATUS_MAP: Record<LocalModelStatusCode, RouteLocalModel['status']> = {
  0: 'unspecified',
  1: 'installed',
  2: 'active',
  3: 'unhealthy',
  4: 'removed',
};

const STATUS_RANK: Record<RouteLocalModel['status'], number> = {
  active: 0,
  installed: 1,
  unhealthy: 2,
  removed: 3,
  unspecified: 4,
};

function mapLocalStatus(raw: number): RouteLocalModel['status'] {
  return STATUS_MAP[raw as LocalModelStatusCode] ?? 'unspecified';
}

// NOTE: The inventory-based provider (createInventoryRouteDataProvider / createSdkRouteDataProvider)
// has been removed. All app-facing route selection paths now use createSnapshotRouteDataProvider
// backed by runtime.route.listOptions(...).

// ---------------------------------------------------------------------------
// Snapshot-shaped route options (from runtime.route.listOptions)
// ---------------------------------------------------------------------------

/**
 * Shape of the capability-scoped route options snapshot returned by
 * `runtime.route.listOptions(...)`. This is the authoritative route option
 * source — the runtime pre-filters local models and cloud connectors by
 * capability before returning the snapshot.
 *
 * This type mirrors `NimiRuntimeRouteOptionsSnapshot` from the SDK but is declared
 * here so the kit layer does not import SDK internals directly.
 */
export type RouteOptionsSnapshot = {
  capability?: string;
  selectedTargetRef?: RouteTargetRef | null;
  inventory: {
    capability?: string;
    targets: ReadonlyArray<RouteInventoryTarget>;
  };
};

type RouteTargetRef =
  | {
    kind: 'local-runtime';
    version: 'v2';
    profileBindingId?: string;
    readinessRef?: string;
  }
  | {
    kind: 'cloud-connector';
    version: 'v2';
    connectorId: string;
    remoteModelCatalogId: string;
    providerModelId: string;
    provider?: string;
  };

type RouteInventoryTarget = {
  targetRef: RouteTargetRef;
  display: {
    label?: string;
    modelLabel?: string;
    provider?: string;
    engine?: string;
    model?: string;
  };
  readiness: {
    status?: string;
  };
  compatibility: {
    capabilities?: readonly string[];
  };
  evidence: {
    source: 'local-runtime' | 'cloud-connector' | string;
    localAssetId?: string;
    resolvedModelId?: string;
    engine?: string;
    connectorId?: string;
    remoteModelCatalogId?: string;
    providerModelId?: string;
    provider?: string;
  };
};

/**
 * Creates a data provider backed by a capability-scoped route options snapshot.
 *
 * This is the preferred provider for app-facing route pickers because the
 * runtime is the single authority for route option availability. The snapshot
 * already separates local models from cloud connectors and only includes
 * models that match the requested capability.
 *
 * Usage:
 *   const provider = createSnapshotRouteDataProvider(
 *     () => modClient.route.listOptions({ capability: 'text.generate' }),
 *   );
 */
export function createSnapshotRouteDataProvider(
  fetchSnapshot: () => Promise<RouteOptionsSnapshot>,
): RouteModelPickerDataProvider {
  // Keep a short-lived cache so repeated opens do not immediately refetch the
  // same capability-scoped route options.
  const SNAPSHOT_CACHE_TTL_MS = 10_000;
  let cacheEpoch = 0;
  let cachedSnapshot: RouteOptionsSnapshot | null = null;
  let cachedAt = 0;
  let cachedPromise: Promise<RouteOptionsSnapshot> | null = null;

  function invalidate(): void {
    cacheEpoch += 1;
    cachedSnapshot = null;
    cachedAt = 0;
    cachedPromise = null;
  }

  function getSnapshot(): Promise<RouteOptionsSnapshot> {
    if (cachedSnapshot && (Date.now() - cachedAt) < SNAPSHOT_CACHE_TTL_MS) {
      return Promise.resolve(cachedSnapshot);
    }
    if (!cachedPromise) {
      const epoch = cacheEpoch;
      const request = fetchSnapshot()
        .then((snapshot) => {
          if (epoch === cacheEpoch) {
            cachedSnapshot = snapshot;
            cachedAt = Date.now();
          }
          return snapshot;
        })
        .catch((error) => {
          if (epoch === cacheEpoch) {
            cachedSnapshot = null;
            cachedAt = 0;
          }
          throw error;
        })
        .finally(() => {
          if (cachedPromise === request) {
            cachedPromise = null;
          }
        });
      cachedPromise = request;
    }
    return cachedPromise;
  }

  return {
    async listLocalModels() {
      const snapshot = await getSnapshot();
      return (snapshot.inventory.targets || [])
        .flatMap((target): RouteLocalModel[] => {
          if (target.evidence.source !== 'local-runtime' || target.targetRef.kind !== 'local-runtime') {
            return [];
          }
          const localAssetId = String(target.evidence.localAssetId || '').trim();
          return [{
            localModelId: String(
              localAssetId
                || target.targetRef.profileBindingId
                || target.targetRef.readinessRef
                || '',
            ),
            goRuntimeLocalModelId: localAssetId || undefined,
            profileBindingId: target.targetRef.profileBindingId,
            readinessRef: target.targetRef.readinessRef,
            modelId: String(target.evidence.resolvedModelId || target.display.model || ''),
            label: String(target.display.label || target.display.model || localAssetId || ''),
            engine: String(target.evidence.engine || target.display.engine || ''),
            status: mapLocalStatus(
              target.readiness.status === 'active' ? 2
                : target.readiness.status === 'installed' || target.readiness.status === 'ready' ? 1
                  : target.readiness.status === 'unhealthy' ? 3
                    : target.readiness.status === 'removed' ? 4
                      : 0,
            ),
            capabilities: [...(target.compatibility.capabilities || [])] as string[],
          }];
        })
        .sort((a: RouteLocalModel, b: RouteLocalModel) => {
          const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
          if (rankDiff !== 0) return rankDiff;
          return a.localModelId.localeCompare(b.localModelId);
        });
    },
    async listConnectors() {
      const snapshot = await getSnapshot();
      const connectors = new Map<string, RouteConnector>();
      for (const target of snapshot.inventory.targets || []) {
        if (target.evidence.source !== 'cloud-connector' || target.targetRef.kind !== 'cloud-connector') continue;
        const connectorId = String(target.targetRef.connectorId || target.evidence.connectorId || '').trim();
        if (!connectorId || connectors.has(connectorId)) continue;
        const provider = String(target.targetRef.provider || target.evidence.provider || target.display.provider || '').trim();
        connectors.set(connectorId, {
          connectorId,
          provider,
          label: provider || connectorId,
          status: 'active',
        });
      }
      return [...connectors.values()];
    },
    async listConnectorModels(connectorId: string) {
      const snapshot = await getSnapshot();
      return (snapshot.inventory.targets || [])
        .flatMap((target): RouteConnectorModel[] => {
          if (target.evidence.source !== 'cloud-connector' || target.targetRef.kind !== 'cloud-connector') {
            return [];
          }
          if (target.targetRef.connectorId !== connectorId) {
            return [];
          }
          return [{
            modelId: String(target.targetRef.providerModelId || target.evidence.providerModelId || ''),
            remoteModelCatalogId: String(target.targetRef.remoteModelCatalogId || target.evidence.remoteModelCatalogId || ''),
            providerModelId: String(target.targetRef.providerModelId || target.evidence.providerModelId || ''),
            provider: target.targetRef.provider || target.evidence.provider || target.display.provider || undefined,
            modelLabel: String(target.display.modelLabel || target.display.label || target.targetRef.providerModelId || ''),
            available: true,
            capabilities: [...(target.compatibility.capabilities || [])] as string[],
          }];
        })
        .filter((model) => model.modelId && model.remoteModelCatalogId && model.providerModelId);
    },
    invalidate,
  };
}

// ---------------------------------------------------------------------------
// Display model type
// ---------------------------------------------------------------------------

export type RouteDisplayModel = {
  id: string;
  label: string;
  description?: string;
};

// ---------------------------------------------------------------------------
// Selection state
// ---------------------------------------------------------------------------

export type RouteModelPickerSelection = {
  source: RouteModelPickerSource;
  connectorId: string;
  model: string;
  /** Cloud provider resolved from the selected connector when source === 'cloud'. */
  provider?: string;
  remoteModelCatalogId?: string;
  providerModelId?: string;
  /** Human-readable model display name resolved at selection time. */
  modelLabel?: string;
  /** Local model metadata — populated when source === 'local'. */
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  profileBindingId?: string;
  readinessRef?: string;
  engine?: string;
  modelId?: string;
};

// ---------------------------------------------------------------------------
// Hook options and result
// ---------------------------------------------------------------------------

export type UseRouteModelPickerDataOptions = {
  provider: RouteModelPickerDataProvider;
  /** Runtime capability string for filtering (e.g. 'text.generate'). If omitted, all models shown. */
  capability?: string;
  /** Initial selection state. */
  initialSelection?: Partial<RouteModelPickerSelection>;
  /** Called when user changes source, connector, or model. */
  onSelectionChange?: (selection: RouteModelPickerSelection) => void;
  /** Labels for i18n. All optional with English defaults. */
  labels?: Partial<RouteModelPickerLabels>;
};

export type RouteModelPickerLabels = {
  source: string;
  local: string;
  cloud: string;
  connector: string;
  model: string;
  active: string;
  reset: string;
  loading: string;
  unavailable: string;
  localUnavailable: string;
  noLocalModels: string;
  selectConnector: string;
  noCloudModels: string;
  savedRouteUnavailable: string;
};

const DEFAULT_LABELS: RouteModelPickerLabels = {
  source: 'Source',
  local: 'Local',
  cloud: 'Cloud',
  connector: 'Connector',
  model: 'Model',
  active: 'Active',
  reset: 'Reset',
  loading: 'Loading models...',
  unavailable: 'Route options unavailable',
  localUnavailable: 'Local model discovery failed. Runtime may be unavailable.',
  noLocalModels: 'No local models available for this capability. Install a model via Desktop.',
  selectConnector: 'Select a connector to see available models.',
  noCloudModels: 'No models available for this connector.',
  savedRouteUnavailable: 'Saved route is no longer available.',
};

export type UseRouteModelPickerDataResult = {
  /** Current selection state. */
  selection: RouteModelPickerSelection;
  /** Local models (unfiltered). */
  localModels: readonly RouteLocalModel[];
  /** Cloud connectors. */
  connectors: readonly RouteConnector[];
  /** Whether data is loading. */
  loading: boolean;
  /** Model picker headless state for RouteModelPickerPanel. */
  pickerState: UseModelPickerResult<RouteDisplayModel>;
  /** Spread-ready props for RouteModelPickerPanel. */
  panelProps: Omit<RouteModelPickerPanelProps<RouteDisplayModel>, 'className' | 'pickerClassName'>;
  /** Change source (local/cloud). */
  changeSource: (source: RouteModelPickerSource) => void;
  /** Change connector (cloud). */
  changeConnector: (connectorId: string) => void;
  /** Refresh all data. */
  refresh: () => void;
};

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useRouteModelPickerData({
  provider,
  capability,
  initialSelection,
  onSelectionChange,
  labels: labelsInput,
}: UseRouteModelPickerDataOptions): UseRouteModelPickerDataResult {
  const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...labelsInput }), [labelsInput]);

  // --- Data state ---
  const [localModels, setLocalModels] = useState<RouteLocalModel[]>([]);
  const [localStatus, setLocalStatus] = useState<'unknown' | 'ready' | 'unavailable'>('unknown');
  const [connectors, setConnectors] = useState<RouteConnector[]>([]);
  const [connectorModelsMap, setConnectorModelsMap] = useState<Record<string, RouteConnectorModel[]>>({});
  const [loading, setLoading] = useState(true);

  // --- Selection state ---
  const [source, setSource] = useState<RouteModelPickerSource>(initialSelection?.source ?? 'local');
  const [connectorId, setConnectorId] = useState(initialSelection?.connectorId ?? '');
  const [model, setModel] = useState(initialSelection?.model ?? '');

  const selectedConnectorProvider = useMemo(
    () => connectors.find((connector) => connector.connectorId === connectorId)?.provider || '',
    [connectorId, connectors],
  );

  const selection: RouteModelPickerSelection = useMemo(
    () => ({
      source,
      connectorId,
      model,
      provider: source === 'cloud' ? selectedConnectorProvider || undefined : undefined,
    }),
    [connectorId, model, selectedConnectorProvider, source],
  );

  // --- Data fetching ---
  const fetchData = useCallback(async (isCancelled?: () => boolean) => {
    setLoading(true);
    const [localResult, connectorResult] = await Promise.allSettled([
      provider.listLocalModels(),
      provider.listConnectors(),
    ]);
    if (isCancelled?.()) return;
    if (localResult.status === 'fulfilled') {
      setLocalModels(localResult.value);
      setLocalStatus('ready');
    } else {
      setLocalModels([]);
      setLocalStatus('unavailable');
    }
    if (connectorResult.status === 'fulfilled') {
      setConnectors(connectorResult.value);
    } else {
      setConnectors([]);
    }
    setLoading(false);
  }, [provider]);

  const fetchConnectorModels = useCallback(async (cId: string, isCancelled?: () => boolean) => {
    if (!cId || connectorModelsMap[cId]) return;
    try {
      const models = await provider.listConnectorModels(cId);
      if (isCancelled?.()) return;
      setConnectorModelsMap((prev) => ({ ...prev, [cId]: models }));
    } catch {
      if (isCancelled?.()) return;
      setConnectorModelsMap((prev) => ({ ...prev, [cId]: [] }));
    }
  }, [provider, connectorModelsMap]);

  const firstConnectorId = connectors[0]?.connectorId ?? '';
  const connectorIdAvailable = Boolean(connectorId && connectors.some((connector) => connector.connectorId === connectorId));

  useEffect(() => {
    let cancelled = false;
    void fetchData(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  useEffect(() => {
    if (source !== 'cloud') return;
    if (!firstConnectorId) return;
    if (connectorIdAvailable) return;
    setConnectorId(firstConnectorId);
    void fetchConnectorModels(firstConnectorId);
  }, [connectorIdAvailable, fetchConnectorModels, firstConnectorId, source]);

  // Auto-fetch connector models when connectorId changes
  useEffect(() => {
    let cancelled = false;
    if (source === 'cloud' && connectorId) {
      void fetchConnectorModels(connectorId, () => cancelled);
    }
    return () => {
      cancelled = true;
    };
  }, [source, connectorId, fetchConnectorModels]);

  // --- Build display model list ---
  const availableModels: readonly RouteDisplayModel[] = useMemo(() => {
    if (source === 'local') {
      const filtered = capability
        ? localModels.filter((m) => runtimeNimiRouteCapabilitiesMatch(m.capabilities, capability))
        : localModels;
      return filtered.map((m) => ({
        id: m.localModelId,
        label: m.label,
        description: m.engine && m.engine !== 'unknown' ? m.engine : undefined,
      }));
    }
    const models = connectorModelsMap[connectorId] ?? [];
    const filtered = capability
      ? models.filter((m) => m.available && runtimeNimiRouteCapabilitiesMatch(m.capabilities, capability))
      : models.filter((m) => m.available);
    return filtered.map((m) => ({
      id: m.modelId,
      label: m.modelLabel || m.modelId,
      description: m.modelLabel && m.modelLabel !== m.modelId ? m.modelId : undefined,
    }));
  }, [source, localModels, connectorModelsMap, connectorId, capability]);

  // --- Model catalog adapter ---
  const adapter: ModelCatalogAdapter<RouteDisplayModel> = useMemo(() => ({
    listModels: () => availableModels,
    getId: (m) => m.id,
    getTitle: (m) => m.label,
    getDescription: (m) => m.description,
    getSearchText: (m) => `${m.id} ${m.label}`,
  }), [availableModels]);

  const activeModel = model || availableModels[0]?.id || '';

  const buildSelection = useCallback((sel: { source: RouteModelPickerSource; connectorId: string; model: string }): RouteModelPickerSelection => {
    // Resolve display label from available models
    const displayMatch = availableModels.find((m) => m.id === sel.model);
    const modelLabel = displayMatch?.label || undefined;

    if (sel.source === 'local' && sel.model) {
      const localModel = localModels.find((m) => m.localModelId === sel.model);
      if (localModel) {
        return {
          ...sel,
          modelLabel: modelLabel || localModel.label || localModel.modelId,
          localModelId: localModel.localModelId,
          goRuntimeLocalModelId: localModel.goRuntimeLocalModelId,
          profileBindingId: localModel.profileBindingId,
          readinessRef: localModel.readinessRef,
          engine: localModel.engine,
          modelId: localModel.modelId,
        };
      }
    }
    if (sel.source === 'cloud' && sel.model) {
      const connectorModel = (connectorModelsMap[sel.connectorId] || [])
        .find((candidate) => candidate.modelId === sel.model);
      if (connectorModel) {
        return {
          ...sel,
          provider: connectorModel.provider || selectedConnectorProvider || undefined,
          remoteModelCatalogId: connectorModel.remoteModelCatalogId,
          providerModelId: connectorModel.providerModelId,
          modelLabel: modelLabel || connectorModel.modelLabel || connectorModel.providerModelId,
        };
      }
    }
    return {
      ...sel,
      provider: sel.source === 'cloud' ? selectedConnectorProvider || undefined : undefined,
      modelLabel,
    };
  }, [localModels, availableModels, selectedConnectorProvider, connectorModelsMap]);

  const handleSelectModel = useCallback((id: string) => {
    if (id && id !== model) {
      setModel(id);
      onSelectionChange?.(buildSelection({ source, connectorId, model: id }));
    }
  }, [buildSelection, connectorId, model, onSelectionChange, source]);

  const pickerState = useModelPicker({
    adapter,
    selectedId: activeModel,
    onSelectModel: handleSelectModel,
  });

  // --- Connector options ---
  const connectorOptions = useMemo(
    () => connectors.map((c) => ({
      value: c.connectorId,
      label: `${c.label} (${c.provider})`,
    })),
    [connectors],
  );

  const hasConnectors = connectors.length > 0;

  // --- Banners ---
  const banners = useMemo(() => {
    const result: Array<{ tone: 'warning' | 'danger'; message: string }> = [];
    if (source === 'local' && localStatus === 'unavailable') {
      result.push({ tone: 'danger', message: labels.localUnavailable });
    }
    return result;
  }, [source, localStatus, labels]);

  // --- Empty message ---
  const emptyMessage = useMemo(() => {
    if (source === 'local') {
      return localStatus === 'unavailable' ? labels.localUnavailable : labels.noLocalModels;
    }
    return !connectorId ? labels.selectConnector : labels.noCloudModels;
  }, [source, localStatus, connectorId, labels]);

  // --- Event handlers ---
  const onSourceChange = useCallback((newSource: RouteModelPickerSource) => {
    pickerState.setSearchQuery('');
    const currentConnectorId = connectorIdAvailable ? connectorId : '';
    const nextConnectorId = newSource === 'cloud' ? (currentConnectorId || firstConnectorId) : '';
    setSource(newSource);
    setModel('');
    setConnectorId(nextConnectorId);
    if (nextConnectorId) {
      void fetchConnectorModels(nextConnectorId);
    }
    onSelectionChange?.({ source: newSource, connectorId: nextConnectorId, model: '' });
  }, [connectorId, connectorIdAvailable, fetchConnectorModels, firstConnectorId, onSelectionChange, pickerState]);

  const onConnectorChange = useCallback((newConnectorId: string) => {
    setConnectorId(newConnectorId);
    setModel('');
    void fetchConnectorModels(newConnectorId);
    onSelectionChange?.({ source, connectorId: newConnectorId, model: '' });
  }, [source, fetchConnectorModels, onSelectionChange]);

  const onReset = useCallback(() => {
    pickerState.setSearchQuery('');
    setSource('local');
    setConnectorId('');
    setModel('');
    onSelectionChange?.({ source: 'local', connectorId: '', model: '' });
  }, [onSelectionChange, pickerState]);

  // --- Panel props ---
  const panelProps: Omit<RouteModelPickerPanelProps<RouteDisplayModel>, 'className' | 'pickerClassName'> = useMemo(() => ({
    state: pickerState,
    loading,
    loadingMessage: labels.loading,
    unavailable: false,
    unavailableMessage: labels.unavailable,
    sourceValue: source,
    sourceOptions: [
      { value: 'local' as const, label: labels.local },
      { value: 'cloud' as const, label: labels.cloud, disabled: !hasConnectors },
    ],
    onSourceChange,
    sourceLabel: labels.source,
    showConnector: source === 'cloud' && hasConnectors,
    connectorLabel: labels.connector,
    connectorValue: connectorId,
    connectorOptions,
    onConnectorChange,
    modelLabel: labels.model,
    selectedModelLabel: labels.active,
    selectedModelValue: undefined,
    resetLabel: labels.reset,
    onReset,
    banners,
    emptyMessage,
  }), [
    pickerState, loading, labels, source, hasConnectors, onSourceChange,
    connectorId, connectorOptions, onConnectorChange, activeModel, onReset,
    banners, emptyMessage,
  ]);

  return {
    selection,
    localModels,
    connectors,
    loading,
    pickerState,
    panelProps,
    changeSource: onSourceChange,
    changeConnector: onConnectorChange,
    refresh: () => {
      provider.invalidate?.();
      setConnectorModelsMap({});
      void fetchData();
    },
  };
}
