// RL-PIPE-006 — Product settings — renders inside DetailPanel
// Media/voice autonomy, visual comfort, proactive toggle

import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ScrollArea,
  SelectField,
  Toggle,
} from '@nimiplatform/nimi-kit/ui';
import {
  useRouteModelPickerData,
  type RouteModelPickerDataProvider,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker/headless';
import { CompactRouteModelPicker } from '@nimiplatform/nimi-kit/features/model-picker/ui';
import { useSettingsStore, type MediaAutonomy, type VoiceAutonomy, type VisualComfortLevel } from '../../../app-shell/providers/settings-store.js';
import { createBridgeRouteDataProvider } from '../../model-config/bridge-route-provider.js';
import { useRelayRoute } from '../../model-config/use-relay-route.js';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { MediaRouteSelector } from '../../model-config/media-route-selector.js';
import { TtsVoiceSelector } from '../../model-config/tts-voice-selector.js';

// ---------------------------------------------------------------------------
// Model name formatting
// ---------------------------------------------------------------------------

function formatModelDisplayName(raw: string): string {
  const parts = raw.split('/');
  return parts.length > 1 ? parts[parts.length - 1]! : raw;
}

// ---------------------------------------------------------------------------
// SettingsDrawer
// ---------------------------------------------------------------------------

export function SettingsDrawer() {
  const { t } = useTranslation();
  const { product, inspect, saveError, updateProduct, updateInspect } = useSettingsStore();

  const setMediaAutonomy = useCallback((v: MediaAutonomy) => updateProduct({ mediaAutonomy: v }), [updateProduct]);
  const setVoiceAutonomy = useCallback((v: VoiceAutonomy) => updateProduct({ voiceAutonomy: v }), [updateProduct]);
  const setVisualComfort = useCallback((v: VisualComfortLevel) => updateProduct({ visualComfortLevel: v }), [updateProduct]);

  const onImageRouteChange = useCallback(
    (connectorId: string, model: string) => updateInspect({ imageConnectorId: connectorId, imageModel: model }),
    [updateInspect],
  );
  const onTtsRouteChange = useCallback(
    (connectorId: string, model: string) => updateInspect({ ttsConnectorId: connectorId, ttsModel: model, ttsVoiceId: '' }),
    [updateInspect],
  );
  const onTtsVoiceChange = useCallback(
    (voiceId: string) => updateInspect({ ttsVoiceId: voiceId }),
    [updateInspect],
  );
  const onSttRouteChange = useCallback(
    (connectorId: string, model: string) => updateInspect({ sttConnectorId: connectorId, sttModel: model }),
    [updateInspect],
  );

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-5 px-4 py-4">
        {saveError && (
          <InlineNotice tone="danger">
            {t('settings.saveFailed', 'Failed to save settings.')}: {saveError}
          </InlineNotice>
        )}

        {/* Model — compact popover picker */}
        <SettingSection title={t('route.title', 'Model')}>
          <SettingsModelPicker />
        </SettingSection>

        {/* Media models */}
        <SettingSection title={t('settings.imageModel', 'Image Model')}>
          <MediaRouteSelector
            capability="image.generate"
            connectorId={inspect.imageConnectorId}
            model={inspect.imageModel}
            onChange={onImageRouteChange}
            label={t('settings.imageModel', 'Image Model')}
          />
        </SettingSection>

        <SettingSection title={t('settings.ttsModel', 'Voice Model (TTS)')}>
          <MediaRouteSelector
            capability="audio.synthesize"
            connectorId={inspect.ttsConnectorId}
            model={inspect.ttsModel}
            onChange={onTtsRouteChange}
            label={t('settings.ttsModel', 'Voice Model (TTS)')}
          />
          <TtsVoiceSelector
            connectorId={inspect.ttsConnectorId}
            model={inspect.ttsModel}
            voiceId={inspect.ttsVoiceId}
            onChange={onTtsVoiceChange}
          />
        </SettingSection>

        <SettingSection title={t('settings.sttModel', 'Speech Recognition (STT)')}>
          <MediaRouteSelector
            capability="audio.transcribe"
            connectorId={inspect.sttConnectorId}
            model={inspect.sttModel}
            onChange={onSttRouteChange}
            label={t('settings.sttModel', 'Speech Recognition (STT)')}
          />
        </SettingSection>

        {/* Behavior settings */}
        <SettingSection title={t('settings.mediaAutonomy', 'Media Autonomy')}>
          <EnumSelect
            value={product.mediaAutonomy}
            options={[
              { value: 'off', label: t('settings.off', 'Off') },
              { value: 'explicit-only', label: t('settings.explicitOnly', 'Explicit') },
              { value: 'natural', label: t('settings.natural', 'Natural') },
            ]}
            onChange={setMediaAutonomy}
          />
        </SettingSection>

        <SettingSection title={t('settings.voiceAutonomy', 'Voice Autonomy')}>
          <EnumSelect
            value={product.voiceAutonomy}
            options={[
              { value: 'off', label: t('settings.off', 'Off') },
              { value: 'explicit-only', label: t('settings.explicitOnly', 'Explicit') },
              { value: 'natural', label: t('settings.natural', 'Natural') },
            ]}
            onChange={setVoiceAutonomy}
          />
        </SettingSection>

        <SettingSection title={t('settings.visualComfort', 'Visual Comfort')}>
          <EnumSelect
            value={product.visualComfortLevel}
            options={[
              { value: 'text-only', label: t('settings.textOnly', 'Text Only') },
              { value: 'restrained-visuals', label: t('settings.restrained', 'Restrained') },
              { value: 'natural-visuals', label: t('settings.naturalVisuals', 'Natural') },
            ]}
            onChange={setVisualComfort}
          />
        </SettingSection>

        <SettingSection title={t('settings.proactiveContact', 'Proactive Contact')}>
          <BooleanSetting
            label={t('settings.proactiveContact', 'Proactive Contact')}
            checked={product.allowProactiveContact}
            onChange={(v) => updateProduct({ allowProactiveContact: v })}
          />
        </SettingSection>

        <SettingSection title={t('settings.autoPlayVoice', 'Auto-play Voice')}>
          <BooleanSetting
            label={t('settings.autoPlayVoice', 'Auto-play Voice')}
            checked={product.autoPlayVoiceReplies}
            onChange={(v) => updateProduct({ autoPlayVoiceReplies: v })}
          />
        </SettingSection>
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// SettingsModelPicker — compact model picker for sidebar
// ---------------------------------------------------------------------------

function SettingsModelPicker() {
  const { t } = useTranslation();
  const {
    binding,
    snapshot,
    display,
    options,
    loading: routeLoading,
  } = useRelayRoute();

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

    return { source, connectorId: '', model: selectedLocalModelId };
  }, [binding, display, options?.local.models, snapshot]);

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
    localUnavailable: t('route.localLoadFailed', 'Local model discovery failed.'),
    noLocalModels: t('route.noLocalModels', 'No local models available.'),
    selectConnector: t('route.selectConnector', 'Select a connector.'),
    noCloudModels: t('route.noCloudModels', 'No models available.'),
    savedRouteUnavailable: t('route.fallbackWarning', 'Saved route unavailable.'),
  }), [t]);

  const {
    selection,
    connectors,
    loading,
    pickerState,
    changeSource,
    changeConnector,
  } = useRouteModelPickerData({
    provider,
    capability: 'text.generate',
    initialSelection,
    onSelectionChange: handleSelectionChange,
    labels,
  });

  if (routeLoading || loading) {
    return <p className="text-[13px] text-text-secondary">{labels.loading}</p>;
  }

  const hasConnectors = connectors.length > 0;
  const connectorOptions = connectors.map((c) => ({
    value: c.connectorId,
    label: `${c.label} (${c.provider})`,
  }));

  const selectedTitle = pickerState.selectedModel
    ? formatModelDisplayName(pickerState.adapter.getTitle(pickerState.selectedModel))
    : undefined;

  return (
    <CompactRouteModelPicker
      state={pickerState}
      triggerLabel={selectedTitle}
      triggerClassName="max-w-full text-[13px]"
      sourceValue={selection.source}
      sourceOptions={[
        { value: 'local' as const, label: labels.local },
        { value: 'cloud' as const, label: labels.cloud, disabled: !hasConnectors },
      ]}
      onSourceChange={changeSource}
      showConnector={selection.source === 'cloud' && hasConnectors}
      connectorValue={selection.connectorId}
      connectorOptions={connectorOptions}
      onConnectorChange={changeConnector}
      loading={loading}
      loadingMessage={labels.loading}
      emptyMessage={selection.source === 'local' ? labels.noLocalModels : labels.noCloudModels}
      side="bottom"
      align="start"
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SettingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.15em] text-[color:var(--nimi-text-muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function EnumSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <SelectField
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as T)}
      options={options}
      selectClassName="font-normal"
    />
  );
}

function BooleanSetting({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[13px] text-[color:var(--nimi-text-primary)]">{label}</p>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function InlineNotice({ children, tone }: { children: ReactNode; tone: 'danger' | 'warning' }) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 text-[13px] ${
        tone === 'danger'
          ? 'border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,transparent)] text-[var(--nimi-status-danger)]'
          : 'border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] text-[var(--nimi-status-warning)]'
      }`}
    >
      {children}
    </div>
  );
}
