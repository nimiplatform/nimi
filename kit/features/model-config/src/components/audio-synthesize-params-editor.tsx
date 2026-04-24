import type { AudioSynthesizeParamsState } from '../types.js';
import { AUDIO_SYNTHESIZE_RESPONSE_FORMAT_OPTIONS } from '../constants.js';
import { FieldInput, FieldRow, FieldSelect, SubSectionLabel } from './field-primitives.js';

export type AudioSynthesizeParamsEditorCopy = {
  parametersLabel: string;
  previewBadgeLabel?: string;
  voiceIdLabel: string;
  voiceIdHint?: string;
  speakingRateLabel: string;
  volumeLabel: string;
  pitchSemitonesLabel: string;
  languageHintLabel: string;
  responseFormatLabel: string;
  timeoutLabel: string;
  defaultPlaceholder?: string;
};

export type AudioSynthesizeParamsEditorProps = {
  params: AudioSynthesizeParamsState;
  onParamsChange: (next: AudioSynthesizeParamsState) => void;
  copy: AudioSynthesizeParamsEditorCopy;
};

export function createAudioSynthesizeEditorCopy(
  t: (key: string, vars?: Record<string, string | number>) => string,
): AudioSynthesizeParamsEditorCopy {
  return {
    parametersLabel: t('ModelConfig.editor.audioSynthesize.parametersLabel'),
    previewBadgeLabel: t('ModelConfig.editor.common.previewBadgeLabel'),
    voiceIdLabel: t('ModelConfig.editor.audioSynthesize.voiceIdLabel'),
    voiceIdHint: t('ModelConfig.editor.audioSynthesize.voiceIdHint'),
    speakingRateLabel: t('ModelConfig.editor.audioSynthesize.speakingRateLabel'),
    volumeLabel: t('ModelConfig.editor.audioSynthesize.volumeLabel'),
    pitchSemitonesLabel: t('ModelConfig.editor.audioSynthesize.pitchSemitonesLabel'),
    languageHintLabel: t('ModelConfig.editor.audioSynthesize.languageHintLabel'),
    responseFormatLabel: t('ModelConfig.editor.audioSynthesize.responseFormatLabel'),
    timeoutLabel: t('ModelConfig.editor.common.timeoutLabel'),
    defaultPlaceholder: t('ModelConfig.editor.common.defaultPlaceholder'),
  };
}

export function AudioSynthesizeParamsEditor(props: AudioSynthesizeParamsEditorProps) {
  const { copy, params } = props;

  const updateParam = <K extends keyof AudioSynthesizeParamsState>(
    key: K,
    value: AudioSynthesizeParamsState[K],
  ) => {
    props.onParamsChange({ ...params, [key]: value });
  };

  return (
    <div className="space-y-3">
      <SubSectionLabel label={copy.parametersLabel} previewLabel={copy.previewBadgeLabel} />

      <FieldRow label={copy.voiceIdLabel} tooltip={copy.voiceIdHint}>
        <FieldInput
          value={params.voiceId}
          onChange={(value) => updateParam('voiceId', value)}
          placeholder={copy.defaultPlaceholder}
        />
      </FieldRow>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.speakingRateLabel}>
          <FieldInput
            value={params.speakingRate}
            onChange={(value) => updateParam('speakingRate', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.volumeLabel}>
          <FieldInput
            value={params.volume}
            onChange={(value) => updateParam('volume', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.pitchSemitonesLabel}>
          <FieldInput
            value={params.pitchSemitones}
            onChange={(value) => updateParam('pitchSemitones', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.languageHintLabel}>
          <FieldInput
            value={params.languageHint}
            onChange={(value) => updateParam('languageHint', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.responseFormatLabel}>
          <FieldSelect
            value={params.responseFormat}
            onChange={(value) => updateParam('responseFormat', value)}
            options={AUDIO_SYNTHESIZE_RESPONSE_FORMAT_OPTIONS.map((item) => ({ value: item, label: item }))}
          />
        </FieldRow>
        <FieldRow label={copy.timeoutLabel}>
          <FieldInput
            value={params.timeoutMs}
            onChange={(value) => updateParam('timeoutMs', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>
    </div>
  );
}
