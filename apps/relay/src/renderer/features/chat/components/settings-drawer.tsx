// RL-PIPE-006 — Product settings drawer
// Media/voice autonomy, visual comfort, proactive toggle

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, type MediaAutonomy, type VoiceAutonomy, type VisualComfortLevel } from '../../../app-shell/providers/settings-store.js';
import { ChatRoutePanel } from '../../model-config/chat-route-panel.js';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { t } = useTranslation();
  const { product, updateProduct } = useSettingsStore();

  const setMediaAutonomy = useCallback((v: MediaAutonomy) => updateProduct({ mediaAutonomy: v }), [updateProduct]);
  const setVoiceAutonomy = useCallback((v: VoiceAutonomy) => updateProduct({ voiceAutonomy: v }), [updateProduct]);
  const setVisualComfort = useCallback((v: VisualComfortLevel) => updateProduct({ visualComfortLevel: v }), [updateProduct]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-80 bg-gray-900 border-l border-gray-800 z-50 overflow-y-auto">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('settings.title', 'Settings')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">&times;</button>
        </div>

        <div className="p-4 space-y-6">
          {/* Model Selection */}
          <SettingGroup label={t('route.title', 'Model')}>
            <ChatRoutePanel />
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
      </div>
    </>
  );
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">{label}</label>
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
    <div className="flex rounded-lg overflow-hidden border border-gray-700">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
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
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}
