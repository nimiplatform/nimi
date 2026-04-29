import type { TextGenerateParamsState } from '../types.js';
import { TEXT_RESPONSE_STOP_SEQUENCES_MAX } from '../constants.js';
import {
  FieldRow,
  FieldTextarea,
} from './field-primitives.js';
import {
  AdvancedRow,
  EditorSectionTitle,
  PlainNumberInput,
  SliderRow,
} from './editor-shared.js';

export type TextGenerateParamsEditorCopy = {
  parametersLabel: string;
  previewBadgeLabel?: string;
  generationDefaultsLabel?: string;
  responseControlsLabel?: string;
  advancedLabel?: string;
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
    parametersLabel: t('ModelConfig.editor.textGenerate.parametersLabel', { defaultValue: 'Parameters' }),
    previewBadgeLabel: t('ModelConfig.editor.common.previewBadgeLabel', { defaultValue: 'Preview' }),
    generationDefaultsLabel: t('ModelConfig.editor.textGenerate.generationDefaultsLabel', {
      defaultValue: 'Generation Defaults',
    }),
    responseControlsLabel: t('ModelConfig.editor.textGenerate.responseControlsLabel', {
      defaultValue: 'Response Controls',
    }),
    advancedLabel: t('ModelConfig.editor.textGenerate.advancedLabel', { defaultValue: 'Advanced Settings' }),
    temperatureLabel: t('ModelConfig.editor.textGenerate.temperatureLabel', { defaultValue: 'Temperature' }),
    topPLabel: t('ModelConfig.editor.textGenerate.topPLabel', { defaultValue: 'Top P' }),
    topKLabel: t('ModelConfig.editor.textGenerate.topKLabel', { defaultValue: 'Top K' }),
    maxTokensLabel: t('ModelConfig.editor.textGenerate.maxTokensLabel', { defaultValue: 'Max Tokens' }),
    timeoutLabel: t('ModelConfig.editor.common.timeoutLabel', { defaultValue: 'Timeout (ms)' }),
    stopSequencesLabel: t('ModelConfig.editor.textGenerate.stopSequencesLabel', { defaultValue: 'Stop Sequences' }),
    stopSequencesHint: t('ModelConfig.editor.textGenerate.stopSequencesHint', {
      max: TEXT_RESPONSE_STOP_SEQUENCES_MAX,
      defaultValue: 'Up to {{max}} sequences, one per line.',
    }),
    presencePenaltyLabel: t('ModelConfig.editor.textGenerate.presencePenaltyLabel', { defaultValue: 'Presence penalty' }),
    frequencyPenaltyLabel: t('ModelConfig.editor.textGenerate.frequencyPenaltyLabel', { defaultValue: 'Frequency penalty' }),
    defaultPlaceholder: t('ModelConfig.editor.common.defaultPlaceholder', { defaultValue: 'Default' }),
    stopSequencesPlaceholder: t('ModelConfig.editor.textGenerate.stopSequencesPlaceholder', {
      defaultValue: 'Type and press enter…',
    }),
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
  const advancedLabel = copy.advancedLabel ?? 'Advanced Settings';

  return (
    <div className="space-y-6">
      {/* GENERATION DEFAULTS — sliders for the two creative knobs (T, MaxTokens) so devs can
          drag instead of typing; plain numeric inputs for Top P / Top K which are usually set
          once and forgotten. */}
      <section className="space-y-3.5">
        <EditorSectionTitle label={generationDefaultsLabel} />
        <SliderRow
          label={copy.temperatureLabel}
          value={params.temperature}
          defaultValue={0.7}
          min={0}
          max={2}
          step={0.05}
          onChange={(value) => updateParam('temperature', value)}
        />
        <SliderRow
          label={copy.maxTokensLabel}
          value={params.maxTokens}
          defaultValue={2048}
          min={64}
          max={32768}
          step={64}
          inputMode="numeric"
          onChange={(value) => updateParam('maxTokens', value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label={copy.topPLabel}>
            <PlainNumberInput
              value={params.topP}
              onChange={(value) => updateParam('topP', value)}
              placeholder="0.95"
            />
          </FieldRow>
          <FieldRow label={copy.topKLabel}>
            <PlainNumberInput
              value={params.topK}
              onChange={(value) => updateParam('topK', value)}
              placeholder="40"
              inputMode="numeric"
            />
          </FieldRow>
        </div>
      </section>

      {/* RESPONSE CONTROLS — Timeout is a single inline row (label left, input right) since
          it's a one-line scalar. Stop Sequences keeps a full-width textarea below. */}
      <section className="space-y-3.5">
        <EditorSectionTitle label={responseControlsLabel} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-[var(--nimi-text-primary,#0f172a)]">{copy.timeoutLabel}</span>
          <div className="w-32 shrink-0">
            <PlainNumberInput
              value={params.timeoutMs}
              onChange={(value) => updateParam('timeoutMs', value)}
              placeholder="120000"
              inputMode="numeric"
            />
          </div>
        </div>
        <FieldRow label={copy.stopSequencesLabel} tooltip={copy.stopSequencesHint}>
          <FieldTextarea
            value={stopSequencesToText(params.stopSequences)}
            onChange={(value) => updateParam('stopSequences', stopSequencesFromText(value))}
            placeholder={copy.stopSequencesPlaceholder}
            rows={3}
          />
        </FieldRow>
      </section>

      <AdvancedRow title={advancedLabel}>
        <div className="space-y-3.5">
          <SliderRow
            label={copy.presencePenaltyLabel}
            value={params.presencePenalty}
            defaultValue={0}
            min={-2}
            max={2}
            step={0.1}
            onChange={(value) => updateParam('presencePenalty', value)}
          />
          <SliderRow
            label={copy.frequencyPenaltyLabel}
            value={params.frequencyPenalty}
            defaultValue={0}
            min={-2}
            max={2}
            step={0.1}
            onChange={(value) => updateParam('frequencyPenalty', value)}
          />
        </div>
      </AdvancedRow>
    </div>
  );
}
