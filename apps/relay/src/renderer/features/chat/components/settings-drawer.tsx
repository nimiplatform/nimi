// RL-PIPE-006 — Product settings — renders inside DetailPanel
// Media/voice autonomy, visual comfort, proactive toggle

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
    <div className="space-y-6">
      {saveError && (
        <div className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">
          {t('settings.saveFailed', 'Failed to save settings.')}: {saveError}
        </div>
      )}

      {/* Model Selection */}
      <SettingGroup label={t('route.title', 'Model')}>
        <ChatRoutePanel />
      </SettingGroup>

      {/* Image Model */}
      <SettingGroup label={t('settings.imageModel', 'Image Model')}>
        <MediaRouteSelector
          capability="image.generate"
          connectorId={inspect.imageConnectorId}
          model={inspect.imageModel}
          onChange={onImageRouteChange}
          label={t('settings.imageModel', 'Image Model')}
        />
      </SettingGroup>

      {/* Voice Model (TTS) */}
      <SettingGroup label={t('settings.ttsModel', 'Voice Model (TTS)')}>
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
      </SettingGroup>

      {/* Speech Recognition (STT) */}
      <SettingGroup label={t('settings.sttModel', 'Speech Recognition (STT)')}>
        <MediaRouteSelector
          capability="audio.transcribe"
          connectorId={inspect.sttConnectorId}
          model={inspect.sttModel}
          onChange={onSttRouteChange}
          label={t('settings.sttModel', 'Speech Recognition (STT)')}
        />
      </SettingGroup>

      {/* Media Autonomy */}
      <SettingGroup label={t('settings.mediaAutonomy', 'Media Autonomy')}>
        <TriSelect
          value={product.mediaAutonomy}
          options={[
            { value: 'off', label: t('settings.off', 'Off') },
            { value: 'explicit-only', label: t('settings.explicitOnly', 'Explicit') },
            { value: 'natural', label: t('settings.natural', 'Natural') },
          ]}
          onChange={setMediaAutonomy}
        />
      </SettingGroup>

      {/* Voice Autonomy */}
      <SettingGroup label={t('settings.voiceAutonomy', 'Voice Autonomy')}>
        <TriSelect
          value={product.voiceAutonomy}
          options={[
            { value: 'off', label: t('settings.off', 'Off') },
            { value: 'explicit-only', label: t('settings.explicitOnly', 'Explicit') },
            { value: 'natural', label: t('settings.natural', 'Natural') },
          ]}
          onChange={setVoiceAutonomy}
        />
      </SettingGroup>

      {/* Visual Comfort */}
      <SettingGroup label={t('settings.visualComfort', 'Visual Comfort')}>
        <TriSelect
          value={product.visualComfortLevel}
          options={[
            { value: 'text-only', label: t('settings.textOnly', 'Text Only') },
            { value: 'restrained-visuals', label: t('settings.restrained', 'Restrained') },
            { value: 'natural-visuals', label: t('settings.naturalVisuals', 'Natural') },
          ]}
          onChange={setVisualComfort}
        />
      </SettingGroup>

      {/* Proactive Contact */}
      <SettingGroup label={t('settings.proactiveContact', 'Proactive Contact')}>
        <Toggle
          checked={product.allowProactiveContact}
          onChange={(v) => updateProduct({ allowProactiveContact: v })}
        />
      </SettingGroup>

      {/* Auto-play Voice */}
      <SettingGroup label={t('settings.autoPlayVoice', 'Auto-play Voice')}>
        <Toggle
          checked={product.autoPlayVoiceReplies}
          onChange={(v) => updateProduct({ autoPlayVoiceReplies: v })}
        />
      </SettingGroup>
    </div>
  );
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] text-text-secondary uppercase tracking-wider mb-2 block font-medium">{label}</label>
      {children}
    </div>
  );
}

function TriSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl overflow-hidden border border-border-subtle">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-2 text-[12px] font-medium transition-colors duration-150 ${
            value === opt.value
              ? 'bg-accent text-white'
              : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors duration-150 ${
        checked ? 'bg-accent' : 'bg-bg-elevated border border-border-subtle'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-150 ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}
