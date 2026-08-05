import { useCallback, useEffect, useState } from 'react';
import type { NimiCapabilityAIConfig } from '@nimiplatform/sdk/ai';
import { fromNimiRuntimeProtoStruct } from '@nimiplatform/sdk/runtime';
import { Button, StatusBadge, TextField } from '@nimiplatform/kit/ui';

import { useTesterRendererHost } from '../../renderer/context.js';
import type { TesterRuntimeInspection } from '../tester-runtime.js';
import {
  createTesterCloudCapabilityIntent,
  createTesterLocalCapabilityIntent,
  findTesterCapabilityIntent,
  loadTesterAIConfig,
  overwriteTesterCapabilityIntent,
  removeTesterCapabilityIntent,
  type TesterCloudCapabilityIntentInput,
} from '../tester-ai-config-store.js';

type TesterAiConfigSettingsPanelProps = {
  runtime: TesterRuntimeInspection | null;
  capabilityId: string;
  onConfigChanged: () => void;
  onClose?: () => void;
};

export function TesterAiConfigSettingsPanel({
  runtime,
  capabilityId,
  onConfigChanged,
  onClose,
}: TesterAiConfigSettingsPanelProps) {
  const rendererHost = useTesterRendererHost();
  const [config, setConfig] = useState<NimiCapabilityAIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudDraft, setCloudDraft] = useState<TesterCloudCapabilityIntentInput>({
    implementationId: '',
    driverId: '',
    driverDialect: '',
    provider: '',
    providerModelId: '',
    remoteModelCatalogId: '',
    connectorGrantId: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfig(await loadTesterAIConfig(rendererHost.sdk.aiConfig));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause || 'App AIConfig load failed.'));
    } finally {
      setLoading(false);
    }
  }, [rendererHost]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const intent = findTesterCapabilityIntent(config, capabilityId);
  const intentKind = intent?.route.oneofKind ?? null;
  const cloudAvailable = capabilityId === 'image.generate';

  useEffect(() => {
    if (intent?.route.oneofKind !== 'cloud' || !('cloud' in intent.route)) return;
    const cloud = intent.route.cloud;
    const target = fromNimiRuntimeProtoStruct(cloud.providerModelTarget);
    setCloudDraft({
      implementationId: cloud.implementation?.implementationId ?? '',
      driverId: cloud.implementation?.driverId ?? '',
      driverDialect: cloud.implementation?.driverDialect ?? '',
      provider: stringField(target.provider),
      providerModelId: stringField(target.providerModelId) || stringField(target.model),
      remoteModelCatalogId: stringField(target.remoteModelCatalogId),
      connectorGrantId: cloud.connectorGrantId,
    });
  }, [intent]);
  const configStatus = loading ? 'Loading' : error ? 'Unavailable' : intentKind === 'local'
    ? 'Local selected'
    : intentKind === 'cloud' ? 'Cloud selected' : 'Not configured';

  async function selectLocal() {
    setSaving(true);
    setError(null);
    try {
      const next = await overwriteTesterCapabilityIntent(
        rendererHost.sdk.aiConfig,
        config,
        createTesterLocalCapabilityIntent(capabilityId, intent),
      );
      setConfig(next);
      onConfigChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause || 'App AIConfig update failed.'));
    } finally {
      setSaving(false);
    }
  }

  async function selectCloud() {
    setSaving(true);
    setError(null);
    try {
      const next = await overwriteTesterCapabilityIntent(
        rendererHost.sdk.aiConfig,
        config,
        createTesterCloudCapabilityIntent(capabilityId, intent, cloudDraft),
      );
      setConfig(next);
      onConfigChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause || 'App AIConfig update failed.'));
    } finally {
      setSaving(false);
    }
  }

  async function removeIntent() {
    setSaving(true);
    setError(null);
    try {
      const next = await removeTesterCapabilityIntent(
        rendererHost.sdk.aiConfig,
        config,
        capabilityId,
      );
      setConfig(next);
      onConfigChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause || 'App AIConfig update failed.'));
    } finally {
      setSaving(false);
    }
  }

  const runtimeLabel = runtime?.status === 'connected'
    ? 'Runtime connected'
    : runtime?.status === 'simulated'
      ? 'Simulator only'
      : 'Runtime unavailable';

  return (
    <section className="flex h-full min-h-0 flex-col bg-white/95" aria-label="App AI configuration">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--nimi-border-subtle)] px-5 py-4">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold text-[var(--nimi-text-primary)]">App AIConfig</h2>
          <p className="text-sm text-[var(--nimi-text-muted)]">{capabilityId}</p>
        </div>
        {onClose ? <Button type="button" tone="secondary" size="sm" onClick={onClose}>Close</Button> : null}
      </header>

      <div className="grid gap-5 overflow-y-auto p-5">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={runtime?.status === 'connected' ? 'neutral' : 'warning'} shape="dot">
            {runtimeLabel}
          </StatusBadge>
          <StatusBadge tone={!loading && !error && intentKind ? 'success' : 'warning'} shape="dot">
            {configStatus}
          </StatusBadge>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--nimi-text-muted)]">Reading the current Runtime-owned App AIConfig…</p>
        ) : error ? (
          <div className="grid gap-3 rounded-lg border border-[var(--nimi-border-subtle)] p-4">
            <strong className="text-sm text-[var(--nimi-text-primary)]">App AIConfig unavailable</strong>
            <p role="alert" className="text-sm text-[var(--nimi-status-danger-text)]">{error}</p>
            <Button type="button" tone="secondary" onClick={() => void refresh()}>Retry</Button>
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border border-[var(--nimi-border-subtle)] p-4">
            <strong className="text-sm text-[var(--nimi-text-primary)]">Capability intent</strong>
            <p className="text-sm text-[var(--nimi-text-muted)]">
              Selecting Local stores only consumer intent. Runtime chooses and validates the implementation when execution begins.
            </p>
            {intentKind === 'cloud' ? (
              <p className="text-sm text-[var(--nimi-text-muted)]">
                This capability currently has Cloud intent. Tester preserves it until you explicitly replace or remove it.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={saving || intentKind === 'local'} onClick={() => void selectLocal()}>
                {intentKind === 'local' ? 'Local selected' : 'Select Local'}
              </Button>
              {intent ? (
                <Button type="button" tone="secondary" disabled={saving} onClick={() => void removeIntent()}>
                  Remove capability intent
                </Button>
              ) : null}
            </div>
            {cloudAvailable ? (
              <fieldset className="mt-2 grid gap-3 border-t border-[var(--nimi-border-subtle)] pt-4" data-testid="tester-image-cloud-intent">
                <legend className="text-sm font-semibold text-[var(--nimi-text-primary)]">Cloud intent</legend>
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  Enter the exact Runtime catalog and ConnectorGrant facts. Tester does not choose or recommend a provider or model.
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {TESTER_CLOUD_INTENT_FIELDS.map(([field, label]) => (
                    <label key={field} className="grid gap-1 text-xs font-medium text-[var(--nimi-text-muted)]">
                      <span>{label}</span>
                      <TextField
                        value={cloudDraft[field]}
                        disabled={saving}
                        onChange={(event) => setCloudDraft((current) => ({
                          ...current,
                          [field]: event.currentTarget.value,
                        }))}
                      />
                    </label>
                  ))}
                </div>
                <Button type="button" disabled={saving} onClick={() => void selectCloud()}>
                  {intentKind === 'cloud' ? 'Save Cloud intent' : 'Select Cloud'}
                </Button>
              </fieldset>
            ) : null}
          </div>
        )}

        <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
          Runtime owns machine selection and returns the typed execution result when a request begins.
        </p>
      </div>
    </section>
  );
}

const TESTER_CLOUD_INTENT_FIELDS = [
  ['implementationId', 'Implementation ID'],
  ['driverId', 'Driver ID'],
  ['driverDialect', 'Driver dialect'],
  ['provider', 'Provider'],
  ['providerModelId', 'Provider model ID'],
  ['remoteModelCatalogId', 'Remote model catalog ID'],
  ['connectorGrantId', 'Connector grant ID'],
] as const satisfies readonly (readonly [keyof TesterCloudCapabilityIntentInput, string])[];

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
