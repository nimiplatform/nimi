// MediaRouteSelector — connector + model selector for media capabilities
// Compact layout for settings sidebar

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
      if (!normalizedConnectorId) return;
      onChange(normalizedConnectorId, newModel);
    },
    [displayState.activeConnectorId, onChange],
  );

  const connectorOptions = useMemo(
    () => [
      { value: DISABLED_VALUE, label: t('mediaRoute.disabled', 'Disabled') },
      ...connectors.map((connector) => ({
        value: connector.connectorId,
        label: connector.label,
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
    return <p className="text-[13px] text-[color:var(--nimi-text-muted)]">{t('mediaRoute.loading', 'Loading...')}</p>;
  }

  if (connectors.length === 0) {
    return (
      <p className="text-[13px] text-[color:var(--nimi-text-muted)]">
        {t('mediaRoute.noConnectors', 'No connectors available.')}
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <SelectField
        value={selectedConnectorValue}
        onValueChange={handleConnectorChange}
        options={connectorOptions}
        selectClassName="font-normal"
      />

      {selectedConnector && models.length > 0 ? (
        <SelectField
          value={selectedModelValue}
          onValueChange={handleModelChange}
          options={modelOptions}
          placeholder={t('mediaRoute.selectModel', 'Select model...')}
          selectClassName="font-normal"
        />
      ) : !selectedConnector ? (
        <p className="text-[12px] text-[color:var(--nimi-text-muted)]">
          {t('mediaRoute.unconfigured', 'Select a connector to configure {{label}}.', { label })}
        </p>
      ) : null}
    </div>
  );
}
