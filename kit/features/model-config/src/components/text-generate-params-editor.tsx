import { useState, type ReactNode } from 'react';
import type { TextGenerateParamsState } from '../types.js';
import { TEXT_RESPONSE_STOP_SEQUENCES_MAX } from '../constants.js';
import {
  FieldRow,
  FieldTextarea,
} from './field-primitives.js';

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

/**
 * Section heading used in the redesigned editor — uppercase tracked label without the
 * decorative pulse-dot of {@link SectionGroupHeader}. Matches Linear/Vercel-style minimal
 * configuration screens (Chat Configuration reference).
 */
function EditorSectionTitle(props: { label: string }) {
  return (
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted,#94a3b8)]">
      {props.label}
    </div>
  );
}

/**
 * Numeric value formatter shared between the slider readout and the stored param value.
 * Mirrors NumberStepperField's behavior (defined in field-primitives.tsx) so test suites
 * that drive either control end up with the same string in state.
 */
function formatNumeric(value: number, step: number): string {
  if (Number.isInteger(step) && Number.isInteger(value)) return String(value);
  const decimals = (() => {
    const fragment = String(step).split('.')[1];
    return fragment ? Math.min(fragment.length, 4) : 2;
  })();
  return Number.parseFloat(value.toFixed(decimals)).toString();
}

/**
 * Slider row with a right-aligned editable value chip — matches the reference layout.
 * The chip is a real text input so power users can type the exact value, and the
 * range slider below drives the same state for drag-to-set.
 *
 *   Temperature                                [ 0.70 ]
 *   ──────●──────────────────────
 */
function SliderRow(props: {
  label: string;
  value: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  inputMode?: 'numeric' | 'decimal';
  onChange: (next: string) => void;
  children?: ReactNode;
}) {
  const parsed = props.value === '' ? Number.NaN : Number(props.value);
  // Slider always shows *something*, even when state is empty — falls back to the param default
  // so the thumb never sits past the track.
  const sliderNumeric = Number.isFinite(parsed) ? parsed : props.defaultValue;
  // The chip mirrors the raw param string. Empty state → empty chip with the default as a
  // placeholder hint. This keeps controlled-input semantics clean (no "default snapped into
  // the value") and lets users type any value, not just step-aligned.
  const placeholder = formatNumeric(props.defaultValue, props.step);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-[var(--nimi-text-primary,#0f172a)]">{props.label}</span>
        <input
          type="text"
          inputMode={props.inputMode ?? 'decimal'}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={placeholder}
          className="h-7 w-16 rounded-md border border-transparent bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_10%,transparent)] px-2 text-right text-[12px] font-semibold tabular-nums text-[var(--nimi-text-primary,#0f172a)] outline-none transition placeholder:text-[var(--nimi-text-muted,#94a3b8)] focus:border-[var(--nimi-action-primary-bg,#10b981)] focus:bg-white focus:ring-2 focus:ring-emerald-100"
        />
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={sliderNumeric}
        onChange={(event) => props.onChange(formatNumeric(Number(event.target.value), props.step))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-500 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:shadow-sm"
      />
      {props.children}
    </div>
  );
}

const PLAIN_NUMBER_INPUT_CLASS =
  'h-9 w-full rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle,#e2e8f0)_90%,transparent)] bg-white px-2.5 text-[13px] tabular-nums text-[var(--nimi-text-primary,#0f172a)] outline-none transition focus:border-[var(--nimi-action-primary-bg,#10b981)] focus:ring-2 focus:ring-emerald-100 placeholder:text-[var(--nimi-text-muted,#94a3b8)]';

function PlainNumberInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'numeric' | 'decimal';
}) {
  return (
    <input
      type="text"
      inputMode={props.inputMode ?? 'decimal'}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      className={PLAIN_NUMBER_INPUT_CLASS}
    />
  );
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

/**
 * Flat collapsible row — visually a horizontal divider with the title on the left and
 * a chevron on the right. Replaces the bordered card-style collapsible to match the
 * minimal "Advanced Settings >" footer in the Active Model reference layout.
 */
function AdvancedRow(props: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-[var(--nimi-border-subtle,#e2e8f0)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[13px] font-medium text-[var(--nimi-text-secondary,#475569)]">{props.title}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[var(--nimi-text-muted,#94a3b8)] transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open ? <div className="pt-3.5">{props.children}</div> : null}
    </div>
  );
}
