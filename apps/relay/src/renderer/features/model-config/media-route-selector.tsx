// MediaRouteSelector — explicit connector + model selector for media capabilities
// Reused for image, TTS, STT, and video route selection in settings drawer

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getBridge } from '../../bridge/electron-bridge.js';
import type { RelayMediaRouteOptionsResponse } from '../../../shared/ipc-contract.js';
import { deriveMediaRouteDisplayState } from './media-route-state.js';

type ConnectorOption = RelayMediaRouteOptionsResponse['connectors'][number];

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
  const [modelDraft, setModelDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);

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
  const displayValue = isEditing ? modelDraft : displayState.displayModel;
  const datalistId = `media-route-${capability.replace(/\./g, '-')}`;

  const handleConnectorChange = useCallback(
    (newConnectorId: string) => {
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

  if (loading) {
    return (
      <div className="text-[12px] text-text-secondary">
        {t('mediaRoute.loading', 'Loading...')}
      </div>
    );
  }

  if (connectors.length === 0) {
    return (
      <div className="text-[12px] text-text-secondary">
        {loadStatus === 'failed'
          ? t('mediaRoute.connectorsUnavailable', 'Connector discovery failed for {{label}}', { label })
          : t('mediaRoute.noConnectors', 'No connectors available for {{label}}', { label })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Connector selector */}
      <select
        value={activeConnectorId}
        onChange={(e) => handleConnectorChange(e.target.value)}
        className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-3 py-1.5 text-[12px] text-text-primary focus:outline-none focus:border-accent"
      >
        <option value="">{t('mediaRoute.selectConnector', 'Select connector...')}</option>
        {connectors.map((c) => (
          <option key={c.connectorId} value={c.connectorId}>
            {c.label} ({c.provider})
          </option>
        ))}
      </select>

      {(displayState.invalidConnector || displayState.invalidModel) && (
        <div className="text-[11px] text-warning">
          {t('mediaRoute.invalidRoute', 'Saved route is no longer available. Select a connector and model again.')}
        </div>
      )}

      {loadStatus !== 'ready' && (
        <div className="text-[11px] text-warning">
          {loadStatus === 'failed'
            ? t('mediaRoute.discoveryFailed', 'Connector discovery failed. Runtime or connector state is unavailable.')
            : t('mediaRoute.discoveryDegraded', 'Connector discovery is degraded. Some connector models could not be loaded.')}
        </div>
      )}

      {/* Model input with datalist */}
      {selectedConnector && models.length > 0 ? (
        <>
          <input
            list={datalistId}
            value={displayValue}
            onFocus={() => {
              setIsEditing(true);
              setModelDraft(displayState.displayModel);
            }}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => {
              if (isEditing && modelDraft !== displayState.displayModel) {
                void handleModelChange(modelDraft);
              }
              setIsEditing(false);
              setModelDraft('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && modelDraft !== displayState.displayModel) {
                void handleModelChange(modelDraft);
                setIsEditing(false);
                setModelDraft('');
              }
              if (e.key === 'Escape') {
                setIsEditing(false);
                setModelDraft('');
              }
            }}
            placeholder={t('mediaRoute.selectModel', 'Select model...')}
            className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-3 py-1.5 text-[12px] text-text-primary focus:outline-none focus:border-accent"
          />
          <datalist id={datalistId}>
            {models.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.modelLabel || m.modelId}
              </option>
            ))}
          </datalist>
        </>
      ) : (
        <div className="text-[12px] text-text-secondary">
          {selectedConnector?.modelsStatus === 'unavailable'
            ? t('mediaRoute.modelsUnavailable', 'Selected connector models are unavailable for {{label}}.', { label })
            : t('mediaRoute.unconfigured', 'Select a connector to configure {{label}}.', { label })}
        </div>
      )}

      {/* Active indicator */}
      {activeConnectorId && displayState.displayModel && (
        <div className="text-[12px] text-text-secondary truncate">
          {t('mediaRoute.active', 'Active')}: <span className="text-text-primary">{displayState.displayModel}</span>
        </div>
      )}
    </div>
  );
}
