// RL-PIPE-006 — Product settings — renders inside DetailPanel
// Media/voice autonomy, visual comfort, proactive toggle

import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SelectField,
  SettingsCard,
  SettingsPageShell,
  SettingsSectionTitle,
  Toggle,
} from '@nimiplatform/nimi-kit/ui';
import { useSettingsStore, type MediaAutonomy, type VoiceAutonomy, type VisualComfortLevel } from '../../../app-shell/providers/settings-store.js';
import { ChatRoutePanel } from '../../model-config/chat-route-panel.js';
import { MediaRouteSelector } from '../../model-config/media-route-selector.js';
import { TtsVoiceSelector } from '../../model-config/tts-voice-selector.js';

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
    <SettingsPageShell
      scrollClassName="bg-transparent"
      viewportClassName="bg-transparent"
      contentClassName="space-y-4 px-4 py-4"
    >
      {saveError && (
        <InlineNotice tone="danger">
          {t('settings.saveFailed', 'Failed to save settings.')}: {saveError}
        </InlineNotice>
      )}

      <SettingSection title={t('route.title', 'Model')}>
        <ChatRoutePanel />
      </SettingSection>

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
    </SettingsPageShell>
  );
}

function SettingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SettingsCard className="space-y-3 p-4">
      <SettingsSectionTitle>{title}</SettingsSectionTitle>
      {children}
    </SettingsCard>
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
      <p className="text-sm text-[color:var(--nimi-text-primary)]">{label}</p>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function InlineNotice({ children, tone }: { children: ReactNode; tone: 'danger' | 'warning' }) {
  return (
    <SettingsCard
      className={`rounded-2xl border px-3 py-2 text-sm ${
        tone === 'danger'
          ? 'border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]'
          : 'border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]'
      }`}
    >
      {children}
    </SettingsCard>
  );
}
