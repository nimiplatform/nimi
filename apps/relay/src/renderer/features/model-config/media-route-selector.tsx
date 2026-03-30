// MediaRouteSelector — explicit connector + model selector for media capabilities
// Reused for image, TTS, STT, and video route selection in settings drawer

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@nimiplatform/nimi-kit/ui';
import { getBridge } from '../../bridge/electron-bridge.js';
import type { RelayMediaRouteOptionsResponse } from '../../../shared/ipc-contract.js';
import { deriveMediaRouteDisplayState } from './media-route-state.js';

type ConnectorOption = RelayMediaRouteOptionsResponse['connectors'][number];

const DISABLED_VALUE = '__disabled__';

interface MediaRouteSelectorProps {
  capability: string;
  connectorId: string;
  model: string;
  onChange: (connectorId: string, model: string) => void;
  label: string;
}

export function MediaRouteSelector({
  capability,
  connectorId,
  model,
  onChange,
  label,
}: MediaRouteSelectorProps) {
  const { t } = useTranslation();
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [loadStatus, setLoadStatus] = useState<RelayMediaRouteOptionsResponse['loadStatus']>('ready');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getBridge()
      .mediaRoute.getOptions({ capability })
      .then((result) => {
        if (cancelled) return;
        setConnectors(result.connectors);
        setLoadStatus(result.loadStatus);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setConnectors([]);
          setLoadStatus('failed');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [capability, connectorId]);

  const displayState = deriveMediaRouteDisplayState(connectors, connectorId, model);
  const activeConnectorId = displayState.activeConnectorId;
  const selectedConnector = displayState.selectedConnector;
  const models = displayState.models;
  const selectedConnectorValue = selectedConnector?.connectorId || DISABLED_VALUE;
  const selectedModelValue = models.some((item) => item.modelId === displayState.displayModel)
    ? displayState.displayModel
    : undefined;

  const handleConnectorChange = useCallback(
    (newConnectorId: string) => {
      if (newConnectorId === DISABLED_VALUE) {
        onChange('', '');
        return;
      }
      const connector = connectors.find((c) => c.connectorId === newConnectorId);
      const firstModel = connector?.models[0]?.modelId ?? '';
      onChange(newConnectorId, firstModel);
    },
    [connectors, onChange],
  );

  const handleModelChange = useCallback(
    (newModel: string) => {
      const normalizedConnectorId = displayState.activeConnectorId;
      if (!normalizedConnectorId) {
        return;
      }
      onChange(normalizedConnectorId, newModel);
    },
    [displayState.activeConnectorId, onChange],
  );

  const connectorOptions = useMemo(
    () => [
      { value: DISABLED_VALUE, label: `-- ${t('mediaRoute.disabled', 'Disabled')}` },
      ...connectors.map((connector) => ({
        value: connector.connectorId,
        label: `${connector.label} (${connector.provider})`,
      })),
    ],
    [connectors, t],
  );
  const modelOptions = useMemo(
    () => models.map((item) => ({
      value: item.modelId,
      label: item.modelLabel || item.modelId,
    })),
    [models],
  );

  if (loading) {
    return (
      <div className="text-sm text-[color:var(--nimi-text-secondary)]">
        {t('mediaRoute.loading', 'Loading...')}
      </div>
    );
  }

  if (connectors.length === 0) {
    return (
      <div className="text-sm text-[color:var(--nimi-text-secondary)]">
        {loadStatus === 'failed'
          ? t('mediaRoute.connectorsUnavailable', 'Connector discovery failed for {{label}}', { label })
          : t('mediaRoute.noConnectors', 'No connectors available for {{label}}', { label })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex min-h-11 flex-col gap-1">
        <FieldLabel>{t('mediaRoute.connector', 'Connector')}</FieldLabel>
        <SelectField
          value={selectedConnectorValue}
          onValueChange={handleConnectorChange}
          options={connectorOptions}
          placeholder={t('mediaRoute.selectConnector', 'Select connector...')}
          selectClassName="font-normal"
        />
      </label>

      {(displayState.invalidConnector || displayState.invalidModel) && (
        <InlineNotice tone="warning">
          {t('mediaRoute.invalidRoute', 'Saved route is no longer available. Select a connector and model again.')}
        </InlineNotice>
      )}

      {loadStatus !== 'ready' && (
        <InlineNotice tone={loadStatus === 'failed' ? 'danger' : 'warning'}>
          {loadStatus === 'failed'
            ? t('mediaRoute.discoveryFailed', 'Connector discovery failed. Runtime or connector state is unavailable.')
            : t('mediaRoute.discoveryDegraded', 'Connector discovery is degraded. Some connector models could not be loaded.')}
        </InlineNotice>
      )}

      {selectedConnector && models.length > 0 ? (
        <label className="flex min-h-11 flex-col gap-1">
          <FieldLabel>{t('mediaRoute.model', 'Model')}</FieldLabel>
          <SelectField
            value={selectedModelValue}
            onValueChange={handleModelChange}
            options={modelOptions}
            placeholder={t('mediaRoute.selectModel', 'Select model...')}
            selectClassName="font-normal"
          />
        </label>
      ) : (
        <div className="text-sm text-[color:var(--nimi-text-secondary)]">
          {selectedConnector?.modelsStatus === 'unavailable'
            ? t('mediaRoute.modelsUnavailable', 'Selected connector models are unavailable for {{label}}.', { label })
            : t('mediaRoute.unconfigured', 'Select a connector to configure {{label}}.', { label })}
        </div>
      )}

      {/* Active indicator */}
      {activeConnectorId && displayState.displayModel && (
        <div className="truncate text-sm text-[color:var(--nimi-text-secondary)]">
          {t('mediaRoute.active', 'Active')}: <span className="text-[color:var(--nimi-text-primary)]">{displayState.displayModel}</span>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">
      {children}
    </p>
  );
}

function InlineNotice({ children, tone }: { children: ReactNode; tone: 'warning' | 'danger' }) {
  return (
    <div
      className={`rounded-2xl border px-3 py-2 text-sm ${
        tone === 'danger'
          ? 'border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]'
          : 'border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]'
      }`}
    >
      {children}
    </div>
  );
}
