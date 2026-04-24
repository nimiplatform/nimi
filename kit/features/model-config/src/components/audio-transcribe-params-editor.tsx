import type { AudioTranscribeParamsState } from '../types.js';
import { AUDIO_TRANSCRIBE_RESPONSE_FORMAT_OPTIONS } from '../constants.js';
import { FieldInput, FieldRow, FieldSelect, FieldTextarea, FieldToggle, SubSectionLabel } from './field-primitives.js';

export type AudioTranscribeParamsEditorCopy = {
  parametersLabel: string;
  previewBadgeLabel?: string;
  languageLabel: string;
  languageHint?: string;
  responseFormatLabel: string;
  timeoutLabel: string;
  speakerCountLabel: string;
  promptLabel: string;
  timestampsLabel: string;
  diarizationLabel: string;
  defaultPlaceholder?: string;
  promptPlaceholder?: string;
};

export type AudioTranscribeParamsEditorProps = {
  params: AudioTranscribeParamsState;
  onParamsChange: (next: AudioTranscribeParamsState) => void;
  copy: AudioTranscribeParamsEditorCopy;
};

export function createAudioTranscribeEditorCopy(
  t: (key: string, vars?: Record<string, string | number>) => string,
): AudioTranscribeParamsEditorCopy {
  return {
    parametersLabel: t('ModelConfig.editor.audioTranscribe.parametersLabel'),
    previewBadgeLabel: t('ModelConfig.editor.common.previewBadgeLabel'),
    languageLabel: t('ModelConfig.editor.audioTranscribe.languageLabel'),
    languageHint: t('ModelConfig.editor.audioTranscribe.languageHint'),
    responseFormatLabel: t('ModelConfig.editor.audioTranscribe.responseFormatLabel'),
    timeoutLabel: t('ModelConfig.editor.common.timeoutLabel'),
    speakerCountLabel: t('ModelConfig.editor.audioTranscribe.speakerCountLabel'),
    promptLabel: t('ModelConfig.editor.audioTranscribe.promptLabel'),
    timestampsLabel: t('ModelConfig.editor.audioTranscribe.timestampsLabel'),
    diarizationLabel: t('ModelConfig.editor.audioTranscribe.diarizationLabel'),
    defaultPlaceholder: t('ModelConfig.editor.common.defaultPlaceholder'),
    promptPlaceholder: t('ModelConfig.editor.audioTranscribe.promptPlaceholder'),
  };
}

export function AudioTranscribeParamsEditor(props: AudioTranscribeParamsEditorProps) {
  const { copy, params } = props;

  const updateParam = <K extends keyof AudioTranscribeParamsState>(
    key: K,
    value: AudioTranscribeParamsState[K],
  ) => {
    props.onParamsChange({ ...params, [key]: value });
  };

  return (
    <div className="space-y-3">
      <SubSectionLabel label={copy.parametersLabel} previewLabel={copy.previewBadgeLabel} />

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.languageLabel} tooltip={copy.languageHint}>
          <FieldInput
            value={params.language}
            onChange={(value) => updateParam('language', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.responseFormatLabel}>
          <FieldSelect
            value={params.responseFormat}
            onChange={(value) => updateParam('responseFormat', value)}
            options={AUDIO_TRANSCRIBE_RESPONSE_FORMAT_OPTIONS.map((item) => ({ value: item, label: item }))}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.timeoutLabel}>
          <FieldInput
            value={params.timeoutMs}
            onChange={(value) => updateParam('timeoutMs', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.speakerCountLabel}>
          <FieldInput
            value={params.speakerCount}
            onChange={(value) => updateParam('speakerCount', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>

      <FieldRow label={copy.promptLabel}>
        <FieldTextarea
          value={params.prompt}
          onChange={(value) => updateParam('prompt', value)}
          placeholder={copy.promptPlaceholder}
          rows={3}
        />
      </FieldRow>

      <FieldToggle
        label={copy.timestampsLabel}
        checked={params.timestamps}
        onChange={(value) => updateParam('timestamps', value)}
      />
      <FieldToggle
        label={copy.diarizationLabel}
        checked={params.diarization}
        onChange={(value) => updateParam('diarization', value)}
      />
    </div>
  );
}
