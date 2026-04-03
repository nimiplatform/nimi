// RL-PIPE-006 — Product settings — renders inside DetailPanel
// Media/voice autonomy, visual comfort, proactive toggle

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import {
  useSettingsStore,
  type MediaAutonomy,
  type VoiceAutonomy,
  type VisualComfortLevel,
} from '../../../app-shell/providers/settings-store.js';
import { createBridgeRouteDataProvider } from '../../model-config/bridge-route-provider.js';
import { useRelayRoute } from '../../model-config/use-relay-route.js';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { MediaRouteSelector } from '../../model-config/media-route-selector.js';
import { TtsVoiceSelector } from '../../model-config/tts-voice-selector.js';
import {
  findRelayLocalImageProfile,
  RELAY_LOCAL_IMAGE_PROFILES,
  relayLocalImageProfileRequestedModel,
  type RelayLocalImageProfileEntry,
} from '../../../../shared/local-image-profiles.js';

// ---------------------------------------------------------------------------
// Model name formatting
// ---------------------------------------------------------------------------

function formatModelDisplayName(raw: string): string {
  const parts = raw.split('/');
  return parts.length > 1 ? parts[parts.length - 1]! : raw;
}

type LocalAssetOption = {
  localAssetId: string;
  assetId: string;
  assetKind: string;
  title: string;
  status: string;
};

// ---------------------------------------------------------------------------
// SettingsDrawer
// ---------------------------------------------------------------------------

export function SettingsDrawer() {
  const { t } = useTranslation();
  const { product, inspect, saveError, updateProduct, updateInspect } = useSettingsStore();

  const setMediaAutonomy = useCallback((v: MediaAutonomy) => updateProduct({ mediaAutonomy: v }), [updateProduct]);
  const setVoiceAutonomy = useCallback((v: VoiceAutonomy) => updateProduct({ voiceAutonomy: v }), [updateProduct]);
  const setVisualComfort = useCallback((v: VisualComfortLevel) => updateProduct({ visualComfortLevel: v }), [updateProduct]);

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
          <ImageModelSettings />
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

function ImageModelSettings() {
  const { t } = useTranslation();
  const { inspect, updateInspect } = useSettingsStore();
  const [localAssets, setLocalAssets] = useState<LocalAssetOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdvancedOverrides, setShowAdvancedOverrides] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getBridge().local.listAssets({
      statusFilter: 0,
      kindFilter: 0,
      engineFilter: '',
      pageSize: 0,
      pageToken: '',
    })
      .then((response) => {
        if (cancelled) return;
        setLocalAssets((response.assets || [])
          .map((asset) => ({
            localAssetId: String(asset.localAssetId || '').trim(),
            assetId: String(asset.assetId || '').trim(),
            assetKind: normalizeAssetKind(asset.kind),
            title: String(asset.logicalModelId || asset.assetId || asset.localAssetId || '').trim(),
            status: normalizeAssetStatus(asset.status),
          }))
          .filter((asset) => asset.localAssetId && asset.assetId && asset.assetKind && asset.status !== 'removed'));
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLocalAssets([]);
        setLoadError(error instanceof Error ? error.message : 'Failed to load local assets');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSource = inspect.imageRouteSource === 'local'
    ? 'local'
    : inspect.imageRouteSource === 'cloud'
      ? 'cloud'
      : inspect.selectedProfileId
        ? 'local'
        : 'cloud';
  const selectedProfileId = inspect.selectedProfileId || RELAY_LOCAL_IMAGE_PROFILES[0]?.id || '';
  const selectedProfile = findRelayLocalImageProfile(selectedProfileId);
  const selectedLocalModel = relayLocalImageProfileRequestedModel(selectedProfileId) || '';
  const overrideMap = useMemo(() => new Map(
    (inspect.profileEntryOverrides || []).map((item) => [item.entryId, item.localAssetId]),
  ), [inspect.profileEntryOverrides]);
  const dependencyEntries = useMemo(
    () => (selectedProfile?.entries || []).filter((entry) => entry.engineSlot),
    [selectedProfile],
  );

  const handleImageSourceChange = useCallback((value: string) => {
    if (value !== 'local' && value !== 'cloud') {
      return;
    }
    if (value === 'local') {
      const nextProfileId = inspect.selectedProfileId || RELAY_LOCAL_IMAGE_PROFILES[0]?.id || '';
      void updateInspect({
        imageRouteSource: value,
        selectedProfileId: nextProfileId,
        imageModel: relayLocalImageProfileRequestedModel(nextProfileId) || '',
      });
      return;
    }
    void updateInspect({ imageRouteSource: value });
  }, [inspect.selectedProfileId, updateInspect]);

  const handleProfileChange = useCallback((profileId: string) => {
    void updateInspect({
      imageRouteSource: 'local',
      selectedProfileId: profileId,
      imageModel: relayLocalImageProfileRequestedModel(profileId) || '',
      profileEntryOverrides: [],
    });
  }, [updateInspect]);

  const handleCloudRouteChange = useCallback((connectorId: string, model: string) => {
    void updateInspect({
      imageRouteSource: 'cloud',
      imageConnectorId: connectorId,
      imageModel: model,
    });
  }, [updateInspect]);

  const handleEntryOverrideChange = useCallback((entryId: string, localAssetId: string) => {
    const remaining = (inspect.profileEntryOverrides || []).filter((item) => item.entryId !== entryId);
    if (!localAssetId) {
      void updateInspect({ profileEntryOverrides: remaining });
      return;
    }
    void updateInspect({
      profileEntryOverrides: [...remaining, { entryId, localAssetId }],
    });
  }, [inspect.profileEntryOverrides, updateInspect]);

  return (
    <div className="space-y-3">
      <SelectField
        value={selectedSource}
        onValueChange={handleImageSourceChange}
        options={[
          { value: 'local', label: t('settings.localImageRoute', 'Local') },
          { value: 'cloud', label: t('settings.cloudImageRoute', 'Cloud') },
        ]}
        selectClassName="font-normal"
      />

      {loadError ? (
        <InlineNotice tone="warning">
          {loadError}
        </InlineNotice>
      ) : null}

      {selectedSource === 'local' ? (
        <div className="space-y-3">
          <SelectField
            value={selectedProfileId || undefined}
            onValueChange={handleProfileChange}
            options={RELAY_LOCAL_IMAGE_PROFILES.map((profile) => ({
              value: profile.id,
              label: profile.title,
            }))}
            placeholder={t('settings.selectLocalImageProfile', 'Select local image profile...')}
            selectClassName="font-normal"
          />

          {selectedProfile ? (
            <div className="space-y-1 rounded-xl border border-[color:var(--nimi-border-subtle)] px-3 py-2">
              <p className="text-[13px] text-[color:var(--nimi-text-primary)]">{selectedProfile.description}</p>
              <p className="text-[12px] text-[color:var(--nimi-text-muted)]">
                {t('settings.localImageProfileModel', 'Primary asset')}: {formatModelDisplayName(selectedLocalModel)}
              </p>
            </div>
          ) : null}

          <p className="text-[12px] text-[color:var(--nimi-text-muted)]">
            {t('settings.imageProfileHint', 'Dependency assets are resolved from the selected profile. Entry overrides are available in advanced mode only.')}
          </p>

          {dependencyEntries.length > 0 ? (
            <div className="space-y-3 rounded-xl border border-[color:var(--nimi-border-subtle)] px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-[13px] text-[color:var(--nimi-text-primary)]">
                    {t('settings.advancedDependencyOverrides', 'Advanced dependency overrides')}
                  </p>
                  <p className="text-[12px] text-[color:var(--nimi-text-muted)]">
                    {t('settings.advancedDependencyOverridesHint', 'Override dependency assets for individual profile entries.')}
                  </p>
                </div>
                <Toggle checked={showAdvancedOverrides} onChange={setShowAdvancedOverrides} />
              </div>

              {showAdvancedOverrides ? dependencyEntries.map((entry) => (
                <ProfileEntryOverrideField
                  key={entry.entryId}
                  entry={entry}
                  assets={localAssets}
                  selectedLocalAssetId={overrideMap.get(entry.entryId) || ''}
                  onChange={handleEntryOverrideChange}
                />
              )) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <MediaRouteSelector
          capability="image.generate"
          connectorId={inspect.imageConnectorId}
          model={inspect.imageModel}
          onChange={handleCloudRouteChange}
          label={t('settings.imageModel', 'Image Model')}
        />
      )}
    </div>
  );
}

function normalizeAssetStatus(value: unknown): string {
  if (typeof value === 'number') {
    switch (value) {
      case 1:
        return 'installed';
      case 2:
        return 'active';
      case 3:
        return 'unhealthy';
      case 4:
        return 'removed';
      default:
        return '';
    }
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    switch (normalized) {
      case '1':
      case 'installed':
      case 'local_asset_status_installed':
        return 'installed';
      case '2':
      case 'active':
      case 'local_asset_status_active':
        return 'active';
      case '3':
      case 'unhealthy':
      case 'local_asset_status_unhealthy':
        return 'unhealthy';
      case '4':
      case 'removed':
      case 'local_asset_status_removed':
        return 'removed';
      default:
        return normalized;
    }
  }
  return '';
}

function normalizeAssetKind(value: unknown): string {
  if (typeof value === 'number') {
    switch (value) {
      case 1:
        return 'chat';
      case 2:
        return 'image';
      case 3:
        return 'video';
      case 4:
        return 'tts';
      case 5:
        return 'stt';
      case 10:
        return 'vae';
      case 11:
        return 'clip';
      case 12:
        return 'lora';
      case 13:
        return 'controlnet';
      case 14:
        return 'auxiliary';
      default:
        return '';
    }
  }
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case '1':
    case 'chat':
    case 'local_asset_kind_chat':
      return 'chat';
    case '2':
    case 'image':
    case 'local_asset_kind_image':
      return 'image';
    case '3':
    case 'video':
    case 'local_asset_kind_video':
      return 'video';
    case '4':
    case 'tts':
    case 'local_asset_kind_tts':
      return 'tts';
    case '5':
    case 'stt':
    case 'local_asset_kind_stt':
      return 'stt';
    case '10':
    case 'vae':
    case 'local_asset_kind_vae':
      return 'vae';
    case '11':
    case 'clip':
    case 'local_asset_kind_clip':
      return 'clip';
    case '12':
    case 'lora':
    case 'local_asset_kind_lora':
      return 'lora';
    case '13':
    case 'controlnet':
    case 'local_asset_kind_controlnet':
      return 'controlnet';
    case '14':
    case 'auxiliary':
    case 'local_asset_kind_auxiliary':
      return 'auxiliary';
    default:
      return '';
  }
}

function assetMatchesEntry(asset: LocalAssetOption, entry: RelayLocalImageProfileEntry): boolean {
  return asset.assetKind === entry.assetKind;
}

const PROFILE_DEFAULT_SENTINEL = '__profile_default__';

function ProfileEntryOverrideField(props: {
  entry: RelayLocalImageProfileEntry;
  assets: LocalAssetOption[];
  selectedLocalAssetId: string;
  onChange: (entryId: string, localAssetId: string) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => [
    { value: PROFILE_DEFAULT_SENTINEL, label: t('settings.useProfileDefault', 'Use profile default') },
    ...props.assets
      .filter((asset) => assetMatchesEntry(asset, props.entry))
      .map((asset) => ({
        value: asset.localAssetId,
        label: `${asset.title} (${asset.assetId})`,
      })),
  ], [props.assets, props.entry, t]);

  return (
    <div className="space-y-2 rounded-xl border border-[color:var(--nimi-border-subtle)] px-3 py-3">
      <div className="space-y-1">
        <p className="text-[12px] font-semibold uppercase tracking-[0.15em] text-[color:var(--nimi-text-muted)]">
          {props.entry.title}
        </p>
        <p className="text-[12px] text-[color:var(--nimi-text-muted)]">
          {t('settings.profileEntryDefault', 'Default')}: {props.entry.assetId}
        </p>
      </div>
      <SelectField
        value={props.selectedLocalAssetId || PROFILE_DEFAULT_SENTINEL}
        onValueChange={(value) => props.onChange(props.entry.entryId, value === PROFILE_DEFAULT_SENTINEL ? '' : value)}
        options={options}
        selectClassName="font-normal"
      />
    </div>
  );
}
