import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ScrollArea, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import {
  IMAGE_WORKFLOW_PRESET_SELECTIONS,
  type CapabilityState,
  type ImageGenerationRecord,
  type ImageResponseFormatMode,
  type ImageWorkflowDraftState,
  type ImageWorkflowPresetSelectionKey,
} from '../tester-types.js';
import {
  asString,
  buildAsyncImageJobOutcome,
  isTerminalScenarioJobStatus,
  loadImageHistory,
  saveImageHistory,
  scenarioJobEventLabel,
  scenarioJobStatusLabel,
  stripArtifacts,
  toArtifactPreviewUri,
  toPrettyJson,
} from '../tester-utils.js';
import { resolveEffectiveBinding, resolveImageResponseFormat } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection } from '../tester-diagnostics.js';
import { buildLocalProfileExtensions, createModRuntimeClient, type ModRuntimeBoundImageGenerateInput } from '@nimiplatform/sdk/mod';

type ImageGeneratePanelProps = {
  mode: 'generate' | 'job';
  state: CapabilityState;
  draft: ImageWorkflowDraftState;
  onDraftChange: React.Dispatch<React.SetStateAction<ImageWorkflowDraftState>>;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
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

const ARROW_UP_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const PRESET_LABELS: Record<ImageWorkflowPresetSelectionKey, string> = {
  vaeModel: 'VAE',
  llmModel: 'LLM / Text Encoder',
  clipLModel: 'CLIP-L',
  clipGModel: 'CLIP-G',
  controlnetModel: 'ControlNet',
  loraModel: 'LoRA',
  auxiliaryModel: 'Auxiliary',
};

function buildProfileOverrides(input: {
  step: string; cfgScale: string; sampler: string; scheduler: string;
  optionsText: string; rawJsonText: string;
}): { overrides: Record<string, unknown> | undefined; error: string } {
  const overrides: Record<string, unknown> = {};
  const step = Number(input.step);
  if (input.step && Number.isFinite(step) && step > 0) overrides.steps = step;
  const cfgScale = Number(input.cfgScale);
  if (input.cfgScale && Number.isFinite(cfgScale)) overrides.cfg_scale = cfgScale;
  if (asString(input.sampler)) overrides.sampler = asString(input.sampler);
  if (asString(input.scheduler)) overrides.scheduler = asString(input.scheduler);
  if (asString(input.optionsText)) {
    for (const line of input.optionsText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separatorIdx = trimmed.indexOf(':');
      if (separatorIdx < 1) {
        overrides[trimmed] = true;
        continue;
      }
      const key = trimmed.slice(0, separatorIdx).trim();
      const val = trimmed.slice(separatorIdx + 1).trim();
      overrides[key] = val === 'true' ? true : val === 'false' ? false : val;
    }
  }
  if (asString(input.rawJsonText)) {
    try {
      const parsed = JSON.parse(input.rawJsonText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(overrides, parsed);
      }
    } catch {
      return { overrides: undefined, error: 'Invalid JSON in profile overrides.' };
    }
  }
  return { overrides: Object.keys(overrides).length > 0 ? overrides : undefined, error: '' };
}

const TESTER_IMAGE_MAIN_ENTRY_ID = 'tester/image-main-model';

function buildWorkflowExtensions(input: {
  draft: ImageWorkflowDraftState;
  profileOverrides: Record<string, unknown> | undefined;
  mainLocalAssetId: string;
  mainAssetId: string;
}): { extensions: Record<string, unknown> | undefined; error: string } {
  const { draft, profileOverrides, mainLocalAssetId, mainAssetId } = input;
  const entryOverrides: Array<{ entryId: string; localAssetId: string }> = [];
  if (mainLocalAssetId) {
    entryOverrides.push({ entryId: TESTER_IMAGE_MAIN_ENTRY_ID, localAssetId: mainLocalAssetId });
  }
  for (const preset of IMAGE_WORKFLOW_PRESET_SELECTIONS) {
    const val = draft[preset.key];
    if (asString(val)) {
      entryOverrides.push({ entryId: `tester/image-slot/${preset.slot}`, localAssetId: val });
    }
  }
  for (const comp of draft.componentDrafts) {
    if (asString(comp.slot) && asString(comp.localArtifactId)) {
      entryOverrides.push({ entryId: `tester/image-slot/${comp.slot}`, localAssetId: comp.localArtifactId });
    }
  }
  if (entryOverrides.length === 0 && !profileOverrides) {
    return { extensions: undefined, error: '' };
  }
  const extensions = buildLocalProfileExtensions({
    entryOverrides,
    profileOverrides: profileOverrides || {},
  });
  const companionProfileEntries = IMAGE_WORKFLOW_PRESET_SELECTIONS
    .filter((preset) => asString(draft[preset.key]))
    .map((preset) => ({
      entryId: `tester/image-slot/${preset.slot}`,
      kind: 'asset',
      capability: 'image',
      title: `Workflow slot ${preset.slot}`,
      required: true,
      preferred: true,
      assetId: preset.slot,
      assetKind: preset.kind,
      engineSlot: preset.slot,
    }));
  extensions.profile_entries = [
    {
      entryId: TESTER_IMAGE_MAIN_ENTRY_ID,
      kind: 'asset',
      capability: 'image',
      title: 'Selected local image model',
      required: true,
      preferred: true,
      assetId: mainAssetId || mainLocalAssetId,
      assetKind: 'image',
    },
    ...companionProfileEntries,
  ];
  return { extensions, error: '' };
}

function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatScenarioJobProgress(job: Record<string, unknown> | null | undefined): string {
  const record = job || {};
  const progressPercent = Number(record.progressPercent ?? record.progress);
  const currentStep = Number(record.progressCurrentStep ?? record.progress_current_step);
  const totalSteps = Number(record.progressTotalSteps ?? record.progress_total_steps);
  const parts: string[] = [];
  if (Number.isFinite(progressPercent) && progressPercent >= 0) {
    parts.push(`${Math.round(progressPercent)}%`);
  }
  if (Number.isFinite(currentStep) && currentStep > 0 && Number.isFinite(totalSteps) && totalSteps > 0) {
    parts.push(`${Math.round(currentStep)}/${Math.round(totalSteps)}`);
  }
  return parts.join(' · ');
}

type ImageAdvancedParamsPopoverProps = {
  draft: ImageWorkflowDraftState;
  onDraftChange: (updater: Partial<ImageWorkflowDraftState> | ((prev: ImageWorkflowDraftState) => ImageWorkflowDraftState)) => void;
  showWorkflowSlots: boolean;
};

function ImageAdvancedParamsPopover(props: ImageAdvancedParamsPopoverProps) {
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

function ImageHistoryPanel({ records, onDelete, onClear }: {
  records: ImageGenerationRecord[];
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  if (records.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
          {t('Tester.imageGenerate.history', { defaultValue: 'History' })} ({records.length})
        </span>
        <Button tone="ghost" size="sm" onClick={onClear}>
          {t('Tester.imageGenerate.clearHistory', { defaultValue: 'Clear All' })}
        </Button>
      </div>
      {records.map((record) => {
        const expanded = expandedId === record.id;
        return (
          <div key={record.id} className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
            <div className="flex items-center gap-2 p-2 text-xs">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => setExpandedId(expanded ? null : record.id)}
              >
                {record.imageUris[0] ? (
                  <img src={record.imageUris[0]} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[var(--nimi-surface-raised)] text-[var(--nimi-text-muted)]">
                    {record.result === 'failed' ? '!' : '?'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--nimi-text-primary)]">{record.prompt || '(empty prompt)'}</div>
                  <div className="text-[var(--nimi-text-muted)]">
                    {record.size} · {record.elapsed ? `${(record.elapsed / 1000).toFixed(1)}s` : '—'} · {formatRelativeTime(record.timestamp)}
                    {record.result === 'failed' ? ' · failed' : ''}
                  </div>
                </div>
              </button>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-accent-danger)]"
                onClick={() => onDelete(record.id)}
                aria-label={t('Tester.imageGenerate.deleteHistoryItem', { defaultValue: 'Delete' })}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </div>
            {expanded ? (
              <div className="flex flex-col gap-2 border-t border-[var(--nimi-border-subtle)] p-2">
                {record.imageUris.length > 0 ? <ImagePreviewGrid uris={record.imageUris} /> : null}
                {record.error ? <div className="rounded bg-[var(--nimi-accent-danger)]/10 p-2 text-xs text-[var(--nimi-accent-danger)]">{record.error}</div> : null}
                {record.rawResponse ? <RawJsonSection content={record.rawResponse} /> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ImagePreviewGrid({ uris }: { uris: string[] }) {
  const { t } = useTranslation();
  const [preview, setPreview] = React.useState<string | null>(null);
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {uris.map((uri) => (
          <button key={uri} type="button" className="cursor-pointer overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] transition-opacity hover:opacity-80" onClick={() => setPreview(uri)}>
            <img alt="Generated image" src={uri} className="block w-full" />
          </button>
        ))}
      </div>
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8" onClick={() => setPreview(null)}>
          <button
            type="button"
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/40"
            onClick={() => setPreview(null)}
            aria-label={t('Tester.imageGenerate.closePreview', { defaultValue: 'Close preview' })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <img alt="Preview" src={preview} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </>
  );
}

export function ImageGeneratePanel(props: ImageGeneratePanelProps) {
  const { t } = useTranslation();
  const { mode, state, draft, onDraftChange, onStateChange } = props;
  const [watchJobId, setWatchJobId] = React.useState('');
  const [jobTimeline, setJobTimeline] = React.useState<Array<Record<string, unknown>>>([]);
  const watchSequenceRef = React.useRef(0);
  const [history, setHistory] = React.useState<ImageGenerationRecord[]>([]);

  React.useEffect(() => {
    void loadImageHistory().then(setHistory);
  }, []);

  const appendHistory = React.useCallback((record: ImageGenerationRecord) => {
    setHistory((prev) => {
      const next = [record, ...prev].slice(0, 20);
      void saveImageHistory(next);
      return next;
    });
  }, []);

  const deleteHistoryRecord = React.useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((r) => r.id !== id);
      void saveImageHistory(next);
      return next;
    });
  }, []);

  const clearHistory = React.useCallback(() => {
    setHistory([]);
    void saveImageHistory([]);
  }, []);

  const effectiveBinding = React.useMemo(() => resolveEffectiveBinding(state.snapshot, state.binding), [state.snapshot, state.binding]);
  const isLocalRuntimeWorkflow = effectiveBinding?.source === 'local';
  const localEngine = asString(isLocalRuntimeWorkflow ? (effectiveBinding?.engine || effectiveBinding?.provider) : '');
  const isMediaImageWorkflow = isLocalRuntimeWorkflow && localEngine.toLowerCase() === 'media';

  const updateDraft = React.useCallback((updater: Partial<ImageWorkflowDraftState> | ((prev: ImageWorkflowDraftState) => ImageWorkflowDraftState)) => {
    onDraftChange((prev) => {
      if (typeof updater === 'function') return updater(prev);
      return { ...prev, ...updater };
    });
  }, [onDraftChange]);

  const buildRequestContext = React.useCallback(() => {
    if (!asString(draft.prompt)) {
      return { error: 'Prompt is required.' };
    }
    const profileOverridesResult = buildProfileOverrides({
      step: draft.step, cfgScale: draft.cfgScale, sampler: draft.sampler,
      scheduler: draft.scheduler, optionsText: draft.optionsText, rawJsonText: draft.rawProfileOverridesText,
    });
    if (profileOverridesResult.error) {
      return { error: profileOverridesResult.error };
    }
    const binding = effectiveBinding || undefined;
    const nNum = Math.max(1, Number(draft.n) || 1);
    let extensions: Record<string, unknown> | undefined;
    if (isMediaImageWorkflow) {
      const mainLocalAssetId = asString(binding?.goRuntimeLocalModelId || binding?.localModelId);
      const mainAssetId = asString(binding?.modelId || binding?.model);
      const localWorkflow = buildWorkflowExtensions({
        draft,
        profileOverrides: profileOverridesResult.overrides,
        mainLocalAssetId,
        mainAssetId,
      });
      if (localWorkflow.error) return { error: localWorkflow.error };
      extensions = localWorkflow.extensions;
    }
    const requestParams: Record<string, unknown> = {
      prompt: draft.prompt,
      ...(draft.negativePrompt ? { negativePrompt: draft.negativePrompt } : {}),
      n: nNum,
      ...(draft.size ? { size: draft.size } : {}),
      ...(draft.seed ? { seed: Number(draft.seed) || undefined } : {}),
      ...(draft.timeoutMs ? { timeoutMs: Number(draft.timeoutMs) || undefined } : {}),
      responseFormat: resolveImageResponseFormat(draft.responseFormatMode),
      ...(extensions ? { extensions } : {}),
      ...(binding ? { binding } : {}),
    };
    return { error: '', binding, requestParams };
  }, [draft, effectiveBinding, isMediaImageWorkflow]);

  const finalizeAsyncImageJob = React.useCallback(async (input: {
    jobId: string;
    requestParams: Record<string, unknown> | null;
    routeInfo: Record<string, unknown> | null;
    job?: Record<string, unknown> | null;
    elapsed: number;
  }) => {
    let artifactFetchError = '';
    let artifactsResponse: { artifacts: Array<{ uri?: string; bytes?: Uint8Array; mimeType?: string }>; traceId?: string } = { artifacts: [] };
    try {
      const modClient = createModRuntimeClient('core:runtime');
      const response = await modClient.media.jobs.getArtifacts(input.jobId);
      artifactsResponse = {
        artifacts: Array.isArray(response.artifacts) ? response.artifacts : [],
        traceId: response.traceId,
      };
    } catch (error) {
      artifactFetchError = error instanceof Error ? error.message : String(error || 'Failed to fetch image job artifacts.');
    }
    const uris = (artifactsResponse.artifacts || [])
      .map((artifact) => toArtifactPreviewUri({ uri: artifact.uri, bytes: artifact.bytes, mimeType: artifact.mimeType, defaultMimeType: 'image/png' }))
      .filter(Boolean);
    const jobRecord = input.job || {};
    const outcome = buildAsyncImageJobOutcome({ status: jobRecord.status, reasonDetail: jobRecord.reasonDetail, artifactFetchError });
    const rawResponse = toPrettyJson({
      request: input.requestParams,
      jobId: input.jobId,
      job: input.job,
      events: jobTimeline,
      artifacts: stripArtifacts({ artifacts: artifactsResponse.artifacts }),
      previewUris: uris,
    });
    onStateChange((prev) => ({
      ...prev,
      busy: false,
      busyLabel: '',
      result: outcome.result,
      error: outcome.error,
      output: uris,
      rawResponse,
      diagnostics: {
        requestParams: input.requestParams,
        resolvedRoute: input.routeInfo as any,
        responseMetadata: {
          jobId: input.jobId,
          artifactCount: artifactsResponse.artifacts.length,
          traceId: asString(jobRecord.traceId || artifactsResponse.traceId) || undefined,
          elapsed: input.elapsed,
        },
      },
    }));
    const reqParams = input.requestParams || {};
    appendHistory({
      id: `img-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      prompt: asString(reqParams.prompt),
      negativePrompt: asString(reqParams.negativePrompt),
      size: asString(reqParams.size),
      result: outcome.result === 'passed' ? 'passed' : 'failed',
      error: outcome.error || undefined,
      imageUris: uris,
      rawResponse,
      elapsed: input.elapsed,
    });
  }, [appendHistory, jobTimeline, onStateChange]);

  const watchAsyncImageJob = React.useCallback(async (input: {
    jobId: string;
    requestParams: Record<string, unknown> | null;
    routeInfo: Record<string, unknown> | null;
    initialJob?: Record<string, unknown> | null;
  }) => {
    const watchToken = ++watchSequenceRef.current;
    const startedAt = Date.now();
    setWatchJobId(input.jobId);
    setJobTimeline([]);
    const pushJobEvent = (label: string, job: Record<string, unknown> | null | undefined, sequence?: unknown) => {
      const normalizedJob = job || {};
      const progressLabel = formatScenarioJobProgress(normalizedJob);
      setJobTimeline((prev) => [...prev, {
        sequence: sequence ?? prev.length + 1,
        label,
        status: scenarioJobStatusLabel(normalizedJob.status),
        progressLabel: progressLabel || undefined,
        reasonDetail: asString(normalizedJob.reasonDetail) || undefined,
      }]);
      onStateChange((prev) => ({
        ...prev,
        busyLabel: progressLabel ? `Watching job... ${progressLabel}` : 'Watching job...',
      }));
    };
    onStateChange((prev) => ({ ...prev, busy: true, busyLabel: 'Watching job...', error: '', output: [], diagnostics: { requestParams: input.requestParams, resolvedRoute: input.routeInfo as any, responseMetadata: { jobId: input.jobId } } }));
    const modClient = createModRuntimeClient('core:runtime');
    let currentJob = input.initialJob || await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    if (watchToken !== watchSequenceRef.current) return;
    pushJobEvent('submitted', currentJob);
    if (isTerminalScenarioJobStatus(currentJob.status)) {
      await finalizeAsyncImageJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
      return;
    }
    const stream = await modClient.media.jobs.subscribe(input.jobId);
    for await (const event of stream) {
      if (watchToken !== watchSequenceRef.current) return;
      currentJob = (event.job as unknown as Record<string, unknown>) || currentJob;
      pushJobEvent(scenarioJobEventLabel(event.eventType), currentJob, event.sequence);
      if (isTerminalScenarioJobStatus(currentJob.status)) {
        await finalizeAsyncImageJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
        return;
      }
    }
    if (watchToken !== watchSequenceRef.current) return;
    currentJob = await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    await finalizeAsyncImageJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
  }, [finalizeAsyncImageJob, onStateChange]);

  const handleRun = React.useCallback(async () => {
    const requestContext = buildRequestContext();
    if (requestContext.error) {
      onStateChange((prev) => ({ ...prev, error: requestContext.error }));
      return;
    }
    if (!requestContext.requestParams) {
      onStateChange((prev) => ({ ...prev, error: 'Image request params empty.' }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const binding = requestContext.binding;
    const requestParams = requestContext.requestParams;
    try {
      const routeInfo = bindingToRouteInfo(binding);
      // Both generate and job modes use the async job flow so that
      // progress events from the runtime are received and displayed.
      const modClient = createModRuntimeClient('core:runtime');
      const job = await modClient.media.jobs.submit({ modal: 'image', input: requestParams as unknown as ModRuntimeBoundImageGenerateInput });
      await watchAsyncImageJob({
        jobId: asString((job as unknown as Record<string, unknown>)?.jobId),
        requestParams,
        routeInfo,
        initialJob: job as unknown as Record<string, unknown>,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Image generation failed.');
      const rawResponse = toPrettyJson({ request: requestParams, error: message });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        output: [],
        rawResponse,
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: {} },
      }));
      appendHistory({
        id: `img-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        prompt: asString(requestParams.prompt),
        negativePrompt: asString(requestParams.negativePrompt),
        size: asString(requestParams.size),
        result: 'failed',
        error: message,
        imageUris: [],
        rawResponse,
      });
    }
  }, [appendHistory, buildRequestContext, onStateChange, watchAsyncImageJob]);

  const imageUris = (state.output as string[] | null) || [];
  const canSubmit = !state.busy && Boolean(draft.prompt.trim());
  const runLabel = mode === 'job'
    ? t('Tester.imageGenerate.submitJob', { defaultValue: 'Submit Job' })
    : t('Tester.imageGenerate.runGenerate', { defaultValue: 'Generate Image' });

  return (
    <div className="flex flex-col gap-3">
      {mode === 'job' ? (
        <div className="flex items-center gap-2 rounded-[var(--nimi-radius-lg)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-3 py-2">
          <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">
            {t('Tester.imageGenerate.watch', { defaultValue: 'Watch' })}
          </span>
          <TextField
            className="flex-1 font-mono text-xs"
            value={watchJobId}
            onChange={(event) => setWatchJobId(event.target.value)}
            placeholder={t('Tester.imageGenerate.jobIdPlaceholder')}
          />
          <Button
            tone="secondary"
            size="sm"
            disabled={state.busy || !asString(watchJobId)}
            onClick={() => { void watchAsyncImageJob({ jobId: asString(watchJobId), requestParams: { jobId: watchJobId, mode: 'attach' }, routeInfo: null }); }}
          >
            {t('Tester.imageGenerate.watch', { defaultValue: 'Watch' })}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <TextareaField
          tone="quiet"
          className="p-0 focus-within:border-transparent focus-within:ring-0"
          textareaClassName="min-h-[3.5rem] resize-none px-0 py-0 font-mono text-xs"
          value={draft.prompt}
          onChange={(event) => updateDraft({ prompt: event.target.value })}
          placeholder={t('Tester.imageGenerate.promptPlaceholder')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
              event.preventDefault();
              void handleRun();
            }
          }}
        />
        {draft.negativePrompt ? (
          <div className="mt-1 truncate text-[11px] text-[var(--nimi-text-muted)]">
            <span className="mr-1 uppercase tracking-wide">{t('Tester.imageGenerate.negativePromptShort', { defaultValue: 'neg:' })}</span>
            <span className="font-mono">{draft.negativePrompt}</span>
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--nimi-text-muted)]">
            {draft.size ? <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 font-mono">{draft.size}</span> : null}
            {draft.n && draft.n !== '1' ? <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 font-mono">×{draft.n}</span> : null}
            {draft.seed ? <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 font-mono">seed:{draft.seed}</span> : null}
            {draft.responseFormatMode && draft.responseFormatMode !== 'auto' ? <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 font-mono">{draft.responseFormatMode}</span> : null}
          </div>
          <div className="flex items-center gap-1.5">
            <ImageAdvancedParamsPopover
              draft={draft}
              onDraftChange={updateDraft}
              showWorkflowSlots={isMediaImageWorkflow}
            />
            <button
              type="button"
              onClick={() => { void handleRun(); }}
              disabled={!canSubmit}
              aria-label={runLabel}
              title={runLabel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {state.busy ? (
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current opacity-80 [animation-delay:-0.2s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current opacity-80 [animation-delay:-0.1s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current opacity-80" />
                </span>
              ) : (
                ARROW_UP_ICON
              )}
            </button>
          </div>
        </div>
      </div>

      {state.busy && state.busyLabel ? (
        <div className="text-xs text-[var(--nimi-text-muted)]">{state.busyLabel}</div>
      ) : null}
      {state.error ? <ErrorBox message={state.error} /> : null}
      {imageUris.length > 0 ? (
        <ImagePreviewGrid uris={imageUris} />
      ) : null}
      {jobTimeline.length > 0 ? (
        <div className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)] p-2 text-xs">
          <div className="mb-1 font-semibold text-[var(--nimi-text-secondary)]">{t('Tester.imageGenerate.jobTimeline')}</div>
          {jobTimeline.map((event, i) => (
            <div key={i} className="text-[var(--nimi-text-primary)]">{`[${event.sequence}] ${event.label}: ${event.status}${asString(event.progressLabel) ? ` · ${asString(event.progressLabel)}` : ''}`}</div>
          ))}
        </div>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
      <ImageHistoryPanel records={history} onDelete={deleteHistoryRecord} onClear={clearHistory} />
    </div>
  );
}
