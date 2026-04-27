import type { TextGenerateParamsState } from '../types.js';
import { TEXT_RESPONSE_STOP_SEQUENCES_MAX } from '../constants.js';
import {
  CollapsibleSection,
  FieldRow,
  FieldTextarea,
  NumberStepperField,
  SectionGroupHeader,
} from './field-primitives.js';

export type TextGenerateParamsEditorCopy = {
  parametersLabel: string;
  previewBadgeLabel?: string;
  generationDefaultsLabel?: string;
  responseControlsLabel?: string;
  advancedLabel?: string;
  advancedDescription?: string;
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
    generationDefaultsLabel: t('ModelConfig.editor.textGenerate.generationDefaultsLabel', {
      defaultValue: 'Generation Defaults',
    }),
    responseControlsLabel: t('ModelConfig.editor.textGenerate.responseControlsLabel', {
      defaultValue: 'Response Controls',
    }),
    advancedLabel: t('ModelConfig.editor.textGenerate.advancedLabel', { defaultValue: 'Advanced' }),
    advancedDescription: t('ModelConfig.editor.textGenerate.advancedDescription', {
      defaultValue: 'Presence & frequency penalties',
    }),
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

  const generationDefaultsLabel = copy.generationDefaultsLabel ?? copy.parametersLabel;
  const responseControlsLabel = copy.responseControlsLabel ?? copy.timeoutLabel;
  const advancedLabel = copy.advancedLabel ?? 'Advanced';
  const advancedDescription = copy.advancedDescription;

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionGroupHeader label={generationDefaultsLabel} />
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label={copy.temperatureLabel}>
            <NumberStepperField
              value={params.temperature}
              onChange={(value) => updateParam('temperature', value)}
              placeholder="0.70"
              step={0.1}
              min={0}
              max={2}
              defaultStart={0.7}
            />
          </FieldRow>
          <FieldRow label={copy.maxTokensLabel}>
            <NumberStepperField
              value={params.maxTokens}
              onChange={(value) => updateParam('maxTokens', value)}
              placeholder="2048"
              step={64}
              min={1}
              defaultStart={2048}
              inputMode="numeric"
            />
          </FieldRow>
          <FieldRow label={copy.topPLabel}>
            <NumberStepperField
              value={params.topP}
              onChange={(value) => updateParam('topP', value)}
              placeholder="0.95"
              step={0.05}
              min={0}
              max={1}
              defaultStart={0.95}
            />
          </FieldRow>
          <FieldRow label={copy.topKLabel}>
            <NumberStepperField
              value={params.topK}
              onChange={(value) => updateParam('topK', value)}
              placeholder="40"
              step={1}
              min={0}
              defaultStart={40}
              inputMode="numeric"
            />
          </FieldRow>
        </div>
      </section>

      <section className="space-y-3">
        <SectionGroupHeader label={responseControlsLabel} />
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label={copy.timeoutLabel}>
            <NumberStepperField
              value={params.timeoutMs}
              onChange={(value) => updateParam('timeoutMs', value)}
              placeholder="120000"
              step={5000}
              min={0}
              defaultStart={120000}
              inputMode="numeric"
            />
          </FieldRow>
          <FieldRow label={copy.stopSequencesLabel} tooltip={copy.stopSequencesHint}>
            <FieldTextarea
              value={stopSequencesToText(params.stopSequences)}
              onChange={(value) => updateParam('stopSequences', stopSequencesFromText(value))}
              placeholder={copy.stopSequencesPlaceholder}
              rows={2}
            />
          </FieldRow>
        </div>
      </section>

      <CollapsibleSection title={advancedLabel} description={advancedDescription}>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label={copy.presencePenaltyLabel}>
            <NumberStepperField
              value={params.presencePenalty}
              onChange={(value) => updateParam('presencePenalty', value)}
              placeholder="0.0"
              step={0.1}
              min={-2}
              max={2}
              defaultStart={0}
            />
          </FieldRow>
          <FieldRow label={copy.frequencyPenaltyLabel}>
            <NumberStepperField
              value={params.frequencyPenalty}
              onChange={(value) => updateParam('frequencyPenalty', value)}
              placeholder="0.0"
              step={0.1}
              min={-2}
              max={2}
              defaultStart={0}
            />
          </FieldRow>
        </div>
      </CollapsibleSection>
    </div>
  );
}
