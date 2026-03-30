// ChatRoutePanel — model selection UI for relay
// Source selector (local/cloud) + connector selector + model input

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRelayRoute } from './use-relay-route.js';
import { useModelPicker } from '@nimiplatform/nimi-kit/features/model-picker/headless';
import { RouteModelPickerPanel } from '@nimiplatform/nimi-kit/features/model-picker/ui';
import type { RelayRouteDisplayModel } from './relay-route-binding.js';

const EMPTY_ROUTE_MODELS: readonly RelayRouteDisplayModel[] = [];

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

  const connectors = options?.connectors ?? [];
  const hasConnectors = connectors.length > 0;
  const source = display?.source ?? 'local';
  const selectedConnector = connectors.find((connector) => connector.connectorId === display?.connectorId) || null;
  const availableModels = display?.availableModels ?? EMPTY_ROUTE_MODELS;
  const activeModel = display?.model ?? '';
  const modelPickerAdapter = useMemo(() => ({
    listModels: () => availableModels,
    getId: (model: (typeof availableModels)[number]) => model.id,
    getTitle: (model: (typeof availableModels)[number]) => model.label,
    getDescription: (model: (typeof availableModels)[number]) => model.id === model.label ? undefined : model.id,
    getSearchText: (model: (typeof availableModels)[number]) => `${model.id} ${model.label}`,
  }), [availableModels, source, t]);
  const modelPickerState = useModelPicker({
    adapter: modelPickerAdapter,
    selectedId: activeModel || availableModels[0]?.id || '',
    onSelectModel: (id) => {
      if (id && id !== activeModel) {
        void onModelChange(id);
      }
    },
  });

  const routeBanners = useMemo(() => {
    const next: Array<{ tone: 'warning' | 'danger'; message: string }> = [];

    if (display?.invalidBinding) {
      next.push({
        tone: 'warning',
        message: t('route.fallbackWarning', 'Saved route is no longer available. Relay is using the active route shown below.'),
      });
    }

    if (options?.loadStatus === 'failed') {
      next.push({
        tone: 'danger',
        message: t('route.routeLoadFailed', 'Route discovery failed. Runtime or connector state is unavailable.'),
      });
    } else if (options?.loadStatus === 'degraded') {
      next.push({
        tone: 'warning',
        message: t('route.routeLoadDegraded', 'Route discovery is degraded. Some models or connectors could not be loaded.'),
      });
    }

    return next;
  }, [display?.invalidBinding, options?.loadStatus, t]);

  const connectorOptions = useMemo(
    () => connectors.map((connector) => ({
      value: connector.connectorId,
      label: `${connector.label} (${connector.provider})`,
    })),
    [connectors],
  );

  const emptyMessage = useMemo(() => {
    if (source === 'local') {
      return options?.local.status === 'unavailable'
        ? t('route.localLoadFailed', 'Local model discovery failed. Runtime may be unavailable.')
        : t('route.noLocalModels', 'No local models available. Install a model via Desktop.');
    }
    return selectedConnector?.modelsStatus === 'unavailable'
      ? t('route.connectorLoadFailed', 'Connector model discovery failed for this route.')
      : t('route.noCloudModels', 'No models available for this connector.');
  }, [options?.local.status, selectedConnector?.modelsStatus, source, t]);

  return (
    <RouteModelPickerPanel
      state={modelPickerState}
      loading={loading}
      loadingMessage={t('route.loading', 'Loading models...')}
      unavailable={!options}
      unavailableMessage={t('route.unavailable', 'Route options unavailable')}
      sourceValue={source}
      sourceOptions={[
        { value: 'local', label: t('route.local', 'Local') },
        { value: 'cloud', label: t('route.cloud', 'Cloud'), disabled: !hasConnectors },
      ]}
      onSourceChange={onSourceChange}
      sourceLabel={t('route.source', 'Source')}
      showConnector={source === 'cloud' && hasConnectors}
      connectorLabel={t('route.connector', 'Connector')}
      connectorValue={display?.connectorId}
      connectorOptions={connectorOptions}
      onConnectorChange={onConnectorChange}
      modelLabel={t('route.model', 'Model')}
      selectedModelLabel={t('route.active', 'Active')}
      selectedModelValue={activeModel || t('route.selectModel', 'Select a model...')}
      resolvedRouteLabel={t('route.active', 'Active')}
      resolvedRouteValue={display?.activeQualifiedModel || undefined}
      resetLabel={t('route.reset', 'Reset')}
      onReset={() => {
        modelPickerState.setSearchQuery('');
        void onReset();
      }}
      banners={routeBanners}
      emptyMessage={emptyMessage}
    />
  );
}
