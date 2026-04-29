import type { AudioSynthesizeParamsState } from '../types.js';
import { AUDIO_SYNTHESIZE_RESPONSE_FORMAT_OPTIONS } from '../constants.js';
import {
  EditorSectionTitle,
  InlineFieldRow,
  PlainNumberInput,
  PlainSelect,
  PlainTextInput,
  SliderRow,
  StackedFieldRow,
} from './editor-shared.js';

export type AudioSynthesizeParamsEditorCopy = {
  parametersLabel: string;
  previewBadgeLabel?: string;
  voiceSectionLabel?: string;
  audioTuningSectionLabel?: string;
  outputSectionLabel?: string;
  voiceIdLabel: string;
  voiceIdHint?: string;
  speakingRateLabel: string;
  volumeLabel: string;
  pitchSemitonesLabel: string;
  languageHintLabel: string;
  languageHintHint?: string;
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
    parametersLabel: t('ModelConfig.editor.audioSynthesize.parametersLabel', { defaultValue: 'Parameters' }),
    previewBadgeLabel: t('ModelConfig.editor.common.previewBadgeLabel', { defaultValue: 'Preview' }),
    voiceSectionLabel: t('ModelConfig.editor.audioSynthesize.voiceSectionLabel', { defaultValue: 'Voice' }),
    audioTuningSectionLabel: t('ModelConfig.editor.audioSynthesize.audioTuningSectionLabel', {
      defaultValue: 'Audio Tuning',
    }),
    outputSectionLabel: t('ModelConfig.editor.audioSynthesize.outputSectionLabel', { defaultValue: 'Output' }),
    voiceIdLabel: t('ModelConfig.editor.audioSynthesize.voiceIdLabel', { defaultValue: 'Voice ID' }),
    voiceIdHint: t('ModelConfig.editor.audioSynthesize.voiceIdHint', {
      defaultValue: 'Provider-specific voice identifier.',
    }),
    speakingRateLabel: t('ModelConfig.editor.audioSynthesize.speakingRateLabel', { defaultValue: 'Speaking rate' }),
    volumeLabel: t('ModelConfig.editor.audioSynthesize.volumeLabel', { defaultValue: 'Volume' }),
    pitchSemitonesLabel: t('ModelConfig.editor.audioSynthesize.pitchSemitonesLabel', {
      defaultValue: 'Pitch (semitones)',
    }),
    languageHintLabel: t('ModelConfig.editor.audioSynthesize.languageHintLabel', { defaultValue: 'Language hint' }),
    languageHintHint: t('ModelConfig.editor.audioSynthesize.languageHintHint', {
      defaultValue: 'BCP-47 tag, e.g. en-US.',
    }),
    responseFormatLabel: t('ModelConfig.editor.audioSynthesize.responseFormatLabel', {
      defaultValue: 'Response format',
    }),
    timeoutLabel: t('ModelConfig.editor.common.timeoutLabel', { defaultValue: 'Timeout (ms)' }),
    defaultPlaceholder: t('ModelConfig.editor.common.defaultPlaceholder', { defaultValue: 'Default' }),
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

  const voiceSectionLabel = copy.voiceSectionLabel ?? copy.parametersLabel;
  const audioTuningSectionLabel = copy.audioTuningSectionLabel ?? copy.parametersLabel;
  const outputSectionLabel = copy.outputSectionLabel ?? copy.parametersLabel;

  return (
    <div className="space-y-6">
      {/* VOICE — provider voice identifier and language hint live together at the
          top so users can pin the speaker before tuning prosody. */}
      <section className="space-y-3.5">
        <EditorSectionTitle label={voiceSectionLabel} />
        <StackedFieldRow label={copy.voiceIdLabel} hint={copy.voiceIdHint}>
          <PlainTextInput
            value={params.voiceId}
            onChange={(value) => updateParam('voiceId', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </StackedFieldRow>
        <StackedFieldRow label={copy.languageHintLabel} hint={copy.languageHintHint}>
          <PlainTextInput
            value={params.languageHint}
            onChange={(value) => updateParam('languageHint', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </StackedFieldRow>
      </section>

      {/* AUDIO TUNING — sliders for the three prosody knobs so users can drag-to-set
          (mirrors Temperature / MaxTokens treatment in the chat editor). */}
      <section className="space-y-3.5">
        <EditorSectionTitle label={audioTuningSectionLabel} />
        <SliderRow
          label={copy.speakingRateLabel}
          value={params.speakingRate}
          defaultValue={1}
          min={0.5}
          max={2}
          step={0.05}
          onChange={(value) => updateParam('speakingRate', value)}
        />
        <SliderRow
          label={copy.volumeLabel}
          value={params.volume}
          defaultValue={1}
          min={0}
          max={2}
          step={0.05}
          onChange={(value) => updateParam('volume', value)}
        />
        <SliderRow
          label={copy.pitchSemitonesLabel}
          value={params.pitchSemitones}
          defaultValue={0}
          min={-12}
          max={12}
          step={1}
          inputMode="numeric"
          onChange={(value) => updateParam('pitchSemitones', value)}
        />
      </section>

      {/* OUTPUT — encode format + timeout, both single-line scalars rendered
          inline (matches the chat editor's Timeout row). */}
      <section className="space-y-3.5">
        <EditorSectionTitle label={outputSectionLabel} />
        <InlineFieldRow label={copy.responseFormatLabel} controlWidthClass="w-40">
          <PlainSelect
            value={params.responseFormat}
            onChange={(value) => updateParam('responseFormat', value)}
            options={AUDIO_SYNTHESIZE_RESPONSE_FORMAT_OPTIONS.map((item) => ({ value: item, label: item }))}
          />
        </InlineFieldRow>
        <InlineFieldRow label={copy.timeoutLabel}>
          <PlainNumberInput
            value={params.timeoutMs}
            onChange={(value) => updateParam('timeoutMs', value)}
            placeholder="120000"
            inputMode="numeric"
          />
        </InlineFieldRow>
      </section>
    </div>
  );
}
