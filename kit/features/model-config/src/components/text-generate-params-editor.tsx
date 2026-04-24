import type { TextGenerateParamsState } from '../types.js';
import { TEXT_RESPONSE_STOP_SEQUENCES_MAX } from '../constants.js';
import { FieldInput, FieldRow, FieldTextarea, SubSectionLabel } from './field-primitives.js';

export type TextGenerateParamsEditorCopy = {
  parametersLabel: string;
  previewBadgeLabel?: string;
  temperatureLabel: string;
  topPLabel: string;
  topKLabel: string;
  maxTokensLabel: string;
  timeoutLabel: string;
  stopSequencesLabel: string;
  stopSequencesHint?: string;
  presencePenaltyLabel: string;
  frequencyPenaltyLabel: string;
  defaultPlaceholder?: string;
  stopSequencesPlaceholder?: string;
};

export type TextGenerateParamsEditorProps = {
  params: TextGenerateParamsState;
  onParamsChange: (next: TextGenerateParamsState) => void;
  copy: TextGenerateParamsEditorCopy;
};

export function createTextGenerateEditorCopy(
  t: (key: string, vars?: Record<string, string | number>) => string,
): TextGenerateParamsEditorCopy {
  return {
    parametersLabel: t('ModelConfig.editor.textGenerate.parametersLabel'),
    previewBadgeLabel: t('ModelConfig.editor.common.previewBadgeLabel'),
    temperatureLabel: t('ModelConfig.editor.textGenerate.temperatureLabel'),
    topPLabel: t('ModelConfig.editor.textGenerate.topPLabel'),
    topKLabel: t('ModelConfig.editor.textGenerate.topKLabel'),
    maxTokensLabel: t('ModelConfig.editor.textGenerate.maxTokensLabel'),
    timeoutLabel: t('ModelConfig.editor.common.timeoutLabel'),
    stopSequencesLabel: t('ModelConfig.editor.textGenerate.stopSequencesLabel'),
    stopSequencesHint: t('ModelConfig.editor.textGenerate.stopSequencesHint', {
      max: TEXT_RESPONSE_STOP_SEQUENCES_MAX,
    }),
    presencePenaltyLabel: t('ModelConfig.editor.textGenerate.presencePenaltyLabel'),
    frequencyPenaltyLabel: t('ModelConfig.editor.textGenerate.frequencyPenaltyLabel'),
    defaultPlaceholder: t('ModelConfig.editor.common.defaultPlaceholder'),
    stopSequencesPlaceholder: t('ModelConfig.editor.textGenerate.stopSequencesPlaceholder'),
  };
}

function stopSequencesToText(sequences: string[]): string {
  return sequences.join('\n');
}

function stopSequencesFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, TEXT_RESPONSE_STOP_SEQUENCES_MAX);
}

export function TextGenerateParamsEditor(props: TextGenerateParamsEditorProps) {
  const { copy, params } = props;

  const updateParam = <K extends keyof TextGenerateParamsState>(
    key: K,
    value: TextGenerateParamsState[K],
  ) => {
    props.onParamsChange({ ...params, [key]: value });
  };

  return (
    <div className="space-y-3">
      <SubSectionLabel label={copy.parametersLabel} previewLabel={copy.previewBadgeLabel} />

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.temperatureLabel}>
          <FieldInput
            value={params.temperature}
            onChange={(value) => updateParam('temperature', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.topPLabel}>
          <FieldInput
            value={params.topP}
            onChange={(value) => updateParam('topP', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.topKLabel}>
          <FieldInput
            value={params.topK}
            onChange={(value) => updateParam('topK', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.maxTokensLabel}>
          <FieldInput
            value={params.maxTokens}
            onChange={(value) => updateParam('maxTokens', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.presencePenaltyLabel}>
          <FieldInput
            value={params.presencePenalty}
            onChange={(value) => updateParam('presencePenalty', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.frequencyPenaltyLabel}>
          <FieldInput
            value={params.frequencyPenalty}
            onChange={(value) => updateParam('frequencyPenalty', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>

      <FieldRow label={copy.timeoutLabel}>
        <FieldInput
          value={params.timeoutMs}
          onChange={(value) => updateParam('timeoutMs', value)}
          placeholder={copy.defaultPlaceholder}
        />
      </FieldRow>

      <FieldRow label={copy.stopSequencesLabel} tooltip={copy.stopSequencesHint}>
        <FieldTextarea
          value={stopSequencesToText(params.stopSequences)}
          onChange={(value) => updateParam('stopSequences', stopSequencesFromText(value))}
          placeholder={copy.stopSequencesPlaceholder}
          rows={3}
        />
      </FieldRow>
    </div>
  );
}
