import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/nimi-kit/ui';
import type { VideoGenerationRecord } from '../tester-types.js';
import {
  CHEVRON_ICON,
  CLOCK_ICON,
  COPY_ICON,
  DURATION_PRESETS,
  DOWNLOAD_ICON,
  EMPTY_VIDEO_ICON,
  EYE_ICON,
  FILM_ICON,
  PLUS_ICON,
  RATIO_PRESETS,
  RECT_ICON,
  REFRESH_ICON,
  RESOLUTION_PRESETS,
  X_ICON,
  fileToDataUri,
  modeDescription,
  modeShortLabel,
  useOutsideClick,
  type VideoMode,
} from './panel-video-generate-shared.js';

function RatioGlyph({ w, h, active }: { w: number; h: number; active: boolean }) {
  const maxDim = 14;
  const scale = maxDim / Math.max(w, h);
  const rw = w * scale;
  const rh = h * scale;
  const x = (16 - rw) / 2;
  const y = (16 - rh) / 2;
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect
        x={x}
        y={y}
        width={rw}
        height={rh}
        rx={1.2}
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.2}
        opacity={active ? 0.18 : 1}
      />
      <rect
        x={x}
        y={y}
        width={rw}
        height={rh}
        rx={1.2}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
      />
    </svg>
  );
}

export function VideoPlayer({ src, autoPlay = true }: { src: string; autoPlay?: boolean }) {
  if (!src) return null;
  return (
    <video
      src={src}
      controls
      autoPlay={autoPlay}
      loop
      playsInline
      className="block w-full h-full object-contain"
    />
  );
}

// ---------------------------------------------------------------------------
// Compact upload tile (shown only for I2V modes, sits left of the prompt)
// ---------------------------------------------------------------------------

export function CompactUploadTile(props: {
  value: string;
  onChange: (next: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { value, onChange, onError } = props;
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = React.useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      onError(t('Tester.videoGenerate.uploadInvalidType', { defaultValue: 'Please upload an image file.' }));
      return;
    }
    try {
      const dataUri = await fileToDataUri(file);
      onChange(dataUri);
    } catch {
      onError(t('Tester.videoGenerate.uploadInvalidType', { defaultValue: 'Please upload an image file.' }));
    }
  }, [onChange, onError, t]);

  if (value) {
    return (
      <div className="group relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-black">
        <img src={value} alt="reference" className="h-full w-full object-cover" />
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onChange(''); }}
          aria-label={t('Tester.videoGenerate.uploadRemove', { defaultValue: 'Remove image' })}
          className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover:opacity-100"
        >
          {X_ICON}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void handleFile(file);
      }}
      className={`flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-[var(--nimi-radius-md)] border-2 border-dashed transition-colors ${
        dragOver
          ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/5 text-[var(--nimi-action-primary-bg)]'
          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]/40 text-[var(--nimi-text-muted)] hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-secondary)]'
      }`}
    >
      <span>{PLUS_ICON}</span>
      <span className="text-[10px] font-medium leading-tight">
        {t('Tester.videoGenerate.uploadCompactHint', { defaultValue: 'Reference' })}
      </span>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = '';
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chip building block
// ---------------------------------------------------------------------------

type ChipProps = {
  icon?: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  /** Render contents (icon, label, chevron) in primary color while keeping the border neutral. */
  tinted?: boolean;
  open?: boolean;
  onClick: () => void;
  ariaLabel?: string;
};

function Chip({ icon, label, active, tinted, open, onClick, ariaLabel }: ChipProps) {
  const isHot = active || open;
  const borderActive = !tinted && isHot;
  const contentGreen = tinted || isHot;
  const borderClass = borderActive
    ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10'
    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]';
  const contentClass = contentGreen
    ? 'text-[var(--nimi-action-primary-bg)]'
    : 'text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${borderClass} ${contentClass}`}
    >
      {icon ? <span className={contentGreen ? '' : 'text-[var(--nimi-text-muted)]'}>{icon}</span> : null}
      <span>{label}</span>
      <span className={contentGreen ? '' : 'text-[var(--nimi-text-muted)]'}>{CHEVRON_ICON}</span>
    </button>
  );
}

function PopoverShell(props: {
  open: boolean;
  ariaLabel: string;
  width?: number;
  children: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div
      role="dialog"
      aria-label={props.ariaLabel}
      style={{ width: props.width ?? 260 }}
      className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
    >
      {props.children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode chip (T2V / I2V·First / I2V·Ref)
// ---------------------------------------------------------------------------

export function ModeChip(props: {
  value: VideoMode;
  onChange: (next: VideoMode) => void;
}) {
  const { t } = useTranslation();
  const { value, onChange } = props;
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  useOutsideClick(wrapperRef, open, () => setOpen(false));

  const options: Array<{ value: VideoMode; title: string; desc: string }> = [
    {
      value: 't2v',
      title: modeShortLabel('t2v', t),
      desc: modeDescription('t2v', t),
    },
    {
      value: 'i2v-first-frame',
      title: modeShortLabel('i2v-first-frame', t),
      desc: modeDescription('i2v-first-frame', t),
    },
    {
      value: 'i2v-reference',
      title: modeShortLabel('i2v-reference', t),
      desc: modeDescription('i2v-reference', t),
    },
  ];
  const shortLabel = modeShortLabel(value, t);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <Chip
        icon={FILM_ICON}
        label={shortLabel}
        tinted
        open={open}
        onClick={() => setOpen((v) => !v)}
        ariaLabel={t('Tester.videoGenerate.modeShort', { defaultValue: 'Mode' })}
      />
      <PopoverShell open={open} ariaLabel={t('Tester.videoGenerate.modeShort', { defaultValue: 'Mode' })} width={260}>
        <div className="flex flex-col gap-1">
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`flex items-start justify-between gap-2 rounded-[var(--nimi-radius-sm)] px-2.5 py-2 text-left transition-colors ${
                  active
                    ? 'bg-[var(--nimi-action-primary-bg)]/10'
                    : 'hover:bg-[var(--nimi-surface-canvas)]'
                }`}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={`text-[12px] font-medium ${active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>
                    {opt.title}
                  </span>
                  <span className="text-[10px] leading-snug text-[var(--nimi-text-muted)]">
                    {opt.desc}
                  </span>
                </div>
                {active ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-[var(--nimi-action-primary-bg)]">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverShell>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ratio + Resolution chip (combined)
// ---------------------------------------------------------------------------

export function RatioResolutionChip(props: {
  ratio: string;
  resolution: string;
  onRatioChange: (next: string) => void;
  onResolutionChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const { ratio, resolution, onRatioChange, onResolutionChange } = props;
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  useOutsideClick(wrapperRef, open, () => setOpen(false));

  const label = (
    <>
      <span>{ratio}</span>
      {resolution ? (
        <>
          <span className="text-[var(--nimi-text-muted)]">·</span>
          <span>{resolution}</span>
        </>
      ) : null}
    </>
  );

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <Chip
        icon={RECT_ICON}
        label={label as unknown as React.ReactNode}
        open={open}
        onClick={() => setOpen((v) => !v)}
        ariaLabel={t('Tester.videoGenerate.ratioHeading', { defaultValue: 'Aspect Ratio' })}
      />
      <PopoverShell open={open} ariaLabel={t('Tester.videoGenerate.ratioHeading', { defaultValue: 'Aspect Ratio' })} width={300}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
              {t('Tester.videoGenerate.ratioHeading', { defaultValue: 'Aspect Ratio' })}
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {RATIO_PRESETS.map((preset) => {
                const active = preset.value === ratio;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => onRatioChange(preset.value)}
                    className={`flex flex-col items-center gap-1 rounded-[var(--nimi-radius-sm)] border px-1 py-2 transition-colors ${
                      active
                        ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                        : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)]'
                    }`}
                  >
                    <RatioGlyph w={preset.w} h={preset.h} active={active} />
                    <span className="text-[10px] font-medium">{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
              {t('Tester.videoGenerate.resolutionHeading', { defaultValue: 'Resolution' })}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {RESOLUTION_PRESETS.map((preset) => {
                const active = preset === resolution;
                const display = preset === ''
                  ? t('Tester.videoGenerate.resolutionAuto', { defaultValue: 'Auto' })
                  : preset;
                return (
                  <button
                    key={preset || 'auto'}
                    type="button"
                    onClick={() => onResolutionChange(preset)}
                    className={`rounded-[var(--nimi-radius-sm)] border px-2 py-1.5 text-center text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                        : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)]'
                    }`}
                  >
                    {display}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverShell>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duration chip
// ---------------------------------------------------------------------------

export function DurationChip(props: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  const { value, onChange } = props;
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  useOutsideClick(wrapperRef, open, () => setOpen(false));

  const numeric = Math.max(1, Math.min(11, Number(value) || 5));

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <Chip
        icon={CLOCK_ICON}
        label={`${numeric}s`}
        open={open}
        onClick={() => setOpen((v) => !v)}
        ariaLabel={t('Tester.videoGenerate.durationHeading', { defaultValue: 'Duration' })}
      />
      <PopoverShell open={open} ariaLabel={t('Tester.videoGenerate.durationHeading', { defaultValue: 'Duration' })} width={240}>
        <div className="flex flex-col gap-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
            {t('Tester.videoGenerate.durationHeading', { defaultValue: 'Duration' })}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {DURATION_PRESETS.map((sec) => {
              const active = sec === numeric;
              return (
                <button
                  key={sec}
                  type="button"
                  onClick={() => onChange(String(sec))}
                  className={`rounded-[var(--nimi-radius-sm)] border px-2 py-1.5 text-center text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)]'
                  }`}
                >
                  {sec}s
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="range"
              min={1}
              max={11}
              value={numeric}
              onChange={(event) => onChange(event.target.value)}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--nimi-border-subtle)] outline-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--nimi-action-primary-bg)] [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--nimi-action-primary-bg)] [&::-moz-range-thumb]:bg-white"
            />
            <span className="w-9 text-right text-[11px] tabular-nums text-[var(--nimi-text-secondary)]">{numeric}s</span>
          </div>
        </div>
      </PopoverShell>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle chip — single-tap on/off (no popover)
// ---------------------------------------------------------------------------

export function ToggleChip(props: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}) {
  const { icon, label, active, onChange, ariaLabel } = props;
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
        active
          ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)]'
      }`}
    >
      <span className={active ? '' : 'text-[var(--nimi-text-muted)]'}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Watch existing job link (subtle, below card)
// ---------------------------------------------------------------------------

export function WatchJobLink(props: { busy: boolean; onWatch: (jobId: string) => void }) {
  const { t } = useTranslation();
  const { busy, onWatch } = props;
  const [open, setOpen] = React.useState(false);
  const [jobId, setJobId] = React.useState('');
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  useOutsideClick(wrapperRef, open, () => setOpen(false));

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[11px] text-[var(--nimi-text-muted)] underline-offset-2 hover:text-[var(--nimi-text-secondary)] hover:underline"
      >
        {EYE_ICON}
        <span>{t('Tester.videoGenerate.watchExisting', { defaultValue: 'Watch existing job' })}</span>
      </button>
      {open ? (
        <div className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[280px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]">
          <p className="text-[10px] leading-relaxed text-[var(--nimi-text-muted)]">
            {t('Tester.videoGenerate.watchHint', { defaultValue: 'Reattach to a previously submitted job by its ID.' })}
          </p>
          <input
            type="text"
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            placeholder={t('Tester.videoGenerate.jobIdPlaceholder', { defaultValue: 'Job ID...' })}
            className="mt-2 w-full rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1.5 font-mono text-xs text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-action-primary-bg)]"
          />
          <div className="mt-2 flex justify-end">
            <Button
              tone="primary"
              size="sm"
              disabled={busy || !jobId.trim()}
              onClick={() => {
                const trimmed = jobId.trim();
                if (!trimmed) return;
                onWatch(trimmed);
                setOpen(false);
              }}
            >
              {t('Tester.videoGenerate.watch', { defaultValue: 'Watch' })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview panel (current run hero)
// ---------------------------------------------------------------------------

export type PreviewState =
  | { kind: 'empty' }
  | { kind: 'busy'; label: string }
  | { kind: 'success'; videoUri: string; record: VideoGenerationRecord }
  | { kind: 'failed'; error: string; record?: VideoGenerationRecord };

export function PreviewPanel(props: {
  state: PreviewState;
  ratio: string;
  onCopyPrompt: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { state, ratio, onCopyPrompt, onRetry } = props;
  const aspect = (() => {
    const match = RATIO_PRESETS.find((p) => p.value === ratio);
    if (match) return `${match.w} / ${match.h}`;
    return '16 / 9';
  })();

  const downloadHref = state.kind === 'success' ? state.videoUri : '';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('Tester.videoGenerate.preview', { defaultValue: 'Preview' })}
        </h3>
        {state.kind === 'success' ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onCopyPrompt}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-[11px] text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)]"
            >
              {COPY_ICON}
              <span>{t('Tester.videoGenerate.copyPrompt', { defaultValue: 'Copy prompt' })}</span>
            </button>
            <a
              href={downloadHref}
              download={`video-${state.record.id}.mp4`}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-[11px] text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)]"
            >
              {DOWNLOAD_ICON}
              <span>{t('Tester.videoGenerate.downloadVideo', { defaultValue: 'Download' })}</span>
            </a>
          </div>
        ) : null}
      </div>
      <div
        className="relative mx-auto w-full max-w-[640px] overflow-hidden rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-black"
        style={{ aspectRatio: aspect }}
      >
        {state.kind === 'empty' ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[var(--nimi-surface-canvas)] to-[var(--nimi-surface-card)] text-center">
            <span className="text-[var(--nimi-text-muted)]">{EMPTY_VIDEO_ICON}</span>
            <span className="px-6 text-xs text-[var(--nimi-text-muted)]">
              {t('Tester.videoGenerate.previewEmpty', { defaultValue: 'Generate a video to preview it here' })}
            </span>
          </div>
        ) : null}
        {state.kind === 'busy' ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[var(--nimi-surface-canvas)] to-[var(--nimi-surface-card)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--nimi-action-primary-bg)] [animation-delay:-0.2s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--nimi-action-primary-bg)] [animation-delay:-0.1s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--nimi-action-primary-bg)]" />
            </span>
            <span className="px-6 text-center text-xs text-[var(--nimi-text-secondary)]">{state.label}</span>
          </div>
        ) : null}
        {state.kind === 'success' && state.videoUri ? <VideoPlayer src={state.videoUri} /> : null}
        {state.kind === 'failed' ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[var(--nimi-accent-danger)]/10 px-6 text-center">
            <span className="text-sm font-medium text-[var(--nimi-accent-danger)]">
              {t('Tester.videoGenerate.previewFailed', { defaultValue: 'Generation failed' })}
            </span>
            <span className="text-xs text-[var(--nimi-text-secondary)]">{state.error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-1 text-[11px] font-medium text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)]"
            >
              {REFRESH_ICON}
              <span>{t('Tester.videoGenerate.retry', { defaultValue: 'Retry' })}</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
