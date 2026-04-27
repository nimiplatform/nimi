import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import {
  IMAGE_WORKFLOW_PRESET_SELECTIONS,
  type CapabilityState,
  type ImageResponseFormatMode,
  type ImageWorkflowDraftState,
  type ImageWorkflowPresetSelectionKey,
} from '../tester-types.js';
import { asString } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';

type ImageInspectorPanelProps = {
  state: CapabilityState;
  draft: ImageWorkflowDraftState;
  onDraftChange: React.Dispatch<React.SetStateAction<ImageWorkflowDraftState>>;
};

const SAMPLER_OPTIONS = ['', 'euler', 'euler_a', 'dpmpp_2m', 'dpmpp_2m_karras', 'heun', 'dpm_2', 'lms', 'ddim', 'plms'];
const SCHEDULER_OPTIONS = ['', 'normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform'];

const PRESET_LABELS: Record<ImageWorkflowPresetSelectionKey, string> = {
  vaeModel: 'VAE',
  llmModel: 'LLM / Text Encoder',
  clipLModel: 'CLIP-L',
  clipGModel: 'CLIP-G',
  controlnetModel: 'ControlNet',
  loraModel: 'LoRA',
  auxiliaryModel: 'Auxiliary',
};

const CHEVRON_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function selectClassName(): string {
  return 'w-full appearance-none rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 pr-8 text-sm text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-action-primary-bg)]';
}

function inputClassName(): string {
  return 'w-full rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-action-primary-bg)] placeholder:text-[var(--nimi-text-muted)]';
}

function rangeClassName(): string {
  return 'h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--nimi-border-subtle)] outline-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--nimi-action-primary-bg)] [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--nimi-action-primary-bg)] [&::-moz-range-thumb]:bg-white';
}

function Accordion(props: { title: string; defaultOpen?: boolean; topBorder?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(props.defaultOpen ?? false);
  return (
    <div className={props.topBorder !== false ? 'border-t border-[var(--nimi-border-subtle)]' : ''}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-3 text-left text-sm font-semibold text-[var(--nimi-text-primary)]"
      >
        <span>{props.title}</span>
        <span className={`text-[var(--nimi-text-muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          {CHEVRON_ICON}
        </span>
      </button>
      {open ? <div className="flex flex-col gap-4 pb-4">{props.children}</div> : null}
    </div>
  );
}

function ControlGroup(props: { label: React.ReactNode; valueText?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs font-medium text-[var(--nimi-text-primary)]">
        <span>{props.label}</span>
        {props.valueText !== undefined && props.valueText !== null && props.valueText !== '' ? (
          <span className="text-[var(--nimi-text-muted)] font-normal">{props.valueText}</span>
        ) : null}
      </div>
      {props.children}
    </div>
  );
}

export function ImageInspectorBody(props: ImageInspectorPanelProps & { showTitle?: boolean; defaultOpenAdvanced?: boolean }) {
  const { t } = useTranslation();
  const { state, draft, onDraftChange, showTitle = true, defaultOpenAdvanced = true } = props;

  const updateDraft = React.useCallback((patch: Partial<ImageWorkflowDraftState>) => {
    onDraftChange((prev) => ({ ...prev, ...patch }));
  }, [onDraftChange]);

  const effectiveBinding = React.useMemo(
    () => resolveEffectiveBinding(state.snapshot, state.binding),
    [state.snapshot, state.binding],
  );
  const isLocalRuntimeWorkflow = effectiveBinding?.source === 'local';
  const localEngine = asString(isLocalRuntimeWorkflow ? (effectiveBinding?.engine || effectiveBinding?.provider) : '');
  const isMediaImageWorkflow = isLocalRuntimeWorkflow && localEngine.toLowerCase() === 'media';

  const stepValue = Number(draft.step) || 25;
  const cfgValue = Number(draft.cfgScale) || 7;

  return (
    <>
      {showTitle ? (
        <div className="text-xs font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-secondary)]">
          {t('Tester.imageGenerate.inspectorTitle', { defaultValue: 'Generation Settings' })}
        </div>
      ) : null}

      <div className={showTitle ? 'mt-5' : ''}>
        <Accordion title={t('Tester.imageGenerate.advancedOptions', { defaultValue: 'Advanced Options' })} defaultOpen={defaultOpenAdvanced}>
          <ControlGroup label={t('Tester.imageGenerate.steps', { defaultValue: 'Steps' })} valueText={stepValue}>
            <input
              type="range"
              min={1}
              max={50}
              value={stepValue}
              onChange={(event) => updateDraft({ step: event.target.value })}
              className={rangeClassName()}
            />
          </ControlGroup>

          <ControlGroup label={t('Tester.imageGenerate.cfgScale', { defaultValue: 'CFG Scale' })} valueText={cfgValue.toFixed(1)}>
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={cfgValue}
              onChange={(event) => updateDraft({ cfgScale: event.target.value })}
              className={rangeClassName()}
            />
          </ControlGroup>

          <ControlGroup label={t('Tester.imageGenerate.seed', { defaultValue: 'Seed' })}>
            <input
              type="number"
              value={draft.seed}
              onChange={(event) => updateDraft({ seed: event.target.value })}
              placeholder={t('Tester.imageGenerate.seedPlaceholder', { defaultValue: 'Random (Leave blank)' })}
              className={inputClassName()}
            />
          </ControlGroup>

          <ControlGroup label={t('Tester.imageGenerate.sampler', { defaultValue: 'Sampler' })}>
            <div className="relative">
              <select
                value={SAMPLER_OPTIONS.includes(draft.sampler) ? draft.sampler : '__custom__'}
                onChange={(event) => {
                  const v = event.target.value;
                  if (v === '__custom__') return;
                  updateDraft({ sampler: v });
                }}
                className={selectClassName()}
              >
                <option value="">auto</option>
                {SAMPLER_OPTIONS.filter(Boolean).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                {!SAMPLER_OPTIONS.includes(draft.sampler) && draft.sampler ? (
                  <option value="__custom__">{draft.sampler} (custom)</option>
                ) : null}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--nimi-text-muted)]">
                {CHEVRON_ICON}
              </span>
            </div>
            <input
              type="text"
              value={draft.sampler}
              onChange={(event) => updateDraft({ sampler: event.target.value })}
              placeholder={t('Tester.imageGenerate.samplerPlaceholder', { defaultValue: 'or type a custom sampler' })}
              className={`font-mono text-xs ${inputClassName()}`}
            />
          </ControlGroup>

          <ControlGroup label={t('Tester.imageGenerate.scheduler', { defaultValue: 'Scheduler' })}>
            <div className="relative">
              <select
                value={SCHEDULER_OPTIONS.includes(draft.scheduler) ? draft.scheduler : '__custom__'}
                onChange={(event) => {
                  const v = event.target.value;
                  if (v === '__custom__') return;
                  updateDraft({ scheduler: v });
                }}
                className={selectClassName()}
              >
                <option value="">auto</option>
                {SCHEDULER_OPTIONS.filter(Boolean).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                {!SCHEDULER_OPTIONS.includes(draft.scheduler) && draft.scheduler ? (
                  <option value="__custom__">{draft.scheduler} (custom)</option>
                ) : null}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--nimi-text-muted)]">
                {CHEVRON_ICON}
              </span>
            </div>
            <input
              type="text"
              value={draft.scheduler}
              onChange={(event) => updateDraft({ scheduler: event.target.value })}
              placeholder={t('Tester.imageGenerate.schedulerPlaceholder', { defaultValue: 'or type a custom scheduler' })}
              className={`font-mono text-xs ${inputClassName()}`}
            />
          </ControlGroup>

          <ControlGroup label={t('Tester.imageGenerate.responseFormat', { defaultValue: 'Response Format' })}>
            <div className="inline-flex w-full rounded-full border border-[var(--nimi-border-subtle)] p-0.5 text-xs">
              {(['auto', 'base64', 'url'] as ImageResponseFormatMode[]).map((mode) => {
                const active = draft.responseFormatMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => updateDraft({ responseFormatMode: mode })}
                    className={`flex-1 rounded-full px-2 py-1 transition-colors ${
                      active
                        ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                        : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]'
                    }`}
                  >
                    {mode}
                  </button>
                );
              })}
            </div>
          </ControlGroup>

          <ControlGroup label={t('Tester.imageGenerate.timeoutMs', { defaultValue: 'Timeout (ms)' })}>
            <input
              type="number"
              value={draft.timeoutMs}
              onChange={(event) => updateDraft({ timeoutMs: event.target.value })}
              placeholder={t('Tester.imageGenerate.timeoutPlaceholder', { defaultValue: '600000' })}
              className={`font-mono text-xs ${inputClassName()}`}
            />
          </ControlGroup>
        </Accordion>

        {isMediaImageWorkflow ? (
          <Accordion title={t('Tester.imageGenerate.companionModels', { defaultValue: 'Companion Models' })}>
            {IMAGE_WORKFLOW_PRESET_SELECTIONS.map((preset) => (
              <ControlGroup
                key={preset.key}
                label={(
                  <span className="flex items-baseline gap-1">
                    <span>{PRESET_LABELS[preset.key]}</span>
                    <span className="text-[10px] uppercase text-[var(--nimi-text-muted)]">{preset.slot}</span>
                  </span>
                )}
              >
                <input
                  type="text"
                  value={draft[preset.key]}
                  onChange={(event) => updateDraft({ [preset.key]: event.target.value } as Partial<ImageWorkflowDraftState>)}
                  placeholder={t('Tester.imageGenerate.optional', { defaultValue: 'local artifact id (optional)' })}
                  className={`font-mono text-xs ${inputClassName()}`}
                />
              </ControlGroup>
            ))}
          </Accordion>
        ) : null}

        <Accordion title={t('Tester.imageGenerate.developerOverrides', { defaultValue: 'Developer Overrides' })}>
          <ControlGroup label={t('Tester.imageGenerate.optionsLines', { defaultValue: 'Options (key:value per line)' })}>
            <textarea
              value={draft.optionsText}
              onChange={(event) => updateDraft({ optionsText: event.target.value })}
              placeholder={'clip_skip:2\nrefiner:true'}
              className={`h-20 resize-y font-mono text-xs ${inputClassName()}`}
            />
          </ControlGroup>
          <ControlGroup label={t('Tester.imageGenerate.rawJsonOptions', { defaultValue: 'Raw JSON Options' })}>
            <textarea
              value={draft.rawProfileOverridesText}
              onChange={(event) => updateDraft({ rawProfileOverridesText: event.target.value })}
              placeholder={'{"refiner": true}'}
              className={`h-20 resize-y font-mono text-xs ${inputClassName()}`}
            />
          </ControlGroup>
        </Accordion>
      </div>
    </>
  );
}

export function ImageInspectorPanel(props: ImageInspectorPanelProps) {
  return (
    <ScrollArea className="h-full" contentClassName="px-5 py-5">
      <ImageInspectorBody {...props} />
    </ScrollArea>
  );
}
