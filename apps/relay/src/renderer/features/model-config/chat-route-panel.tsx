// ChatRoutePanel — compact model selection UI for relay
// Uses kit useRouteModelPickerData for data + simple dropdown UI.
// Selection changes are persisted to main process via bridge.route.setBinding().

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getBridge } from '../../bridge/electron-bridge.js';
import { useRelayRoute } from './use-relay-route.js';
import {
  useRouteModelPickerData,
  type RouteModelPickerDataProvider,
  type RouteLocalModel,
  type RouteDisplayModel,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker/headless';
import { Button, SearchField, SelectField, SettingsCard } from '@nimiplatform/nimi-kit/ui';

// ---------------------------------------------------------------------------
// Local model status mapping
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

// ---------------------------------------------------------------------------
// Bridge-based data provider (Electron IPC)
// ---------------------------------------------------------------------------

function createBridgeRouteDataProvider(): RouteModelPickerDataProvider {
  return {
    async listLocalModels() {
      const bridge = getBridge();
      const response = await bridge.local.listModels({} as Parameters<typeof bridge.local.listModels>[0]);
      return (response.models || [])
        .map((m: any) => ({
          localModelId: m.localModelId as string,
          modelId: m.modelId as string,
          engine: (m.engine || 'llama') as string,
          status: mapLocalStatus(m.status as number),
          capabilities: [...(m.capabilities || [])] as string[],
        }))
        .sort((a: RouteLocalModel, b: RouteLocalModel) => {
          const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
          if (rankDiff !== 0) return rankDiff;
          return a.localModelId.localeCompare(b.localModelId);
        });
    },
    async listConnectors() {
      const bridge = getBridge();
      const response = await bridge.connector.list({} as Parameters<typeof bridge.connector.list>[0]);
      return (response.connectors || []).map((c: any) => ({
        connectorId: c.connectorId as string,
        provider: c.provider as string,
        label: (c.label || c.provider) as string,
        status: String(c.status),
      }));
    },
    async listConnectorModels(connectorId: string) {
      const bridge = getBridge();
      const response = await bridge.connector.listModels({ connectorId } as Parameters<typeof bridge.connector.listModels>[0]);
      return (response.models || []).map((m: any) => ({
        modelId: m.modelId as string,
        modelLabel: (m.modelLabel || m.modelId) as string,
        available: Boolean(m.available),
        capabilities: [...(m.capabilities || [])] as string[],
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// ChatRoutePanel — compact layout with searchable dropdown
// ---------------------------------------------------------------------------

export function ChatRoutePanel() {
  const { t } = useTranslation();
  const {
    binding,
    snapshot,
    display,
    options,
    loading: routeLoading,
  } = useRelayRoute();

  const labels = useMemo(() => ({
    source: t('route.source', 'Source'),
    local: t('route.local', 'Local'),
    cloud: t('route.cloud', 'Cloud'),
    connector: t('route.connector', 'Connector'),
    model: t('route.model', 'Model'),
    active: t('route.active', 'Active'),
    reset: t('route.reset', 'Reset'),
    loading: t('route.loading', 'Loading models...'),
    unavailable: t('route.unavailable', 'Route options unavailable'),
    localUnavailable: t('route.localLoadFailed', 'Local model discovery failed. Runtime may be unavailable.'),
    noLocalModels: t('route.noLocalModels', 'No local models available. Install a model via Desktop.'),
    selectConnector: t('route.selectConnector', 'Select a connector to see available models.'),
    noCloudModels: t('route.noCloudModels', 'No models available for this connector.'),
    savedRouteUnavailable: t('route.fallbackWarning', 'Saved route is no longer available.'),
  }), [t]);

  const provider = useMemo<RouteModelPickerDataProvider>(() => createBridgeRouteDataProvider(), []);
  const initialSelection = useMemo<RouteModelPickerSelection>(() => {
    const source = display?.source ?? binding?.source ?? 'local';
    if (source === 'cloud') {
      return {
        source,
        connectorId: display?.connectorId ?? binding?.connectorId ?? snapshot?.connectorId ?? '',
        model: display?.model ?? binding?.model ?? '',
      };
    }

    const selectedLocalModelId = snapshot?.localModelId
      ?? binding?.localModelId
      ?? options?.local.models.find((item) => (
        item.modelId === display?.model || item.localModelId === display?.model
      ))?.localModelId
      ?? '';

    return {
      source,
      connectorId: '',
      model: selectedLocalModelId,
    };
  }, [binding, display, options?.local.models, snapshot]);

  const routeBanners = useMemo(() => {
    const next: Array<{ tone: 'warning' | 'danger'; message: string }> = [];

    if (display?.invalidBinding) {
      next.push({
        tone: 'warning',
        message: labels.savedRouteUnavailable,
      });
    }

    if (options?.loadStatus === 'failed') {
      next.push({
        tone: 'danger',
        message: labels.unavailable,
      });
    } else if (options?.loadStatus === 'degraded') {
      next.push({
        tone: 'warning',
        message: labels.localUnavailable,
      });
    }

    return next;
  }, [display?.invalidBinding, labels, options?.loadStatus]);

  if (routeLoading) {
    return <p className="text-sm text-[color:var(--nimi-text-secondary)]">{labels.loading}</p>;
  }

  return (
    <ChatRoutePanelContent
      key={`${initialSelection.source}:${initialSelection.connectorId}:${initialSelection.model}`}
      provider={provider}
      labels={labels}
      initialSelection={initialSelection}
      routeBanners={routeBanners}
    />
  );
}

function ChatRoutePanelContent({
  provider,
  labels,
  initialSelection,
  routeBanners,
}: {
  provider: RouteModelPickerDataProvider;
  labels: {
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
  initialSelection: RouteModelPickerSelection;
  routeBanners: Array<{ tone: 'warning' | 'danger'; message: string }>;
}) {
  const handleSelectionChange = useCallback((selection: RouteModelPickerSelection) => {
    const bridge = getBridge();
    if (selection.source === 'local') {
      void bridge.route.setBinding({
        source: 'local',
        model: selection.model || undefined,
        localModelId: selection.model || undefined,
      });
      return;
    }

    void bridge.route.setBinding({
      source: 'cloud',
      connectorId: selection.connectorId || undefined,
      model: selection.model || undefined,
    });
  }, []);

  const {
    selection,
    connectors,
    loading,
    pickerState,
    changeSource,
    changeConnector,
  } = useRouteModelPickerData({
    provider,
    capability: 'text.generate',
    initialSelection,
    onSelectionChange: handleSelectionChange,
    labels,
  });

  if (loading) {
    return <p className="text-sm text-[color:var(--nimi-text-secondary)]">{labels.loading}</p>;
  }

  const hasConnectors = connectors.length > 0;
  const models = pickerState.models;
  const connectorOptions = connectors.map((c) => ({
    value: c.connectorId,
    label: `${c.label} (${c.provider})`,
  }));

  return (
    <div className="space-y-3">
      {routeBanners.map((banner) => (
        <SettingsCard
          key={`${banner.tone}:${banner.message}`}
          className={`rounded-2xl px-3 py-2.5 text-sm ${
            banner.tone === 'danger'
              ? 'border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,transparent)] text-[var(--nimi-status-danger)]'
              : 'border border-[color-mix(in_srgb,var(--nimi-text-warning)_30%,transparent)] text-[var(--nimi-text-warning)]'
          }`}
        >
          {banner.message}
        </SettingsCard>
      ))}

      {/* Source toggle */}
      <div className="space-y-1.5">
        <FieldLabel>{labels.source}</FieldLabel>
        <div className="flex gap-2">
          <Button
            tone={selection.source === 'local' ? 'primary' : 'secondary'}
            size="sm"
            fullWidth
            onClick={() => changeSource('local')}
          >
            {labels.local}
          </Button>
          <Button
            tone={selection.source === 'cloud' ? 'primary' : 'secondary'}
            size="sm"
            fullWidth
            disabled={!hasConnectors}
            onClick={() => changeSource('cloud')}
          >
            {labels.cloud}
          </Button>
        </div>
      </div>

      {/* Connector (cloud only) */}
      {selection.source === 'cloud' && hasConnectors && (
        <div className="space-y-1.5">
          <FieldLabel>{labels.connector}</FieldLabel>
          <SelectField
            value={selection.connectorId || undefined}
            onValueChange={changeConnector}
            options={connectorOptions}
            placeholder={labels.selectConnector}
            selectClassName="font-normal"
          />
        </div>
      )}

      {/* Model — searchable dropdown */}
      <div className="space-y-1.5">
        <FieldLabel>{labels.model}</FieldLabel>
        {models.length > 0 ? (
          <CompactModelPicker
            models={models}
            selectedId={pickerState.selectedId}
            onSelect={pickerState.selectModel}
          />
        ) : (
          <SettingsCard className="rounded-2xl px-3 py-2.5 text-sm text-[color:var(--nimi-text-secondary)]">
            {selection.source === 'local' ? labels.noLocalModels : labels.noCloudModels}
          </SettingsCard>
        )}
      </div>

      {/* Active model + Reset */}
      {pickerState.selectedId && (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-[color:var(--nimi-text-secondary)]">
            {labels.active}: <span className="text-[color:var(--nimi-text-primary)]">
              {pickerState.selectedModel ? pickerState.adapter.getTitle(pickerState.selectedModel) : pickerState.selectedId}
            </span>
          </p>
          <Button tone="ghost" size="sm" onClick={() => changeSource('local')}>
            {labels.reset}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompactModelPicker — searchable list with item highlight
// ---------------------------------------------------------------------------

function CompactModelPicker({
  models,
  selectedId,
  onSelect,
}: {
  models: readonly RouteDisplayModel[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = normalizedQuery
    ? models.filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(normalizedQuery))
    : models;

  return (
    <div className="space-y-2">
      {models.length > 3 && (
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models"
        />
      )}
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {filtered.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
              m.id === selectedId
                ? 'border border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] text-[color:var(--nimi-text-primary)]'
                : 'border border-transparent bg-[var(--nimi-surface-card)] text-[color:var(--nimi-text-primary)] hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,var(--nimi-border-subtle))]'
            }`}
          >
            <p className="font-medium truncate">{m.label}</p>
            {m.description && (
              <p className="mt-0.5 text-xs text-[color:var(--nimi-text-secondary)] truncate">{m.description}</p>
            )}
          </button>
        ))}
        {filtered.length === 0 && normalizedQuery && (
          <p className="px-3 py-2 text-sm text-[color:var(--nimi-text-secondary)]">No models match "{query}"</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">
      {children}
    </p>
  );
}
