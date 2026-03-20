// TtsVoiceSelector — voice picker for TTS model in settings drawer
// Loads available voices via listVoices IPC when model/connector changes

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getBridge } from '../../bridge/electron-bridge.js';

interface VoiceOption {
  voiceId: string;
  name: string;
}

interface TtsVoiceSelectorProps {
  connectorId: string;
  model: string;
  voiceId: string;
  onChange: (voiceId: string) => void;
}

export function TtsVoiceSelector({
  connectorId,
  model,
  voiceId,
  onChange,
}: TtsVoiceSelectorProps) {
  const { t } = useTranslation();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!model || !connectorId) {
      setVoices([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getBridge()
      .media.tts.listVoices({ model, connectorId } as Parameters<ReturnType<typeof getBridge>['media']['tts']['listVoices']>[0])
      .then((result) => {
        if (cancelled) return;
        const mapped = (result.voices ?? []).map((v) => ({
          voiceId: v.voiceId,
          name: v.name || v.voiceId,
        }));
        setVoices(mapped);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setVoices([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [model, connectorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (newVoiceId: string) => {
      onChange(newVoiceId);
    },
    [onChange],
  );

  if (!model || !connectorId) return null;

  if (loading) {
    return (
      <div className="text-[12px] text-text-secondary">
        {t('ttsVoice.loading', 'Loading voices...')}
      </div>
    );
  }

  if (voices.length === 0) return null;

  return (
    <select
      value={voiceId}
      onChange={(e) => handleChange(e.target.value)}
      className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-3 py-1.5 text-[12px] text-text-primary focus:outline-none focus:border-accent"
    >
      {!voiceId && (
        <option value="">{t('ttsVoice.select', 'Select a voice...')}</option>
      )}
      {voices.map((v) => (
        <option key={v.voiceId} value={v.voiceId}>
          {v.name}
        </option>
      ))}
    </select>
  );
}
