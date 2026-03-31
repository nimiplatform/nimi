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
  type ImageWorkflowComponent,
  type MediaAutonomy,
  type VoiceAutonomy,
  type VisualComfortLevel,
} from '../../../app-shell/providers/settings-store.js';
import type { NimiRelayBridge } from '../../../bridge/electron-bridge.js';
import { createBridgeRouteDataProvider } from '../../model-config/bridge-route-provider.js';
import { useRelayRoute } from '../../model-config/use-relay-route.js';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { MediaRouteSelector } from '../../model-config/media-route-selector.js';
import { TtsVoiceSelector } from '../../model-config/tts-voice-selector.js';
import type { RelayMediaRouteOptionsResponse } from '../../../../shared/ipc-contract.js';

// ---------------------------------------------------------------------------
// Model name formatting
// ---------------------------------------------------------------------------

function formatModelDisplayName(raw: string): string {
  const parts = raw.split('/');
  return parts.length > 1 ? parts[parts.length - 1]! : raw;
}

const IMAGE_WORKFLOW_SLOT_PRESETS = ['vae_path', 'llm_path', 'clip_path', 'controlnet_path', 'lora_path'] as const;
const IMAGE_ARTIFACT_KIND_LABEL: Record<number, string> = {
  1: 'VAE',
  2: 'LLM',
  3: 'CLIP',
  4: 'ControlNet',
  5: 'LoRA',
  6: 'Auxiliary',
};

type LocalArtifactRecord = Awaited<ReturnType<NimiRelayBridge['local']['listArtifacts']>>['artifacts'][number];
type LocalImageModelOption = RelayMediaRouteOptionsResponse['local']['models'][number];

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
  const [routeOptions, setRouteOptions] = useState<RelayMediaRouteOptionsResponse | null>(null);
  const [artifacts, setArtifacts] = useState<LocalArtifactRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profileOverridesText, setProfileOverridesText] = useState(() => JSON.stringify(inspect.imageProfileOverrides ?? {}, null, 2));
  const [profileOverridesError, setProfileOverridesError] = useState<string | null>(null);

  useEffect(() => {
    setProfileOverridesText(JSON.stringify(inspect.imageProfileOverrides ?? {}, null, 2));
  }, [inspect.imageProfileOverrides]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getBridge().mediaRoute.getOptions({ capability: 'image.generate' }),
      getBridge().local.listArtifacts({
        statusFilter: 0,
        kindFilter: 0,
        engineFilter: '',
        pageSize: 0,
        pageToken: '',
      }),
    ]).then(([mediaOptions, artifactResponse]) => {
      if (cancelled) return;
      setRouteOptions(mediaOptions);
      const nextArtifacts = Array.isArray(artifactResponse.artifacts)
        ? artifactResponse.artifacts.filter((artifact) => Number(artifact.status ?? 0) !== 4)
        : [];
      setArtifacts(nextArtifacts);
      setLoadError(null);
    }).catch((error) => {
      if (cancelled) return;
      setRouteOptions(null);
      setArtifacts([]);
      setLoadError(error instanceof Error ? error.message : 'Failed to load local image settings');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSource = inspect.imageRouteSource === 'local'
    ? 'local'
    : inspect.imageRouteSource === 'cloud'
      ? 'cloud'
      : inspect.imageLocalModelId
        ? 'local'
        : 'cloud';
  const localModels: LocalImageModelOption[] = routeOptions?.local.models ?? [];

  const handleImageSourceChange = useCallback((value: string) => {
    if (value !== 'local' && value !== 'cloud') {
      return;
    }
    void updateInspect({ imageRouteSource: value });
  }, [updateInspect]);

  const handleLocalModelChange = useCallback((localModelId: string) => {
    const selected = localModels.find((model: LocalImageModelOption) => model.localModelId === localModelId);
    void updateInspect({
      imageRouteSource: 'local',
      imageLocalModelId: localModelId,
      imageModel: selected?.modelId ?? '',
    });
  }, [localModels, updateInspect]);

  const handleCloudRouteChange = useCallback((connectorId: string, model: string) => {
    void updateInspect({
      imageRouteSource: 'cloud',
      imageConnectorId: connectorId,
      imageModel: model,
    });
  }, [updateInspect]);

  const handleWorkflowComponentChange = useCallback((index: number, patch: Partial<ImageWorkflowComponent>) => {
    const next = inspect.imageWorkflowComponents.map((component, currentIndex) => (
      currentIndex === index
        ? {
            slot: (patch.slot ?? component.slot).trim(),
            localArtifactId: (patch.localArtifactId ?? component.localArtifactId).trim(),
          }
        : component
    ));
    void updateInspect({ imageWorkflowComponents: next });
  }, [inspect.imageWorkflowComponents, updateInspect]);

  const handleAddWorkflowComponent = useCallback(() => {
    void updateInspect({
      imageWorkflowComponents: [
        ...inspect.imageWorkflowComponents,
        { slot: '', localArtifactId: '' },
      ],
    });
  }, [inspect.imageWorkflowComponents, updateInspect]);

  const handleRemoveWorkflowComponent = useCallback((index: number) => {
    void updateInspect({
      imageWorkflowComponents: inspect.imageWorkflowComponents.filter((_, currentIndex) => currentIndex !== index),
    });
  }, [inspect.imageWorkflowComponents, updateInspect]);

  const handleProfileOverridesBlur = useCallback(() => {
    const trimmed = profileOverridesText.trim();
    if (!trimmed || trimmed === '{}') {
      setProfileOverridesError(null);
      void updateInspect({ imageProfileOverrides: null });
      return;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Profile overrides must be a JSON object.');
      }
      setProfileOverridesError(null);
      void updateInspect({ imageProfileOverrides: parsed as Record<string, unknown> });
    } catch (error) {
      setProfileOverridesError(error instanceof Error ? error.message : 'Invalid JSON');
    }
  }, [profileOverridesText, updateInspect]);

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
            value={inspect.imageLocalModelId || undefined}
            onValueChange={handleLocalModelChange}
            options={localModels.map((model: LocalImageModelOption) => ({
              value: model.localModelId,
              label: `${formatModelDisplayName(model.modelId)} (${model.engine})`,
            }))}
            placeholder={t('settings.selectLocalImageModel', 'Select local image model...')}
            selectClassName="font-normal"
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.15em] text-[color:var(--nimi-text-muted)]">
                {t('settings.imageWorkflow', 'Workflow Components')}
              </p>
              <button
                type="button"
                onClick={handleAddWorkflowComponent}
                className="rounded-md border border-[color:var(--nimi-border-subtle)] px-2 py-1 text-[12px] text-[color:var(--nimi-text-secondary)] transition-colors hover:border-[color:var(--nimi-text-muted)] hover:text-[color:var(--nimi-text-primary)]"
              >
                {t('settings.addComponent', 'Add')}
              </button>
            </div>

            {inspect.imageWorkflowComponents.length === 0 ? (
              <p className="text-[12px] text-[color:var(--nimi-text-muted)]">
                {t('settings.imageWorkflowHint', 'Select companion artifacts explicitly. Local image generation fails closed without them.')}
              </p>
            ) : null}

            {inspect.imageWorkflowComponents.map((component, index) => (
              <div key={`${component.slot}:${component.localArtifactId}:${index}`} className="rounded-xl border border-[color:var(--nimi-border-subtle)] p-3">
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                  <input
                    value={component.slot}
                    onChange={(event) => handleWorkflowComponentChange(index, { slot: event.target.value })}
                    list={`image-workflow-slot-${index}`}
                    placeholder={t('settings.imageWorkflowSlot', 'slot')}
                    className="h-10 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-transparent px-3 text-[13px] text-[color:var(--nimi-text-primary)] outline-none transition-colors focus:border-[color:var(--nimi-action-primary-bg)]"
                  />
                  <datalist id={`image-workflow-slot-${index}`}>
                    {IMAGE_WORKFLOW_SLOT_PRESETS.map((slot) => <option key={slot} value={slot} />)}
                  </datalist>
                  <SelectField
                    value={component.localArtifactId || undefined}
                    onValueChange={(value) => handleWorkflowComponentChange(index, { localArtifactId: value })}
                    options={artifacts.map((artifact) => ({
                      value: String(artifact.localArtifactId || ''),
                      label: formatArtifactOptionLabel(artifact),
                    })).filter((option) => option.value)}
                    placeholder={t('settings.selectArtifact', 'Select artifact...')}
                    selectClassName="font-normal"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveWorkflowComponent(index)}
                    className="rounded-lg border border-[color:var(--nimi-border-subtle)] px-3 py-2 text-[12px] text-[color:var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-status-danger)] hover:text-[var(--nimi-status-danger)]"
                  >
                    {t('settings.removeComponent', 'Remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.15em] text-[color:var(--nimi-text-muted)]">
              {t('settings.profileOverrides', 'Profile Overrides')}
            </p>
            <textarea
              value={profileOverridesText}
              onChange={(event) => setProfileOverridesText(event.target.value)}
              onBlur={handleProfileOverridesBlur}
              rows={6}
              spellCheck={false}
              className="w-full resize-y rounded-xl border border-[color:var(--nimi-border-subtle)] bg-transparent px-3 py-2 text-[12px] leading-relaxed text-[color:var(--nimi-text-primary)] outline-none transition-colors focus:border-[color:var(--nimi-action-primary-bg)]"
            />
            {profileOverridesError ? (
              <InlineNotice tone="warning">
                {profileOverridesError}
              </InlineNotice>
            ) : (
              <p className="text-[12px] text-[color:var(--nimi-text-muted)]">
                {t('settings.profileOverridesHint', 'Optional JSON object merged into the local image workflow profile.')}
              </p>
            )}
          </div>
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

function formatArtifactOptionLabel(artifact: LocalArtifactRecord): string {
  const artifactId = String(artifact.artifactId || artifact.localArtifactId || '').trim();
  const kind = IMAGE_ARTIFACT_KIND_LABEL[Number(artifact.kind ?? 0)] || `Kind ${String(artifact.kind ?? '')}`;
  const engine = String(artifact.engine || '').trim();
  if (artifactId && engine) {
    return `${artifactId} (${kind}, ${engine})`;
  }
  if (artifactId) {
    return `${artifactId} (${kind})`;
  }
  return kind;
}
