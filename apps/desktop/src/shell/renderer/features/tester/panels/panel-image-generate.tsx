import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, TextField } from '@nimiplatform/nimi-kit/ui';
import {
  type CapabilityState,
  type ImageGenerationRecord,
  type ImageWorkflowDraftState,
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
import { createModRuntimeClient, type ModRuntimeBoundImageGenerateInput } from '@nimiplatform/sdk/mod';
import { ImageAdvancedParamsPopover } from './panel-image-generate-advanced.js';
import {
  buildProfileOverrides,
  buildWorkflowExtensions,
  formatRelativeTime,
  formatScenarioJobProgress,
  shouldUseLocalImageWorkflowExtensions,
} from './panel-image-generate-model.js';

type ImageGeneratePanelProps = {
  mode?: 'generate' | 'job';
  state: CapabilityState;
  draft: ImageWorkflowDraftState;
  onDraftChange: React.Dispatch<React.SetStateAction<ImageWorkflowDraftState>>;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

const ARROW_UP_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const INLINE_RATIO_PRESETS: Array<{ label: string; size: string | null }> = [
  { label: '1:1', size: '1024x1024' },
  { label: '16:9', size: '1280x720' },
  { label: '9:16', size: '720x1280' },
  { label: '4:3', size: '1024x768' },
  { label: '3:4', size: '768x1024' },
  { label: 'Custom', size: null },
];

function resolveInlineRatioLabel(size: string): string {
  const match = INLINE_RATIO_PRESETS.find((p) => p.size === size);
  return match ? match.label : 'Custom';
}

const SLIDERS_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

function GenerationPrefsPopover(props: {
  size: string;
  count: string;
  onSizeChange: (next: string) => void;
  onCountChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const ratioLabel = resolveInlineRatioLabel(props.size);
  const countValue = Math.max(1, Math.min(4, Number(props.count) || 1));
  const triggerTitle = t('Tester.imageGenerate.preferences', { defaultValue: 'Generation preferences' });

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${triggerTitle}: ${ratioLabel} · ×${countValue}`}
        title={triggerTitle}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
          open
            ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
            : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)]'
        }`}
      >
        <span className="text-[var(--nimi-text-muted)]">{SLIDERS_ICON}</span>
        <span>{ratioLabel}</span>
        <span className="text-[var(--nimi-text-muted)]">·</span>
        <span className="tabular-nums">×{countValue}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={triggerTitle}
          className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[260px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.imageGenerate.aspectRatio', { defaultValue: 'Aspect Ratio' })}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {INLINE_RATIO_PRESETS.map((preset) => {
                  const active = preset.label === ratioLabel;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        if (preset.size) {
                          props.onSizeChange(preset.size);
                        } else {
                          props.onSizeChange(props.size && resolveInlineRatioLabel(props.size) === 'Custom' ? props.size : '');
                        }
                      }}
                      className={`rounded-[var(--nimi-radius-sm)] border px-2 py-1.5 text-center text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {ratioLabel === 'Custom' ? (
                <div className="mt-1 flex flex-col gap-1 rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-canvas)] p-2">
                  <label className="text-[10px] font-medium text-[var(--nimi-text-secondary)]">
                    {t('Tester.imageGenerate.customSize', { defaultValue: 'Custom Size (W×H)' })}
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={props.size}
                    onChange={(event) => props.onSizeChange(event.target.value)}
                    placeholder={t('Tester.imageGenerate.sizePlaceholder', { defaultValue: '1024x1024' })}
                    className="w-full rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1.5 font-mono text-xs text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-action-primary-bg)]"
                  />
                  <span className="text-[10px] text-[var(--nimi-text-muted)]">
                    {t('Tester.imageGenerate.customSizeHint', { defaultValue: 'Format: 1024x1024 — width and height in pixels' })}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.imageGenerate.count', { defaultValue: 'Image Count' })}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((n) => {
                  const active = n === countValue;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => props.onCountChange(String(n))}
                      className={`rounded-[var(--nimi-radius-sm)] border px-2 py-1.5 text-center text-[11px] font-medium tabular-nums transition-colors ${
                        active
                          ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)]'
                      }`}
                    >
                      ×{n}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const EMPTY_IMAGE_ICON = (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

type OutputGalleryProps = {
  records: ImageGenerationRecord[];
  busy: boolean;
  busyLabel: string;
  onDelete: (id: string) => void;
  onClear: () => void;
};

const TRASH_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);

function PlaceholderCard({ children, dashed = true }: { children?: React.ReactNode; dashed?: boolean }) {
  return (
    <div
      className={`flex aspect-square flex-col items-center justify-center rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)]/50 p-4 text-center ${
        dashed ? 'border border-dashed border-[var(--nimi-border-subtle)]' : ''
      }`}
    >
      {children ?? <span className="text-xl text-[var(--nimi-text-muted)]">—</span>}
    </div>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="flex aspect-square flex-col items-center justify-center gap-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-4 text-center">
      <span className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--nimi-action-primary-bg)] [animation-delay:-0.2s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--nimi-action-primary-bg)] [animation-delay:-0.1s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--nimi-action-primary-bg)]" />
      </span>
      <span className="text-xs text-[var(--nimi-text-muted)]">{label || 'Generating…'}</span>
    </div>
  );
}

function RunCard({ record, onSelect, onDelete }: {
  record: ImageGenerationRecord;
  onSelect: (record: ImageGenerationRecord) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const firstUri = record.imageUris[0];
  const failed = record.result === 'failed';
  return (
    <div className="group relative aspect-square overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
      <button
        type="button"
        onClick={() => onSelect(record)}
        className="block h-full w-full"
        aria-label={record.prompt || 'Run output'}
      >
        {firstUri ? (
          <img src={firstUri} alt="" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
        ) : (
          <div className={`flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-xs ${failed ? 'text-[var(--nimi-accent-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
            <span className="text-2xl">{failed ? '!' : '?'}</span>
            <span className="line-clamp-2 text-center">{failed ? (record.error || 'Failed') : 'No image'}</span>
          </div>
        )}
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <div className="min-w-0 text-[11px] leading-tight text-white">
          <div className="truncate font-medium">{record.prompt || '(empty prompt)'}</div>
          <div className="truncate opacity-70">
            {record.size}{record.elapsed ? ` · ${(record.elapsed / 1000).toFixed(1)}s` : ''} · {formatRelativeTime(record.timestamp)}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onDelete(record.id); }}
          aria-label={t('Tester.imageGenerate.deleteHistoryItem')}
          className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-[var(--nimi-accent-danger)] hover:text-white"
        >
          {TRASH_ICON}
        </button>
      </div>
      {record.imageUris.length > 1 ? (
        <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          ×{record.imageUris.length}
        </span>
      ) : null}
    </div>
  );
}

function ListRow({ record, onSelect, onDelete }: {
  record: ImageGenerationRecord;
  onSelect: (record: ImageGenerationRecord) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const firstUri = record.imageUris[0];
  const failed = record.result === 'failed';
  return (
    <div className="flex items-center gap-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-2">
      <button
        type="button"
        onClick={() => onSelect(record)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        {firstUri ? (
          <img src={firstUri} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
        ) : (
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--nimi-surface-raised)] ${failed ? 'text-[var(--nimi-accent-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
            {failed ? '!' : '?'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-[var(--nimi-text-primary)]">{record.prompt || '(empty prompt)'}</div>
          <div className="truncate text-xs text-[var(--nimi-text-muted)]">
            {record.size} · {record.elapsed ? `${(record.elapsed / 1000).toFixed(1)}s` : '—'} · {formatRelativeTime(record.timestamp)}{failed ? ' · failed' : ''}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onDelete(record.id)}
        aria-label={t('Tester.imageGenerate.deleteHistoryItem')}
        className="shrink-0 rounded p-1.5 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-accent-danger)]"
      >
        {TRASH_ICON}
      </button>
    </div>
  );
}

function RecordDetailDrawer({ record, onClose }: { record: ImageGenerationRecord; onClose: () => void }) {
  const { t } = useTranslation();
  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);
  const failed = record.result === 'failed';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-[900px] overflow-hidden rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-card)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Tester.imageGenerate.closePreview')}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex-1 overflow-auto p-4">
            {record.imageUris.length > 0 ? (
              <div className={`grid gap-3 ${record.imageUris.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {record.imageUris.map((uri, i) => (
                  <img key={i} src={uri} alt="" className="w-full rounded-[var(--nimi-radius-md)] object-contain" />
                ))}
              </div>
            ) : (
              <div className={`rounded p-3 text-sm ${failed ? 'bg-[var(--nimi-accent-danger)]/10 text-[var(--nimi-accent-danger)]' : 'bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-muted)]'}`}>
                {failed ? (record.error || 'Failed') : 'No image artifacts.'}
              </div>
            )}
          </div>
          <div className="border-t border-[var(--nimi-border-subtle)] p-4">
            <div className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
              {t('Tester.imageGenerate.promptLabel', { defaultValue: 'Prompt' })}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--nimi-text-primary)]">{record.prompt || '(empty prompt)'}</div>
            {record.negativePrompt ? (
              <>
                <div className="mt-3 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                  {t('Tester.imageGenerate.negativePromptLabel', { defaultValue: 'Negative' })}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--nimi-text-primary)]">{record.negativePrompt}</div>
              </>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--nimi-text-muted)]">
              <span>{record.size || '—'}</span>
              <span>{record.elapsed ? `${(record.elapsed / 1000).toFixed(1)}s` : '—'}</span>
              <span>{formatRelativeTime(record.timestamp)}</span>
            </div>
            {record.rawResponse ? (
              <div className="mt-3">
                <RawJsonSection content={record.rawResponse} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputGallery(props: OutputGalleryProps) {
  const { t } = useTranslation();
  const { records, busy, busyLabel, onDelete, onClear } = props;
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = React.useState<ImageGenerationRecord | null>(null);

  const historyText = records.length === 0
    ? (busy
      ? t('Tester.imageGenerate.historyRunning', { defaultValue: 'Generating your first run…' })
      : t('Tester.imageGenerate.historyNothing', { defaultValue: 'Nothing yet — your runs will appear here' }))
    : t('Tester.imageGenerate.historyCount', { defaultValue: '{{count}} runs', count: records.length });

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-[var(--nimi-text-secondary)]">
          {t('Tester.imageGenerate.history', { defaultValue: 'History' })}
        </span>
        <span className="text-[var(--nimi-text-muted)]">{historyText}</span>
        {records.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto rounded px-2 py-0.5 text-xs text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-text-secondary)]"
          >
            {t('Tester.imageGenerate.clearHistory', { defaultValue: 'Clear All' })}
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('Tester.imageGenerate.outputGallery', { defaultValue: 'Output gallery' })}
          </h3>
          <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 text-[11px] text-[var(--nimi-text-muted)]">
            {records.length}
          </span>
        </div>
        <div className="inline-flex rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-0.5 text-xs">
          {(['grid', 'list'] as const).map((mode) => {
            const active = view === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={`rounded-full px-3 py-1 transition-colors ${
                  active
                    ? 'bg-[var(--nimi-surface-raised)] text-[var(--nimi-text-primary)] shadow-sm'
                    : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]'
                }`}
              >
                {mode === 'grid'
                  ? t('Tester.imageGenerate.viewGrid', { defaultValue: 'Grid' })
                  : t('Tester.imageGenerate.viewList', { defaultValue: 'List' })}
              </button>
            );
          })}
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid grid-cols-3 gap-3">
          {busy ? <LoadingCard label={busyLabel || t('Tester.imageGenerate.generating', { defaultValue: 'Generating…' })} /> : null}
          {records.map((record) => (
            <RunCard key={record.id} record={record} onSelect={setSelected} onDelete={onDelete} />
          ))}
          {records.length === 0 && !busy ? (
            <>
              <PlaceholderCard>
                <div className="text-[var(--nimi-text-muted)]">{EMPTY_IMAGE_ICON}</div>
                <h4 className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">
                  {t('Tester.imageGenerate.emptyHeading', { defaultValue: 'No image runs yet' })}
                </h4>
                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  {t('Tester.imageGenerate.emptyBodyShort', { defaultValue: 'Run the capability above' })}
                </p>
              </PlaceholderCard>
              <PlaceholderCard />
              <PlaceholderCard />
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {busy ? (
            <div className="rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-text-muted)]">
              {busyLabel || t('Tester.imageGenerate.generating', { defaultValue: 'Generating…' })}
            </div>
          ) : null}
          {records.length === 0 && !busy ? (
            <div className="rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]/50 py-10 text-center text-sm text-[var(--nimi-text-muted)]">
              {t('Tester.imageGenerate.emptyHeading', { defaultValue: 'No image runs yet' })}
            </div>
          ) : null}
          {records.map((record) => (
            <ListRow key={record.id} record={record} onSelect={setSelected} onDelete={onDelete} />
          ))}
        </div>
      )}

      {selected ? <RecordDetailDrawer record={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

export function ImageGeneratePanel(props: ImageGeneratePanelProps) {
  const { t } = useTranslation();
  const { mode = 'generate', state, draft, onDraftChange, onStateChange } = props;
  const [watchPopoverOpen, setWatchPopoverOpen] = React.useState(false);
  const watchWrapperRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!watchPopoverOpen) return;
    const handlePointer = (event: MouseEvent) => {
      if (watchWrapperRef.current && !watchWrapperRef.current.contains(event.target as Node)) {
        setWatchPopoverOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setWatchPopoverOpen(false); };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [watchPopoverOpen]);
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
  const usesLocalImageWorkflow = shouldUseLocalImageWorkflowExtensions(effectiveBinding);

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
    if (usesLocalImageWorkflow) {
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
  }, [draft, effectiveBinding, usesLocalImageWorkflow]);

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

  const canSubmit = !state.busy && Boolean(draft.prompt.trim());
  const runLabel = mode === 'job'
    ? t('Tester.imageGenerate.submitJob', { defaultValue: 'Submit Job' })
    : t('Tester.imageGenerate.runGenerate', { defaultValue: 'Generate' });

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
            placeholder={t('Tester.imageGenerate.jobIdPlaceholder', { defaultValue: 'Job ID...' })}
          />
          <Button
            tone="secondary"
            size="sm"
            disabled={state.busy || !asString(watchJobId)}
            onClick={() => {
              void watchAsyncImageJob({
                jobId: asString(watchJobId),
                requestParams: { jobId: watchJobId, mode: 'attach' },
                routeInfo: null,
              });
            }}
          >
            {t('Tester.imageGenerate.watch', { defaultValue: 'Watch' })}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <textarea
          value={draft.prompt}
          onChange={(event) => updateDraft({ prompt: event.target.value })}
          placeholder={t('Tester.imageGenerate.promptPlaceholder', { defaultValue: 'Describe the image you want to generate...' })}
          rows={5}
          className="w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-[var(--nimi-text-primary)] outline-none placeholder:text-[var(--nimi-text-muted)]"
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
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <GenerationPrefsPopover
            size={draft.size}
            count={draft.n}
            onSizeChange={(next) => updateDraft({ size: next })}
            onCountChange={(next) => updateDraft({ n: next })}
          />

          {draft.seed ? <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 font-mono text-[11px] text-[var(--nimi-text-muted)]">seed:{draft.seed}</span> : null}
          {draft.responseFormatMode && draft.responseFormatMode !== 'auto' ? <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 font-mono text-[11px] text-[var(--nimi-text-muted)]">{draft.responseFormatMode}</span> : null}

          {mode !== 'job' ? (
            <div ref={watchWrapperRef} className="relative inline-flex">
              <button
                type="button"
                onClick={() => setWatchPopoverOpen((v) => !v)}
                aria-expanded={watchPopoverOpen}
                aria-label={t('Tester.imageGenerate.watchExisting', { defaultValue: 'Watch existing job' })}
                title={t('Tester.imageGenerate.watchExisting', { defaultValue: 'Watch existing job' })}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  watchPopoverOpen
                    ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)] hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-secondary)]'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>{t('Tester.imageGenerate.watch', { defaultValue: 'Watch' })}</span>
              </button>

              {watchPopoverOpen ? (
                <div
                  role="dialog"
                  aria-label={t('Tester.imageGenerate.watchExisting', { defaultValue: 'Watch existing job' })}
                  className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[280px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                    {t('Tester.imageGenerate.watchExisting', { defaultValue: 'Watch existing job' })}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--nimi-text-muted)]">
                    {t('Tester.imageGenerate.watchHint', { defaultValue: 'Reattach to a previously submitted job by its ID.' })}
                  </p>
                  <input
                    type="text"
                    value={watchJobId}
                    onChange={(event) => setWatchJobId(event.target.value)}
                    placeholder={t('Tester.imageGenerate.jobIdPlaceholder', { defaultValue: 'Job ID...' })}
                    className="mt-2 w-full rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1.5 font-mono text-xs text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-action-primary-bg)]"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      tone="primary"
                      size="sm"
                      disabled={state.busy || !asString(watchJobId)}
                      onClick={() => {
                        void watchAsyncImageJob({ jobId: asString(watchJobId), requestParams: { jobId: watchJobId, mode: 'attach' }, routeInfo: null });
                        setWatchPopoverOpen(false);
                      }}
                    >
                      {t('Tester.imageGenerate.watch', { defaultValue: 'Watch' })}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            <ImageAdvancedParamsPopover
              draft={draft}
              onDraftChange={updateDraft}
              showWorkflowSlots={usesLocalImageWorkflow}
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

      {state.error ? <ErrorBox message={state.error} /> : null}
      {state.busy && state.busyLabel ? (
        <div className="text-xs text-[var(--nimi-text-muted)]">{state.busyLabel}</div>
      ) : null}

      <OutputGallery
        records={history}
        busy={state.busy}
        busyLabel={state.busyLabel || ''}
        onDelete={deleteHistoryRecord}
        onClear={clearHistory}
      />

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
    </div>
  );
}
