import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState, VideoGenerationRecord } from '../tester-types.js';
import type { VideoParamsState } from '@nimiplatform/nimi-kit/features/model-config';
import {
  asString,
  buildAsyncImageJobOutcome,
  isTerminalScenarioJobStatus,
  scenarioJobEventLabel,
  scenarioJobStatusLabel,
  stripArtifacts,
  toArtifactPreviewUri,
  toPrettyJson,
} from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection } from '../tester-diagnostics.js';
import { createModRuntimeClient, type ModRuntimeBoundVideoGenerateInput } from '@nimiplatform/sdk/mod';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type VideoGeneratePanelProps = {
  mode: 'generate' | 'job';
  state: CapabilityState;
  binding?: CapabilityState['binding'];
  params: VideoParamsState;
  onParamsChange: (next: VideoParamsState) => void;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

type VideoMode = 't2v' | 'i2v-first-frame' | 'i2v-reference';

const PROMPT_MAX = 500;
const HISTORY_LIMIT = 20;

const RATIO_PRESETS: Array<{ label: string; value: string; w: number; h: number }> = [
  { label: '21:9', value: '21:9', w: 21, h: 9 },
  { label: '16:9', value: '16:9', w: 16, h: 9 },
  { label: '4:3', value: '4:3', w: 4, h: 3 },
  { label: '1:1', value: '1:1', w: 1, h: 1 },
  { label: '3:4', value: '3:4', w: 3, h: 4 },
  { label: '9:16', value: '9:16', w: 9, h: 16 },
];

const DURATION_PRESETS = [3, 5, 8, 10];
const RESOLUTION_PRESETS = ['', '480p', '720p', '1080p'];

// ---------------------------------------------------------------------------
// Inline icons
// ---------------------------------------------------------------------------

const ARROW_UP_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const PLUS_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const X_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CHEVRON_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CLOCK_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const SOUND_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

const LOCK_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const FILM_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const RECT_ICON = (
  <svg width="13" height="9" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="10" rx="1.5" />
  </svg>
);

const TRASH_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);

const EMPTY_VIDEO_ICON = (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const EYE_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const DOWNLOAD_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const COPY_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const REFRESH_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isI2vMode(mode: string): boolean {
  return mode !== 't2v';
}

function modeShortLabel(mode: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (mode === 'i2v-first-frame') return t('Tester.videoGenerate.modeLongI2vFirstFrame', { defaultValue: 'First Frame' });
  if (mode === 'i2v-reference' || mode === 'i2v-first-last') return t('Tester.videoGenerate.modeLongI2vReference', { defaultValue: 'Reference' });
  return t('Tester.videoGenerate.modeLongT2v', { defaultValue: 'Text' });
}

function modeDescription(mode: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (mode === 'i2v-first-frame') return t('Tester.videoGenerate.modeDescI2vFirstFrame', { defaultValue: 'Your photo becomes the opening shot' });
  if (mode === 'i2v-reference' || mode === 'i2v-first-last') return t('Tester.videoGenerate.modeDescI2vReference', { defaultValue: 'Match the look of your photo' });
  return t('Tester.videoGenerate.modeDescT2v', { defaultValue: 'Describe your video with words' });
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

function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function useOutsideClick(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [ref, open, onClose]);
}

// ---------------------------------------------------------------------------
// Visual primitives
// ---------------------------------------------------------------------------

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

function VideoPlayer({ src, autoPlay = true }: { src: string; autoPlay?: boolean }) {
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

function CompactUploadTile(props: {
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

function ModeChip(props: {
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

function RatioResolutionChip(props: {
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

function DurationChip(props: { value: string; onChange: (next: string) => void }) {
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

function ToggleChip(props: {
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

function WatchJobLink(props: { busy: boolean; onWatch: (jobId: string) => void }) {
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

type PreviewState =
  | { kind: 'empty' }
  | { kind: 'busy'; label: string }
  | { kind: 'success'; videoUri: string; record: VideoGenerationRecord }
  | { kind: 'failed'; error: string; record?: VideoGenerationRecord };

function PreviewPanel(props: {
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

// ---------------------------------------------------------------------------
// History gallery cards
// ---------------------------------------------------------------------------

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

function RunCard({ record, onSelect, onDelete }: {
  record: VideoGenerationRecord;
  onSelect: (record: VideoGenerationRecord) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const failed = record.result === 'failed';
  return (
    <div className="group relative aspect-square overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-black">
      <button
        type="button"
        onClick={() => onSelect(record)}
        className="block h-full w-full"
        aria-label={record.prompt || 'Run output'}
      >
        {record.videoUri ? (
          <video
            src={record.videoUri}
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            onMouseEnter={(event) => { void event.currentTarget.play().catch(() => {}); }}
            onMouseLeave={(event) => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }}
          />
        ) : (
          <div className={`flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-xs ${failed ? 'text-[var(--nimi-accent-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
            <span className="text-2xl">{failed ? '!' : '?'}</span>
            <span className="line-clamp-2 text-center">{failed ? (record.error || 'Failed') : 'No video'}</span>
          </div>
        )}
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <div className="min-w-0 text-[11px] leading-tight text-white">
          <div className="truncate font-medium">{record.prompt || '(empty prompt)'}</div>
          <div className="truncate opacity-70">
            {record.ratio} · {record.durationSec}s · {formatRelativeTime(record.timestamp)}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onDelete(record.id); }}
          aria-label={t('Tester.videoGenerate.deleteHistoryItem', { defaultValue: 'Delete' })}
          className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-[var(--nimi-accent-danger)] hover:text-white"
        >
          {TRASH_ICON}
        </button>
      </div>
      <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
        {modeShortLabel(record.mode, t)}
      </span>
    </div>
  );
}

function ListRow({ record, onSelect, onDelete }: {
  record: VideoGenerationRecord;
  onSelect: (record: VideoGenerationRecord) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const failed = record.result === 'failed';
  return (
    <div className="flex items-center gap-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-2">
      <button
        type="button"
        onClick={() => onSelect(record)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        {record.videoUri ? (
          <video
            src={record.videoUri}
            muted
            playsInline
            preload="metadata"
            className="h-12 w-12 shrink-0 rounded-md bg-black object-cover"
          />
        ) : (
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--nimi-surface-raised)] ${failed ? 'text-[var(--nimi-accent-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
            {failed ? '!' : '?'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-[var(--nimi-text-primary)]">{record.prompt || '(empty prompt)'}</div>
          <div className="truncate text-xs text-[var(--nimi-text-muted)]">
            {modeShortLabel(record.mode, t)} · {record.ratio} · {record.durationSec}s · {record.elapsed ? `${(record.elapsed / 1000).toFixed(1)}s` : '—'} · {formatRelativeTime(record.timestamp)}{failed ? ' · failed' : ''}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onDelete(record.id)}
        aria-label={t('Tester.videoGenerate.deleteHistoryItem', { defaultValue: 'Delete' })}
        className="shrink-0 rounded p-1.5 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-accent-danger)]"
      >
        {TRASH_ICON}
      </button>
    </div>
  );
}

function RecordDetailDrawer({ record, onClose }: { record: VideoGenerationRecord; onClose: () => void }) {
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
          aria-label={t('Tester.videoGenerate.closePreview', { defaultValue: 'Close preview' })}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
        >
          {X_ICON}
        </button>
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex-1 overflow-auto p-4">
            {record.videoUri ? (
              <div className="overflow-hidden rounded-[var(--nimi-radius-md)] bg-black">
                <VideoPlayer src={record.videoUri} />
              </div>
            ) : (
              <div className={`rounded p-3 text-sm ${failed ? 'bg-[var(--nimi-accent-danger)]/10 text-[var(--nimi-accent-danger)]' : 'bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-muted)]'}`}>
                {failed ? (record.error || 'Failed') : 'No video artifacts.'}
              </div>
            )}
          </div>
          <div className="border-t border-[var(--nimi-border-subtle)] p-4">
            <div className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
              {t('Tester.videoGenerate.promptLabel', { defaultValue: 'Prompt' })}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--nimi-text-primary)]">{record.prompt || '(empty prompt)'}</div>
            {record.negativePrompt ? (
              <>
                <div className="mt-3 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                  {t('Tester.videoGenerate.negativePromptLabel', { defaultValue: 'Negative' })}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--nimi-text-primary)]">{record.negativePrompt}</div>
              </>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--nimi-text-muted)]">
              <span>{modeShortLabel(record.mode, t)}</span>
              <span>{record.ratio}</span>
              <span>{record.durationSec}s</span>
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

function HistoryGallery(props: {
  records: VideoGenerationRecord[];
  busy: boolean;
  busyLabel: string;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { records, busy, busyLabel, onDelete, onClear } = props;
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = React.useState<VideoGenerationRecord | null>(null);

  const historyText = records.length === 0
    ? (busy
      ? t('Tester.videoGenerate.historyRunning', { defaultValue: 'Generating your first run…' })
      : t('Tester.videoGenerate.historyNothing', { defaultValue: 'Nothing yet — your runs will appear here' }))
    : t('Tester.videoGenerate.historyCount', { defaultValue: '{{count}} runs', count: records.length });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('Tester.videoGenerate.outputGallery', { defaultValue: 'Output gallery' })}
          </h3>
          <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">
            {records.length}
          </span>
          <span className="text-[11px] text-[var(--nimi-text-muted)]">{historyText}</span>
        </div>
        <div className="flex items-center gap-2">
          {records.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded px-2 py-0.5 text-[11px] text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-text-secondary)]"
            >
              {t('Tester.videoGenerate.clearHistory', { defaultValue: 'Clear All' })}
            </button>
          ) : null}
          <div className="inline-flex rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-0.5 text-xs">
            {(['grid', 'list'] as const).map((m) => {
              const active = view === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setView(m)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                    active
                      ? 'bg-[var(--nimi-surface-raised)] text-[var(--nimi-text-primary)] shadow-sm'
                      : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]'
                  }`}
                >
                  {m === 'grid'
                    ? t('Tester.videoGenerate.viewGrid', { defaultValue: 'Grid' })
                    : t('Tester.videoGenerate.viewList', { defaultValue: 'List' })}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {view === 'grid' ? (
        <div className="grid grid-cols-4 gap-2.5">
          {records.map((record) => (
            <RunCard key={record.id} record={record} onSelect={setSelected} onDelete={onDelete} />
          ))}
          {records.length === 0 && !busy ? (
            <>
              <PlaceholderCard>
                <div className="text-[var(--nimi-text-muted)]">{EMPTY_VIDEO_ICON}</div>
                <h4 className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">
                  {t('Tester.videoGenerate.emptyHeading', { defaultValue: 'No video runs yet' })}
                </h4>
                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  {t('Tester.videoGenerate.emptyBodyShort', { defaultValue: 'Run the capability above' })}
                </p>
              </PlaceholderCard>
              <PlaceholderCard />
              <PlaceholderCard />
              <PlaceholderCard />
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {records.length === 0 && !busy ? (
            <div className="rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]/50 py-10 text-center text-sm text-[var(--nimi-text-muted)]">
              {t('Tester.videoGenerate.emptyHeading', { defaultValue: 'No video runs yet' })}
            </div>
          ) : null}
          {records.map((record) => (
            <ListRow key={record.id} record={record} onSelect={setSelected} onDelete={onDelete} />
          ))}
        </div>
      )}
      {busy && view === 'list' ? (
        <div className="rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-text-muted)]">
          {busyLabel || t('Tester.videoGenerate.generating', { defaultValue: 'Generating…' })}
        </div>
      ) : null}
      {selected ? <RecordDetailDrawer record={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function VideoGeneratePanel(props: VideoGeneratePanelProps) {
  const { t } = useTranslation();
  const { mode, onParamsChange, params, state, onStateChange } = props;
  const [prompt, setPrompt] = React.useState('A serene mountain landscape with flowing clouds.');
  const [negativePrompt, setNegativePrompt] = React.useState('');
  const [refImageUri, setRefImageUri] = React.useState('');
  const [jobTimeline, setJobTimeline] = React.useState<Array<Record<string, unknown>>>([]);
  const watchSequenceRef = React.useRef(0);
  const [history, setHistory] = React.useState<VideoGenerationRecord[]>([]);
  const isI2v = isI2vMode(params.mode);
  const resolvedMode = params.mode as VideoMode | 'i2v-first-last';
  const currentTab = (params.mode === 'i2v-first-last' ? 'i2v-reference' : (params.mode as VideoMode));

  const appendHistory = React.useCallback((record: VideoGenerationRecord) => {
    setHistory((prev) => [record, ...prev].slice(0, HISTORY_LIMIT));
  }, []);
  const deleteHistoryRecord = React.useCallback((id: string) => {
    setHistory((prev) => prev.filter((r) => r.id !== id));
  }, []);
  const clearHistory = React.useCallback(() => setHistory([]), []);

  const handleModeChange = React.useCallback((nextMode: VideoMode) => {
    onParamsChange({ ...params, mode: nextMode });
    if (nextMode === 't2v') setRefImageUri('');
  }, [params, onParamsChange]);

  const buildVideoContentItems = React.useCallback((): Array<
    | { type: 'text'; role: 'prompt'; text: string }
    | { type: 'image_url'; role: 'reference_image' | 'first_frame'; imageUrl: string }
  > => {
    const items: Array<
      | { type: 'text'; role: 'prompt'; text: string }
      | { type: 'image_url'; role: 'reference_image' | 'first_frame'; imageUrl: string }
    > = [{ type: 'text', role: 'prompt', text: prompt }];
    if (isI2v && asString(refImageUri)) {
      const role = params.mode === 'i2v-first-frame' ? 'first_frame' : 'reference_image';
      items.push({ type: 'image_url', role, imageUrl: refImageUri });
    }
    return items;
  }, [isI2v, params.mode, prompt, refImageUri]);

  const buildVideoOptions = React.useCallback(() => ({
    ratio: params.ratio,
    durationSec: Number(params.durationSec) || 5,
    generateAudio: params.generateAudio,
    ...(params.resolution ? { resolution: params.resolution } : {}),
    ...(params.fps ? { fps: Number(params.fps) || undefined } : {}),
    ...(params.seed ? { seed: Number(params.seed) || undefined } : {}),
    ...(params.timeoutMs ? { timeoutMs: Number(params.timeoutMs) || undefined } : {}),
    ...(params.cameraFixed ? { cameraFixed: true } : {}),
    ...(asString(negativePrompt) ? { negativePrompt } : {}),
  }), [params, negativePrompt]);

  const finalizeAsyncVideoJob = React.useCallback(async (input: {
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
      artifactFetchError = error instanceof Error ? error.message : String(error || 'Failed to fetch video job artifacts.');
    }

    const firstVideoArtifact = (artifactsResponse.artifacts || []).find((a) => {
      const mime = asString(a.mimeType);
      return mime.startsWith('video/') || (!mime && asString(a.uri));
    });
    const playbackUri = firstVideoArtifact
      ? toArtifactPreviewUri({ uri: firstVideoArtifact.uri, bytes: firstVideoArtifact.bytes, mimeType: firstVideoArtifact.mimeType, defaultMimeType: 'video/mp4' })
      : '';

    const jobRecord = input.job || {};
    const playbackError = (!artifactFetchError && !playbackUri && scenarioJobStatusLabel(jobRecord.status) === 'completed')
      ? 'Job completed but no playable video artifact was returned.'
      : '';
    const combinedArtifactError = [artifactFetchError, playbackError].filter(Boolean).join(' | ');
    const outcome = buildAsyncImageJobOutcome({ status: jobRecord.status, reasonDetail: jobRecord.reasonDetail, artifactFetchError: combinedArtifactError });
    const rawResponse = toPrettyJson({
      request: input.requestParams,
      jobId: input.jobId,
      job: input.job,
      events: jobTimeline,
      artifacts: stripArtifacts({ artifacts: artifactsResponse.artifacts }),
      playbackUri: playbackUri || undefined,
    });
    onStateChange((prev) => ({
      ...prev,
      busy: false,
      busyLabel: '',
      result: outcome.result,
      error: outcome.error,
      output: playbackUri || null,
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
      id: `vid-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      mode: asString(reqParams.mode) || params.mode,
      prompt: asString(reqParams.prompt),
      negativePrompt: asString((reqParams.options as Record<string, unknown> | undefined)?.negativePrompt),
      ratio: asString((reqParams.options as Record<string, unknown> | undefined)?.ratio) || params.ratio,
      durationSec: String((reqParams.options as Record<string, unknown> | undefined)?.durationSec ?? params.durationSec),
      result: outcome.result === 'passed' ? 'passed' : 'failed',
      error: outcome.error || undefined,
      videoUri: playbackUri,
      rawResponse,
      elapsed: input.elapsed,
    });
  }, [appendHistory, jobTimeline, onStateChange, params.durationSec, params.mode, params.ratio]);

  const watchAsyncVideoJob = React.useCallback(async (input: {
    jobId: string;
    requestParams: Record<string, unknown> | null;
    routeInfo: Record<string, unknown> | null;
    initialJob?: Record<string, unknown> | null;
  }) => {
    const watchToken = ++watchSequenceRef.current;
    const startedAt = Date.now();
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
    onStateChange((prev) => ({
      ...prev,
      busy: true,
      busyLabel: 'Watching job...',
      error: '',
      output: null,
      diagnostics: { requestParams: input.requestParams, resolvedRoute: input.routeInfo as any, responseMetadata: { jobId: input.jobId } },
    }));
    const modClient = createModRuntimeClient('core:runtime');
    let currentJob = input.initialJob || await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    if (watchToken !== watchSequenceRef.current) return;
    pushJobEvent('submitted', currentJob);
    if (isTerminalScenarioJobStatus(currentJob.status)) {
      await finalizeAsyncVideoJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
      return;
    }
    const stream = await modClient.media.jobs.subscribe(input.jobId);
    for await (const event of stream) {
      if (watchToken !== watchSequenceRef.current) return;
      currentJob = (event.job as unknown as Record<string, unknown>) || currentJob;
      pushJobEvent(scenarioJobEventLabel(event.eventType), currentJob, event.sequence);
      if (isTerminalScenarioJobStatus(currentJob.status)) {
        await finalizeAsyncVideoJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
        return;
      }
    }
    if (watchToken !== watchSequenceRef.current) return;
    currentJob = await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    await finalizeAsyncVideoJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
  }, [finalizeAsyncVideoJob, onStateChange]);

  const handleJobSubmit = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.promptEmpty') }));
      return;
    }
    if (isI2v && !asString(refImageUri)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.referenceRequired') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const binding = resolveEffectiveBinding(state.snapshot, props.binding ?? state.binding) || undefined;
    const contentItems = buildVideoContentItems();
    const options = buildVideoOptions();
    const requestParams: Record<string, unknown> = {
      mode: resolvedMode,
      prompt,
      options,
      content: contentItems,
      ...(binding ? { binding } : {}),
    };
    try {
      const routeInfo = bindingToRouteInfo(binding);
      const modClient = createModRuntimeClient('core:runtime');
      const job = await modClient.media.jobs.submit({
        modal: 'video',
        input: {
          mode: resolvedMode,
          content: contentItems,
          prompt,
          options,
          binding,
        } as unknown as ModRuntimeBoundVideoGenerateInput,
      });
      await watchAsyncVideoJob({
        jobId: asString((job as unknown as Record<string, unknown>)?.jobId),
        requestParams,
        routeInfo,
        initialJob: job as unknown as Record<string, unknown>,
      });
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : String(error || t('Tester.videoGenerate.submitFailed'));
      const details = (error as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
      const providerMessage = details?.provider_message as string | undefined;
      const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
      const rawResponse = toPrettyJson({ request: requestParams, error: message, details, stage: 'submit' });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse,
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: {} },
      }));
      appendHistory({
        id: `vid-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        mode: resolvedMode,
        prompt,
        negativePrompt,
        ratio: params.ratio,
        durationSec: params.durationSec,
        result: 'failed',
        error: message,
        videoUri: '',
        rawResponse,
      });
    }
  }, [appendHistory, buildVideoContentItems, buildVideoOptions, isI2v, negativePrompt, onStateChange, params.durationSec, params.ratio, prompt, props.binding, refImageUri, resolvedMode, state.binding, state.snapshot, t, watchAsyncVideoJob]);

  const handleSyncRun = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.promptEmpty') }));
      return;
    }
    if (isI2v && !asString(refImageUri)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.referenceRequired') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const binding = resolveEffectiveBinding(state.snapshot, props.binding ?? state.binding) || undefined;
    const contentItems = buildVideoContentItems();
    const options = buildVideoOptions();
    const requestParams: Record<string, unknown> = {
      mode: resolvedMode,
      prompt,
      options,
      content: contentItems,
      ...(binding ? { binding } : {}),
    };
    try {
      const callParams = await resolveCallParams(binding);
      const routeInfo = bindingToRouteInfo(binding);
      const result = await getRuntimeClient().media.video.generate({
        model: callParams.model,
        route: callParams.route,
        connectorId: callParams.connectorId,
        mode: resolvedMode,
        content: contentItems,
        prompt,
        options,
        metadata: callParams.metadata,
      });
      const elapsed = Date.now() - t0;
      const firstVideo = (result.artifacts || []).find((a) => {
        const mime = asString(a.mimeType);
        return mime.startsWith('video/') || (!mime && asString(a.uri));
      });
      const playbackUri = firstVideo
        ? toArtifactPreviewUri({ uri: firstVideo.uri, bytes: firstVideo.bytes, mimeType: firstVideo.mimeType, defaultMimeType: 'video/mp4' })
        : '';
      const rawResponse = toPrettyJson({ request: requestParams, response: stripArtifacts(result) });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'passed',
        output: playbackUri || result,
        rawResponse,
        diagnostics: {
          requestParams,
          resolvedRoute: routeInfo,
          responseMetadata: {
            jobId: (result.job as unknown as Record<string, unknown>)?.jobId as string | undefined,
            artifactCount: result.artifacts?.length,
            traceId: result.trace?.traceId,
            modelResolved: result.trace?.modelResolved,
            elapsed,
          },
        },
      }));
      appendHistory({
        id: `vid-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        mode: resolvedMode,
        prompt,
        negativePrompt,
        ratio: params.ratio,
        durationSec: params.durationSec,
        result: 'passed',
        videoUri: playbackUri,
        rawResponse,
        elapsed,
      });
    } catch (error) {
      const elapsed = Date.now() - t0;
      const baseMessage = error instanceof Error ? error.message : String(error || t('Tester.videoGenerate.failed'));
      const details = (error as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
      const providerMessage = details?.provider_message as string | undefined;
      const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
      const rawResponse = toPrettyJson({ request: requestParams, error: message, details });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse,
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
      appendHistory({
        id: `vid-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        mode: resolvedMode,
        prompt,
        negativePrompt,
        ratio: params.ratio,
        durationSec: params.durationSec,
        result: 'failed',
        error: message,
        videoUri: '',
        rawResponse,
      });
    }
  }, [appendHistory, buildVideoContentItems, buildVideoOptions, isI2v, negativePrompt, onStateChange, params.durationSec, params.ratio, prompt, props.binding, refImageUri, resolvedMode, state.binding, state.snapshot, t]);

  const canSubmit = !state.busy && Boolean(prompt.trim()) && (!isI2v || Boolean(refImageUri.trim()));
  const handleRun = mode === 'job' ? handleJobSubmit : handleSyncRun;

  const previewState: PreviewState = (() => {
    if (state.busy) {
      return { kind: 'busy', label: state.busyLabel || t('Tester.videoGenerate.generating', { defaultValue: 'Generating…' }) };
    }
    const lastRecord = history[0];
    if (state.error && (!lastRecord || lastRecord.result === 'failed')) {
      return { kind: 'failed', error: state.error, record: lastRecord };
    }
    if (lastRecord && lastRecord.result === 'passed' && lastRecord.videoUri) {
      return { kind: 'success', videoUri: lastRecord.videoUri, record: lastRecord };
    }
    const inlineUri = typeof state.output === 'string' ? state.output : '';
    if (inlineUri && lastRecord) {
      return { kind: 'success', videoUri: inlineUri, record: lastRecord };
    }
    return { kind: 'empty' };
  })();

  const handleCopyPrompt = React.useCallback(() => {
    if (previewState.kind !== 'success') return;
    const target = previewState.record.prompt;
    if (!target) return;
    void navigator.clipboard?.writeText(target).catch(() => {});
  }, [previewState]);

  const handleRetry = React.useCallback(() => { void handleRun(); }, [handleRun]);

  const handleUploadError = React.useCallback((message: string) => {
    onStateChange((prev) => ({ ...prev, error: message }));
  }, [onStateChange]);

  return (
    <div className="flex flex-col gap-5">
      {/* CREATION CARD — same structure as Image page */}
      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <div className="flex items-start gap-3">
          {isI2v ? (
            <CompactUploadTile
              value={refImageUri}
              onChange={setRefImageUri}
              onError={handleUploadError}
            />
          ) : null}
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, PROMPT_MAX))}
            placeholder={t('Tester.videoGenerate.promptPlaceholder', { defaultValue: 'Describe your video...' })}
            rows={5}
            className="w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-[var(--nimi-text-primary)] outline-none placeholder:text-[var(--nimi-text-muted)]"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
                event.preventDefault();
                void handleRun();
              }
            }}
          />
        </div>

        <div className="mt-2 border-t border-dashed border-[var(--nimi-border-subtle)] pt-2">
          <textarea
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
            placeholder={t('Tester.videoGenerate.negativePromptPlaceholder', { defaultValue: 'Negative prompt (optional)...' })}
            rows={3}
            className="w-full resize-none border-0 bg-transparent px-0 py-0 text-xs leading-relaxed text-[var(--nimi-text-primary)] outline-none placeholder:text-[var(--nimi-text-muted)]"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <ModeChip value={currentTab} onChange={handleModeChange} />
          <RatioResolutionChip
            ratio={params.ratio}
            resolution={params.resolution}
            onRatioChange={(v) => onParamsChange({ ...params, ratio: v })}
            onResolutionChange={(v) => onParamsChange({ ...params, resolution: v })}
          />
          <DurationChip
            value={params.durationSec}
            onChange={(v) => onParamsChange({ ...params, durationSec: v })}
          />
          <ToggleChip
            icon={SOUND_ICON}
            label={t('Tester.videoGenerate.audio', { defaultValue: 'Sound' })}
            active={params.generateAudio}
            onChange={(next) => onParamsChange({ ...params, generateAudio: next })}
          />
          <ToggleChip
            icon={LOCK_ICON}
            label={t('Tester.videoGenerate.cameraFixed', { defaultValue: 'Lock camera' })}
            active={params.cameraFixed}
            onChange={(next) => onParamsChange({ ...params, cameraFixed: next })}
          />

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] tabular-nums text-[var(--nimi-text-muted)]">
              {prompt.length}/{PROMPT_MAX}
            </span>
            <button
              type="button"
              onClick={() => { void handleRun(); }}
              disabled={!canSubmit}
              aria-label={mode === 'job'
                ? t('Tester.videoGenerate.submitJob', { defaultValue: 'Submit Video Job' })
                : t('Tester.videoGenerate.run', { defaultValue: 'Generate Video' })}
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

      {state.error && !state.busy ? <ErrorBox message={state.error} /> : null}

      {/* Subtle tertiary actions */}
      {mode === 'job' ? (
        <div className="-mt-2 flex items-center gap-3 px-1">
          <WatchJobLink
            busy={state.busy}
            onWatch={(jobId) => {
              void watchAsyncVideoJob({
                jobId,
                requestParams: { jobId, mode: 'attach' },
                routeInfo: null,
              });
            }}
          />
          {state.busy && state.busyLabel ? (
            <span className="text-[11px] text-[var(--nimi-text-muted)]">{state.busyLabel}</span>
          ) : null}
        </div>
      ) : null}

      <PreviewPanel
        state={previewState}
        ratio={params.ratio}
        onCopyPrompt={handleCopyPrompt}
        onRetry={handleRetry}
      />

      <HistoryGallery
        records={history}
        busy={state.busy}
        busyLabel={state.busyLabel || ''}
        onDelete={deleteHistoryRecord}
        onClear={clearHistory}
      />

      {jobTimeline.length > 0 ? (
        <div className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)] p-2 text-xs">
          <div className="mb-1 font-semibold text-[var(--nimi-text-secondary)]">
            {t('Tester.videoGenerate.jobTimeline', { defaultValue: 'Job Timeline' })}
          </div>
          {jobTimeline.map((event, i) => (
            <div key={i} className="text-[var(--nimi-text-primary)]">
              {`[${event.sequence}] ${event.label}: ${event.status}${asString(event.progressLabel) ? ` · ${asString(event.progressLabel)}` : ''}${asString(event.reasonDetail) ? ` — ${asString(event.reasonDetail)}` : ''}`}
            </div>
          ))}
        </div>
      ) : null}

      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
