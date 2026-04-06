// ChatRoutePanel — settings-drawer model selection UI for relay
// Uses kit RouteModelPickerPanel + useRouteModelPickerData for polished selection.
// Selection changes are persisted to main process via bridge.route.setBinding().

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getBridge } from '../../bridge/electron-bridge.js';
import { useRelayRoute } from './use-relay-route.js';
import { createBridgeRouteDataProvider } from './bridge-route-provider.js';
import {
  useRouteModelPickerData,
  type RouteModelPickerDataProvider,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker/headless';
import { RouteModelPickerPanel } from '@nimiplatform/nimi-kit/features/model-picker/ui';

// ---------------------------------------------------------------------------
// ChatRoutePanel — uses kit RouteModelPickerPanel
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
    panelProps,
    loading,
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

  return (
    <RouteModelPickerPanel
      {...panelProps}
      banners={[...routeBanners, ...(panelProps.banners ?? [])]}
    />
  );
}
