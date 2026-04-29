import type { AudioSynthesizeParamsState } from '../types.js';
import type { SpeechVoiceReference } from '@nimiplatform/sdk/runtime';
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
  voiceRefLabel: string;
  voiceRefHint?: string;
  speakingRateLabel: string;
  volumeLabel: string;
  pitchSemitonesLabel: string;
  languageHintLabel: string;
  languageHintHint?: string;
  responseFormatLabel: string;
  timeoutLabel: string;
  defaultPlaceholder?: string;
};

export type AudioSynthesizeVoiceOption = {
  value: SpeechVoiceReference;
  label: string;
};

export type AudioSynthesizeParamsEditorProps = {
  params: AudioSynthesizeParamsState;
  onParamsChange: (next: AudioSynthesizeParamsState) => void;
  copy: AudioSynthesizeParamsEditorCopy;
  voiceOptions?: ReadonlyArray<AudioSynthesizeVoiceOption>;
};

const DEFAULT_VOICE_SENTINEL = '__default_voice__';

function voiceReferenceKey(value: SpeechVoiceReference | null): string {
  if (!value) return DEFAULT_VOICE_SENTINEL;
  switch (value.kind) {
    case 'preset_voice_id':
      return `preset:${value.presetVoiceId}`;
    case 'voice_asset_id':
      return `asset:${value.voiceAssetId}`;
    case 'provider_voice_ref':
      return `provider:${value.providerVoiceRef}`;
  }
  return '';
}

function voiceReferenceEquals(left: SpeechVoiceReference | null, right: SpeechVoiceReference | null): boolean {
  return voiceReferenceKey(left) === voiceReferenceKey(right);
}

function providerVoiceRefValue(value: SpeechVoiceReference | null): string {
  return value?.kind === 'provider_voice_ref' ? value.providerVoiceRef : '';
}

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
    voiceRefLabel: t('ModelConfig.editor.audioSynthesize.voiceRefLabel', { defaultValue: 'Voice reference' }),
    voiceRefHint: t('ModelConfig.editor.audioSynthesize.voiceRefHint', {
      defaultValue: 'Preset voice, custom voice asset, or provider voice reference.',
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

  const configuredVoiceOptions = props.voiceOptions || [];
  const voiceSelectOptions = configuredVoiceOptions.length > 0
    ? [
        { value: DEFAULT_VOICE_SENTINEL, label: copy.defaultPlaceholder || 'Default' },
        ...configuredVoiceOptions.map((option) => ({
          value: voiceReferenceKey(option.value),
          label: option.label,
        })),
        ...(params.voiceRef && !configuredVoiceOptions.some((option) => voiceReferenceEquals(option.value, params.voiceRef))
          ? [{ value: voiceReferenceKey(params.voiceRef), label: voiceReferenceKey(params.voiceRef) }]
          : []),
      ]
    : [];
  const voiceOptionsByKey = new Map(configuredVoiceOptions.map((option) => [voiceReferenceKey(option.value), option.value]));
  const voiceSectionLabel = copy.voiceSectionLabel ?? copy.parametersLabel;
  const audioTuningSectionLabel = copy.audioTuningSectionLabel ?? copy.parametersLabel;
  const outputSectionLabel = copy.outputSectionLabel ?? copy.parametersLabel;

  return (
    <div className="space-y-6">
      {/* VOICE — provider voice identifier and language hint live together at the
          top so users can pin the speaker before tuning prosody. */}
      <section className="space-y-3.5">
        <EditorSectionTitle label={voiceSectionLabel} />
        <StackedFieldRow label={copy.voiceRefLabel} hint={copy.voiceRefHint}>
          {voiceSelectOptions.length > 0 ? (
            <PlainSelect
              value={voiceReferenceKey(params.voiceRef)}
              onChange={(value) => updateParam('voiceRef', value === DEFAULT_VOICE_SENTINEL ? null : (voiceOptionsByKey.get(value) || params.voiceRef))}
              options={voiceSelectOptions}
            />
          ) : (
            <PlainTextInput
              value={providerVoiceRefValue(params.voiceRef)}
              onChange={(value) => updateParam('voiceRef', value.trim() ? { kind: 'provider_voice_ref', providerVoiceRef: value } : null)}
              placeholder={copy.defaultPlaceholder}
            />
          )}
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
