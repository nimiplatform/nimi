// ChatRoutePanel — model selection UI for relay
// Source selector (local/cloud) + connector selector + model input

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRelayRoute } from './use-relay-route.js';
import { useModelPicker } from '@nimiplatform/nimi-kit/features/model-picker/headless';
import { ModelPicker } from '@nimiplatform/nimi-kit/features/model-picker/ui';

export function ChatRoutePanel() {
  const { t } = useTranslation();
  const {
    options,
    display,
    loading,
    onSourceChange,
    onConnectorChange,
    onModelChange,
    onReset,
  } = useRelayRoute();

  if (loading) {
    return (
      <div className="text-[12px] text-text-secondary">
        {t('route.loading', 'Loading models...')}
      </div>
    );
  }

  if (!options) {
    return (
      <div className="text-[12px] text-text-secondary">
        {t('route.unavailable', 'Route options unavailable')}
      </div>
    );
  }

  const connectors = options.connectors;
  const hasConnectors = connectors.length > 0;
  const source = display?.source ?? 'local';
  const selectedConnector = connectors.find((connector) => connector.connectorId === display?.connectorId) || null;
  const availableModels = display?.availableModels ?? [];
  const activeModel = display?.model ?? '';
  const modelPickerState = useModelPicker({
    adapter: useMemo(() => ({
      listModels: () => availableModels,
      getId: (model: (typeof availableModels)[number]) => model.id,
      getTitle: (model: (typeof availableModels)[number]) => model.label,
      getDescription: (model: (typeof availableModels)[number]) => model.id === model.label ? undefined : model.id,
      getSource: () => source,
      getBadges: () => source === 'cloud'
        ? [{ label: t('route.cloud', 'Cloud'), tone: 'accent' as const }]
        : [{ label: t('route.local', 'Local'), tone: 'success' as const }],
      getSearchText: (model: (typeof availableModels)[number]) => `${model.id} ${model.label}`,
    }), [availableModels, source, t]),
    selectedId: activeModel || availableModels[0]?.id || '',
    onSelectModel: (id) => {
      if (id && id !== activeModel) {
        void onModelChange(id);
      }
    },
  });

  return (
    <div className="space-y-3">
      {/* Source selector */}
      <div>
        <label className="text-[11px] text-text-secondary uppercase tracking-wider mb-1 block">
          {t('route.source', 'Source')}
        </label>
        <div className="flex rounded-lg overflow-hidden border border-border-subtle">
          <button
            onClick={() => onSourceChange('local')}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              source === 'local'
                ? 'bg-accent text-white'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            {t('route.local', 'Local')}
          </button>
          <button
            onClick={() => onSourceChange('cloud')}
            disabled={!hasConnectors}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              source === 'cloud'
                ? 'bg-accent text-white'
                : hasConnectors
                  ? 'bg-bg-elevated text-text-secondary hover:text-text-primary'
                  : 'bg-bg-elevated text-text-placeholder cursor-not-allowed'
            }`}
          >
            {t('route.cloud', 'Cloud')}
          </button>
        </div>
      </div>

      {/* Connector selector (cloud only) */}
      {source === 'cloud' && hasConnectors && (
        <div>
          <label className="text-[11px] text-text-secondary uppercase tracking-wider mb-1 block">
            {t('route.connector', 'Connector')}
          </label>
          <select
            value={display?.connectorId ?? ''}
            onChange={(e) => onConnectorChange(e.target.value)}
            className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-3 py-1.5 text-[12px] text-text-primary focus:outline-none focus:border-accent"
          >
            {connectors.map((c) => (
              <option key={c.connectorId} value={c.connectorId}>
                {c.label} ({c.provider})
              </option>
            ))}
          </select>
        </div>
      )}

      {display?.invalidBinding && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {t('route.fallbackWarning', 'Saved route is no longer available. Relay is using the active route shown below.')}
        </div>
      )}

      {options.loadStatus !== 'ready' && (
        <div className={`rounded-lg px-3 py-2 text-[12px] ${
          options.loadStatus === 'failed'
            ? 'border border-danger/40 bg-danger/10 text-danger'
            : 'border border-warning/40 bg-warning/10 text-warning'
        }`}>
          {options.loadStatus === 'failed'
            ? t('route.routeLoadFailed', 'Route discovery failed. Runtime or connector state is unavailable.')
            : t('route.routeLoadDegraded', 'Route discovery is degraded. Some models or connectors could not be loaded.')}
        </div>
      )}

      {/* Model input with datalist autocomplete */}
      <div>
        <label className="text-[11px] text-text-secondary uppercase tracking-wider mb-1 block">
          {t('route.model', 'Model')}
        </label>
        {availableModels.length > 0 ? (
          <div className="space-y-2">
            <div className="rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-[12px] text-text-secondary">
              {t('route.active', 'Active')}: <span className="text-text-primary">{activeModel || t('route.selectModel', 'Select a model...')}</span>
            </div>
            <ModelPicker
              state={modelPickerState}
              className="relay-model-picker"
              loadingMessage={t('route.loading', 'Loading models...')}
              emptyMessage={t('route.noLocalModels', 'No local models available. Install a model via Desktop.')}
            />
          </div>
        ) : source === 'local' ? (
          <div className="text-[12px] text-text-secondary bg-bg-surface border border-border-subtle rounded-xl px-3 py-2">
            {options.local.status === 'unavailable'
              ? t('route.localLoadFailed', 'Local model discovery failed. Runtime may be unavailable.')
              : t('route.noLocalModels', 'No local models available. Install a model via Desktop.')}
          </div>
        ) : (
          <div className="text-[12px] text-text-secondary bg-bg-surface border border-border-subtle rounded-xl px-3 py-2">
            {selectedConnector?.modelsStatus === 'unavailable'
              ? t('route.connectorLoadFailed', 'Connector model discovery failed for this route.')
              : t('route.noCloudModels', 'No models available for this connector.')}
          </div>
        )}
      </div>

      {/* Active model indicator + reset */}
      {display?.activeQualifiedModel && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary truncate">
            {t('route.active', 'Active')}: <span className="text-text-primary">{display.activeQualifiedModel}</span>
          </span>
          <button
            onClick={() => {
              setModelQuery('');
              setIsEditing(false);
              void onReset();
            }}
            className="text-text-secondary hover:text-text-primary ml-2 shrink-0"
          >
            {t('route.reset', 'Reset')}
          </button>
        </div>
      )}
    </div>
  );
}
