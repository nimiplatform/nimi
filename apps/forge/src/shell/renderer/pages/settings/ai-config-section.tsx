/**
 * AI Configuration Section for Settings Page
 *
 * Displays available connectors/models and lets users select per capability.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAiConfigStore,
  type ForgeAiCapability,
  type ForgeAiRoute,
  type ForgeConnectorSummary,
  type ForgeConnectorModel,
} from '@renderer/state/ai-config-store.js';

const CAPABILITIES: { key: ForgeAiCapability; label: string }[] = [
  { key: 'text', label: 'Text Generation' },
  { key: 'image', label: 'Image Generation' },
  { key: 'music', label: 'Music Generation' },
];

const ROUTES: { value: ForgeAiRoute; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'local', label: 'Local' },
  { value: 'cloud', label: 'Cloud' },
];

export function AiConfigSection() {
  const { t } = useTranslation();
  const {
    selections,
    runtimeStatus,
    connectors,
    connectorModels,
    loading,
    error,
    setSelection,
    fetchConnectors,
    fetchConnectorModels,
    testConnector,
    checkRuntimeStatus,
    resetToDefaults,
  } = useAiConfigStore();

  useEffect(() => {
    void checkRuntimeStatus();
    void fetchConnectors();
  }, [checkRuntimeStatus, fetchConnectors]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
          {t('settings.aiConfig', 'AI Configuration')}
        </h2>
        <button
          onClick={() => {
            void checkRuntimeStatus();
            void fetchConnectors();
          }}
          disabled={loading}
          className="rounded px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 transition-colors disabled:opacity-50"
        >
          {loading ? t('settings.aiRefreshing', 'Refreshing...') : t('settings.aiRefresh', 'Refresh')}
        </button>
      </div>

      {/* Runtime status */}
      <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-2.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            runtimeStatus === 'connected'
              ? 'bg-green-500'
              : runtimeStatus === 'unavailable'
                ? 'bg-red-500'
                : 'bg-neutral-500'
          }`}
        />
        <span className="text-sm text-neutral-400">
          {t('settings.aiRuntime', 'Runtime')}:{' '}
          <span className={runtimeStatus === 'connected' ? 'text-green-400' : runtimeStatus === 'unavailable' ? 'text-red-400' : 'text-neutral-500'}>
            {runtimeStatus === 'connected'
              ? t('settings.aiConnected', 'Connected')
              : runtimeStatus === 'unavailable'
                ? t('settings.aiUnavailable', 'Unavailable')
                : t('settings.aiUnknown', 'Checking...')}
          </span>
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Capability cards */}
      {CAPABILITIES.map((cap) => (
        <CapabilityCard
          key={cap.key}
          capability={cap.key}
          label={t(`settings.ai${cap.key.charAt(0).toUpperCase()}${cap.key.slice(1)}`, cap.label)}
          selection={selections[cap.key]}
          connectors={connectors}
          models={connectorModels[selections[cap.key].connectorId] ?? []}
          disabled={runtimeStatus === 'unavailable'}
          onChangeConnector={(connectorId) => {
            setSelection(cap.key, { connectorId, model: 'auto' });
            if (connectorId) {
              void fetchConnectorModels(connectorId);
            }
          }}
          onChangeModel={(model) => setSelection(cap.key, { model })}
          onChangeRoute={(route) => setSelection(cap.key, { route })}
          onTest={testConnector}
        />
      ))}

      {/* Empty state */}
      {connectors.length === 0 && !loading && runtimeStatus === 'connected' && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
          <p className="text-xs text-neutral-500">
            {t('settings.aiNoConnectors', 'No connectors found. Configure AI providers in the Desktop app or check runtime status.')}
          </p>
        </div>
      )}

      {/* Reset */}
      <div className="pt-1">
        <button
          onClick={resetToDefaults}
          className="rounded px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 transition-colors"
        >
          {t('settings.aiResetDefaults', 'Reset to Defaults')}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CapabilityCard
// ---------------------------------------------------------------------------

function CapabilityCard({
  capability,
  label,
  selection,
  connectors,
  models,
  disabled,
  onChangeConnector,
  onChangeModel,
  onChangeRoute,
  onTest,
}: {
  capability: ForgeAiCapability;
  label: string;
  selection: { connectorId: string; model: string; route: ForgeAiRoute };
  connectors: ForgeConnectorSummary[];
  models: ForgeConnectorModel[];
  disabled: boolean;
  onChangeConnector: (connectorId: string) => void;
  onChangeModel: (model: string) => void;
  onChangeRoute: (route: ForgeAiRoute) => void;
  onTest: (connectorId: string) => Promise<{ success: boolean; error?: string }>;
}) {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  async function handleTest() {
    if (!selection.connectorId) return;
    setTesting(true);
    setTestResult(null);
    const result = await onTest(selection.connectorId);
    setTestResult(result);
    setTesting(false);
  }

  // Clear test result when connector changes
  useEffect(() => {
    setTestResult(null);
  }, [selection.connectorId]);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">{label}</p>
        {testResult && (
          <span className={`text-[10px] font-medium ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.success ? t('settings.aiTestOk', 'OK') : testResult.error || t('settings.aiTestFail', 'Failed')}
          </span>
        )}
      </div>

      {/* Connector */}
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-xs text-neutral-500">
          {t('settings.aiConnector', 'Connector')}
        </label>
        <select
          value={selection.connectorId}
          onChange={(e) => onChangeConnector(e.target.value)}
          disabled={disabled}
          className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-white focus:border-neutral-500 focus:outline-none disabled:opacity-50"
        >
          <option value="">{t('settings.aiAuto', 'Auto (Runtime Default)')}</option>
          {connectors.map((c) => (
            <option key={c.connectorId} value={c.connectorId}>
              {c.label || c.provider} ({c.provider})
            </option>
          ))}
        </select>
        {selection.connectorId && (
          <button
            onClick={() => void handleTest()}
            disabled={testing || disabled}
            title={t('settings.aiTestConnector', 'Test connector')}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {testing ? '...' : t('settings.aiTest', 'Test')}
          </button>
        )}
      </div>

      {/* Model */}
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-xs text-neutral-500">
          {t('settings.aiModel', 'Model')}
        </label>
        <select
          value={selection.model}
          onChange={(e) => onChangeModel(e.target.value)}
          disabled={disabled || !selection.connectorId}
          className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-white focus:border-neutral-500 focus:outline-none disabled:opacity-50"
        >
          <option value="auto">{t('settings.aiAutoModel', 'Auto')}</option>
          {models
            .filter((m) => m.available)
            .map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.modelLabel || m.modelId}
              </option>
            ))}
        </select>
      </div>

      {/* Route */}
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-xs text-neutral-500">
          {t('settings.aiRoute', 'Route')}
        </label>
        <div className="flex gap-1.5">
          {ROUTES.map((r) => (
            <button
              key={r.value}
              onClick={() => onChangeRoute(r.value)}
              disabled={disabled}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                selection.route === r.value
                  ? 'bg-white text-black'
                  : 'bg-neutral-800 text-neutral-400 hover:text-white'
              } disabled:opacity-50`}
            >
              {t(`settings.aiRoute${r.label}`, r.label)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
