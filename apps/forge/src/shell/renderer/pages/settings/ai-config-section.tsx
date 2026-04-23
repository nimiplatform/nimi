/**
 * AI Configuration Section for Settings Page
 *
 * All capabilities (text.generate, image.generate, music.generate, tts.synthesize) use the
 * snapshot-driven provider backed by runtime.route.listOptions (FG-ROUTE-001/005).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import {
  createSnapshotRouteDataProvider,
  useRouteModelPickerData,
  type RouteModelPickerDataProvider,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker/headless';
import { RouteModelPickerPanel } from '@nimiplatform/nimi-kit/features/model-picker/ui';
import { Button, SettingsCard, SettingsSectionTitle, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  useAiConfigStore,
  type ForgeAiCapability,
} from '@renderer/state/ai-config-store.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORE_RUNTIME_MOD_ID = 'core:runtime';

type CapabilityEntry = {
  key: ForgeAiCapability;
  labelKey: string;
  fallback: string;
  runtimeCapability: string;
};

const CAPABILITIES: CapabilityEntry[] = [
  { key: 'text', labelKey: 'settings.aiText', fallback: 'Chat Model', runtimeCapability: 'text.generate' },
  { key: 'image', labelKey: 'settings.aiImage', fallback: 'Image Model', runtimeCapability: 'image.generate' },
  { key: 'music', labelKey: 'settings.aiMusic', fallback: 'Music Model', runtimeCapability: 'music.generate' },
  { key: 'tts', labelKey: 'settings.aiTts', fallback: 'TTS Model', runtimeCapability: 'tts.synthesize' },
];

// ---------------------------------------------------------------------------
// Snapshot-driven provider (FG-ROUTE-005)
// ---------------------------------------------------------------------------

function createCapabilitySnapshotProvider(capability: string): RouteModelPickerDataProvider | null {
  try {
    const modClient = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
    return createSnapshotRouteDataProvider(
      () => modClient.route.listOptions({
        capability: capability as Parameters<typeof modClient.route.listOptions>[0]['capability'],
      }),
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AiConfigSection (top-level)
// ---------------------------------------------------------------------------

export function AiConfigSection() {
  const { t } = useTranslation();
  const runtimeStatus = useAiConfigStore((s) => s.runtimeStatus);
  const error = useAiConfigStore((s) => s.error);
  const checkRuntimeStatus = useAiConfigStore((s) => s.checkRuntimeStatus);
  const resetToDefaults = useAiConfigStore((s) => s.resetToDefaults);

  useEffect(() => {
    void checkRuntimeStatus();
  }, [checkRuntimeStatus]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--nimi-text-secondary)]">
          {t('settings.aiConfig', 'AI Configuration')}
        </h2>
      </div>

      {/* Runtime status */}
      <Surface
        tone="card"
        material="glass-thin"
        elevation="base"
        className="flex items-center gap-2 px-4 py-2.5"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            runtimeStatus === 'connected'
              ? 'bg-[var(--nimi-status-success)]'
              : runtimeStatus === 'unavailable'
                ? 'bg-[var(--nimi-status-danger)]'
                : 'bg-[var(--nimi-text-muted)]'
          }`}
        />
        <span className="text-sm text-[color:var(--nimi-text-secondary)]">
          {t('settings.aiRuntime', 'Runtime')}:{' '}
          <span className={
            runtimeStatus === 'connected'
              ? 'text-[color:var(--nimi-status-success)]'
              : runtimeStatus === 'unavailable'
                ? 'text-[color:var(--nimi-status-danger)]'
                : 'text-[color:var(--nimi-text-muted)]'
          }>
            {runtimeStatus === 'connected'
              ? t('settings.aiConnected', 'Connected')
              : runtimeStatus === 'unavailable'
                ? t('settings.aiUnavailable', 'Unavailable')
                : t('settings.aiUnknown', 'Checking...')}
          </span>
        </span>
      </Surface>

      {error && (
        <SettingsCard className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] px-3 py-2 text-sm text-[var(--nimi-status-danger)]">
          {error}
        </SettingsCard>
      )}

      {/* Per-capability model panels */}
      {CAPABILITIES.map((cap) => (
        <SettingsCard key={cap.key} className="space-y-3 p-4">
          <SettingsSectionTitle>{t(cap.labelKey, cap.fallback)}</SettingsSectionTitle>
          <ForgeCapabilityModelPanel
            capability={cap.key}
            runtimeCapability={cap.runtimeCapability}
            disabled={runtimeStatus === 'unavailable'}
          />
        </SettingsCard>
      ))}

      {/* Reset */}
      <div className="pt-1">
        <Button tone="secondary" size="sm" onClick={resetToDefaults}>
          {t('settings.aiResetDefaults', 'Reset to Defaults')}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ForgeCapabilityModelPanel — all capabilities use snapshot-driven provider
// ---------------------------------------------------------------------------

function ForgeCapabilityModelPanel({
  capability,
  runtimeCapability,
  disabled,
}: {
  capability: ForgeAiCapability;
  runtimeCapability: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const setSelection = useAiConfigStore((s) => s.setSelection);

  const binding = useAiConfigStore((s) =>
    s.aiConfig.capabilities.selectedBindings[runtimeCapability],
  );

  const providerRef = useRef<RouteModelPickerDataProvider | null>(null);
  if (!providerRef.current) {
    providerRef.current = createCapabilitySnapshotProvider(runtimeCapability);
  }

  const initialSource: 'local' | 'cloud' =
    binding && typeof binding === 'object' ? binding.source : 'local';
  const initialConnectorId =
    binding && typeof binding === 'object' ? binding.connectorId || '' : '';
  const initialModel =
    binding && typeof binding === 'object' ? binding.model || '' : '';

  const labels = useMemo(() => ({
    source: t('settings.aiSource', 'Source'),
    local: t('settings.aiLocal', 'Local'),
    cloud: t('settings.aiCloud', 'Cloud'),
    connector: t('settings.aiConnector', 'Connector'),
    model: t('settings.aiModel', 'Model'),
    active: t('settings.aiActive', 'Active'),
    reset: t('settings.aiReset', 'Reset'),
    loading: t('settings.aiLoading', 'Loading models...'),
    unavailable: t('settings.aiUnavailable', 'Unavailable'),
    localUnavailable: t('settings.aiLocalUnavailable', 'Local model discovery failed. Runtime may be unavailable.'),
    noLocalModels: t('settings.aiNoLocalModels', 'No local models available for this capability. Install a model via Desktop.'),
    selectConnector: t('settings.aiSelectConnector', 'Select a connector to see available models.'),
    noCloudModels: t('settings.aiNoCloudModels', 'No models available for this connector.'),
    savedRouteUnavailable: t('settings.aiSavedRouteUnavailable', 'Saved route is no longer available.'),
  }), [t]);

  const handleSelectionChange = useMemo(() => (next: RouteModelPickerSelection) => {
    setSelection(capability, {
      source: next.source === 'cloud' ? 'cloud' : 'local',
      connectorId: next.connectorId,
      model: next.model,
      modelLabel: next.modelLabel,
    });
  }, [capability, setSelection]);

  const { panelProps } = useRouteModelPickerData({
    provider: providerRef.current!,
    capability: runtimeCapability,
    initialSelection: {
      source: initialSource,
      connectorId: initialConnectorId,
      model: initialModel,
    },
    onSelectionChange: handleSelectionChange,
    labels,
  });

  if (disabled || !providerRef.current) {
    return (
      <p className="text-sm text-[color:var(--nimi-text-secondary)]">
        {t('settings.aiRuntimeUnavailable', 'Runtime unavailable')}
      </p>
    );
  }

  return <RouteModelPickerPanel {...panelProps} />;
}
