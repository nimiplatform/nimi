import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import {
  IMAGE_WORKFLOW_PRESET_SELECTIONS,
  type ImageResponseFormatMode,
  type ImageWorkflowDraftState,
} from '../tester-types.js';
import { PRESET_LABELS } from './panel-image-generate-model.js';

type ImageAdvancedParamsPopoverProps = {
  draft: ImageWorkflowDraftState;
  onDraftChange: (updater: Partial<ImageWorkflowDraftState> | ((prev: ImageWorkflowDraftState) => ImageWorkflowDraftState)) => void;
  showWorkflowSlots: boolean;
};

const SLIDERS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="14" y2="6" />
    <line x1="18" y1="6" x2="20" y2="6" />
    <circle cx="16" cy="6" r="2" />
    <line x1="4" y1="12" x2="6" y2="12" />
    <line x1="10" y1="12" x2="20" y2="12" />
    <circle cx="8" cy="12" r="2" />
    <line x1="4" y1="18" x2="14" y2="18" />
    <line x1="18" y1="18" x2="20" y2="18" />
    <circle cx="16" cy="18" r="2" />
  </svg>
);

export function ImageAdvancedParamsPopover(props: ImageAdvancedParamsPopoverProps) {
  const { draft, onDraftChange, showWorkflowSlots } = props;
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const node = wrapperRef.current;
      if (node && !node.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const triggerLabel = t('Tester.imageGenerate.advancedOptions', { defaultValue: 'Advanced Options' });
  const setField = (patch: Partial<ImageWorkflowDraftState>) => onDraftChange(patch);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={triggerLabel}
        aria-expanded={open}
        title={triggerLabel}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] transition-colors hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-secondary)] ${
          open
            ? 'bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]'
            : 'text-[var(--nimi-text-muted)]'
        }`}
      >
        {SLIDERS_ICON}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={triggerLabel}
          className="absolute top-[calc(100%+0.75rem)] right-0 z-[var(--nimi-z-popover,40)] w-[380px] rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-floating)]"
        >
          <ScrollArea className="max-h-[60vh]" contentClassName="pr-1">
            <div className="flex flex-col gap-4 text-xs">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {t('Tester.imageGenerate.negativePromptPlaceholder', { defaultValue: 'Negative prompt (optional)...' }).replace(/\.\.\.$|optional\)\.\.\.$/i, '').trim() || 'Negative prompt'}
                </label>
                <TextareaField
                  textareaClassName="h-16 font-mono text-xs"
                  value={draft.negativePrompt}
                  onChange={(event) => setField({ negativePrompt: event.target.value })}
                  placeholder={t('Tester.imageGenerate.negativePromptPlaceholder')}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.size')}</label>
                  <TextField
                    className="font-mono text-xs"
                    value={draft.size}
                    onChange={(event) => setField({ size: event.target.value })}
                    placeholder={t('Tester.imageGenerate.sizePlaceholder')}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.count')}</label>
                  <TextField
                    className="font-mono text-xs"
                    type="number"
                    min="1"
                    max="4"
                    value={draft.n}
                    onChange={(event) => setField({ n: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.seed')}</label>
                  <TextField
                    className="font-mono text-xs"
                    type="number"
                    value={draft.seed}
                    onChange={(event) => setField({ seed: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.timeoutMs')}</label>
                  <TextField
                    className="font-mono text-xs"
                    type="number"
                    value={draft.timeoutMs}
                    onChange={(event) => setField({ timeoutMs: event.target.value })}
                    placeholder={t('Tester.imageGenerate.timeoutPlaceholder')}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.responseFormat')}</label>
                <div className="inline-flex rounded-full border border-[var(--nimi-border-subtle)] p-0.5 text-xs">
                  {(['auto', 'base64', 'url'] as ImageResponseFormatMode[]).map((mode) => {
                    const active = draft.responseFormatMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setField({ responseFormatMode: mode })}
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
              </div>

              <div className="border-t border-[var(--nimi-border-subtle)] pt-3">
                <div className="mb-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {t('Tester.imageGenerate.advancedOptions', { defaultValue: 'Sampling' })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.steps')}</label>
                    <TextField
                      className="font-mono text-xs"
                      type="number"
                      value={draft.step}
                      onChange={(event) => setField({ step: event.target.value })}
                      placeholder={t('Tester.imageGenerate.stepsPlaceholder')}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.cfgScale')}</label>
                    <TextField
                      className="font-mono text-xs"
                      type="number"
                      step="0.1"
                      value={draft.cfgScale}
                      onChange={(event) => setField({ cfgScale: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.sampler')}</label>
                    <TextField
                      className="font-mono text-xs"
                      value={draft.sampler}
                      onChange={(event) => setField({ sampler: event.target.value })}
                      placeholder={t('Tester.imageGenerate.samplerPlaceholder')}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.scheduler')}</label>
                    <TextField
                      className="font-mono text-xs"
                      value={draft.scheduler}
                      onChange={(event) => setField({ scheduler: event.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  <label className="text-[var(--nimi-text-muted)]">
                    {t('Tester.imageGenerate.optionsText', { defaultValue: 'Options (key:value per line)' })}
                  </label>
                  <TextareaField
                    textareaClassName="h-16 font-mono text-xs"
                    value={draft.optionsText}
                    onChange={(event) => setField({ optionsText: event.target.value })}
                    placeholder={'e.g.\nclip_skip:2\nrefiner:true'}
                  />
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  <label className="text-[var(--nimi-text-muted)]">
                    {t('Tester.imageGenerate.rawProfileOverrides', { defaultValue: 'Raw profile overrides (JSON)' })}
                  </label>
                  <TextareaField
                    textareaClassName="h-16 font-mono text-xs"
                    value={draft.rawProfileOverridesText}
                    onChange={(event) => setField({ rawProfileOverridesText: event.target.value })}
                    placeholder={'{"steps": 30}'}
                  />
                </div>
              </div>

              {showWorkflowSlots ? (
                <div className="border-t border-[var(--nimi-border-subtle)] pt-3">
                  <div className="mb-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {t('Tester.imageGenerate.companionModels', { defaultValue: 'Companion Models' })}
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {IMAGE_WORKFLOW_PRESET_SELECTIONS.map((preset) => (
                      <div key={preset.key} className="flex flex-col gap-1">
                        <label className="text-[var(--nimi-text-muted)]">{PRESET_LABELS[preset.key]} <span className="text-[10px] uppercase">({preset.slot})</span></label>
                        <TextField
                          className="font-mono text-xs"
                          value={draft[preset.key]}
                          onChange={(event) => setField({ [preset.key]: event.target.value } as Partial<ImageWorkflowDraftState>)}
                          placeholder={t('Tester.imageGenerate.optional', { defaultValue: 'local artifact id (optional)' })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </ScrollArea>

          <div
            aria-hidden
            className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]"
          />
        </div>
      ) : null}
    </div>
  );
}
