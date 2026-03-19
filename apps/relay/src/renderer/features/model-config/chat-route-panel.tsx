// ChatRoutePanel — model selection UI for relay
// Source selector (local/cloud) + connector selector + model input

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRelayRoute } from './use-relay-route.js';

export function ChatRoutePanel() {
  const { t } = useTranslation();
  const {
    options,
    binding,
    snapshot,
    loading,
    onSourceChange,
    onConnectorChange,
    onModelChange,
    onReset,
  } = useRelayRoute();

  const [modelQuery, setModelQuery] = useState('');

  if (loading) {
    return (
      <div className="text-xs text-gray-500">
        {t('route.loading', 'Loading models...')}
      </div>
    );
  }

  if (!options) {
    return (
      <div className="text-xs text-gray-500">
        {t('route.unavailable', 'Route options unavailable')}
      </div>
    );
  }

  const source = binding?.source ?? snapshot?.source ?? 'local';
  const localModels = options.local.models;
  const connectors = options.connectors;
  const hasConnectors = connectors.length > 0;

  // Build available model list for current source
  const availableModels: { id: string; label: string }[] = [];
  if (source === 'local') {
    for (const m of localModels) {
      const statusTag = m.status === 'active' ? '' : ` (${m.status})`;
      availableModels.push({ id: m.localModelId, label: `${m.modelId}${statusTag}` });
    }
  } else if (source === 'cloud') {
    const selectedConnector = connectors.find(
      (c) => c.connectorId === (binding?.connectorId ?? snapshot?.connectorId),
    );
    if (selectedConnector) {
      for (const m of selectedConnector.models) {
        availableModels.push({ id: m.modelId, label: m.modelLabel || m.modelId });
      }
    }
  }

  const activeModel = snapshot?.model ?? '';
  const isPending = modelQuery !== '' && modelQuery !== activeModel;
  const datalistId = 'relay-route-models';

  return (
    <div className="space-y-3">
      {/* Source selector */}
      <div>
        <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
          {t('route.source', 'Source')}
        </label>
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          <button
            onClick={() => onSourceChange('local')}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              source === 'local'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {t('route.local', 'Local')}
          </button>
          <button
            onClick={() => onSourceChange('cloud')}
            disabled={!hasConnectors}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              source === 'cloud'
                ? 'bg-blue-600 text-white'
                : hasConnectors
                  ? 'bg-gray-800 text-gray-400 hover:text-gray-200'
                  : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            }`}
          >
            {t('route.cloud', 'Cloud')}
          </button>
        </div>
      </div>

      {/* Connector selector (cloud only) */}
      {source === 'cloud' && hasConnectors && (
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
            {t('route.connector', 'Connector')}
          </label>
          <select
            value={binding?.connectorId ?? snapshot?.connectorId ?? ''}
            onChange={(e) => onConnectorChange(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
          >
            {connectors.map((c) => (
              <option key={c.connectorId} value={c.connectorId}>
                {c.label} ({c.provider})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Model input with datalist autocomplete */}
      <div>
        <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
          {t('route.model', 'Model')}
        </label>
        {availableModels.length > 0 ? (
          <div className={`rounded-lg ${isPending ? 'ring-1 ring-amber-500' : ''}`}>
            <input
              list={datalistId}
              value={modelQuery || activeModel}
              onChange={(e) => setModelQuery(e.target.value)}
              onBlur={() => {
                if (modelQuery && modelQuery !== activeModel) {
                  void onModelChange(modelQuery);
                  setModelQuery('');
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && modelQuery && modelQuery !== activeModel) {
                  void onModelChange(modelQuery);
                  setModelQuery('');
                }
              }}
              placeholder={activeModel || t('route.selectModel', 'Select a model...')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <datalist id={datalistId}>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </datalist>
          </div>
        ) : source === 'local' ? (
          <div className="text-xs text-gray-500 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
            {t('route.noLocalModels', 'No local models available. Install a model via Desktop.')}
          </div>
        ) : (
          <div className="text-xs text-gray-500 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
            {t('route.noCloudModels', 'No models available for this connector.')}
          </div>
        )}
      </div>

      {/* Active model indicator + reset */}
      {snapshot && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500 truncate">
            {t('route.active', 'Active')}: <span className="text-gray-300">{snapshot.model}</span>
          </span>
          <button
            onClick={() => {
              setModelQuery('');
              void onReset();
            }}
            className="text-gray-500 hover:text-gray-300 ml-2 shrink-0"
          >
            {t('route.reset', 'Reset')}
          </button>
        </div>
      )}
    </div>
  );
}
