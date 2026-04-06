// TtsVoiceSelector — voice picker for TTS model in settings drawer
// Loads available voices via listVoices IPC when model/connector changes

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@nimiplatform/nimi-kit/ui';
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
      <div className="text-sm text-[color:var(--nimi-text-secondary)]">
        {t('ttsVoice.loading', 'Loading voices...')}
      </div>
    );
  }

  if (voices.length === 0) return null;

  return (
    <label className="flex min-h-11 flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">
        {t('ttsVoice.label', 'Voice')}
      </p>
      <SelectField
        value={voiceId || undefined}
        onValueChange={handleChange}
        options={voices.map((voice) => ({
          value: voice.voiceId,
          label: voice.name,
        }))}
        placeholder={t('ttsVoice.select', 'Select a voice...')}
        selectClassName="font-normal"
      />
    </label>
  );
}
