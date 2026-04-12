import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { formatRelativeLocaleTime } from '@renderer/i18n';
import type {
  LocalRuntimeRecommendationFeedItemDescriptor,
} from '@runtime/local-runtime';
import { Button } from './runtime-config-primitives';
import { formatBytes } from './runtime-config-model-center-utils';
import {
  computeVramPercentage,
  gradeColorClass,
  gradeLabel,
  licenseColorClass,
  parseParamsFromTitle,
  parseLicenseShort,
  parseProviderFromRepo,
  primaryEntrySize,
  tierToGrade,
  vramBarColorClass,
  vramPercentageColorClass,
} from './runtime-config-page-recommend-utils';

function formatSizeLabel(sizeBytes: number): string {
  return sizeBytes > 0 ? formatBytes(sizeBytes) : '\u2014';
}

// ---------------------------------------------------------------------------
// DeviceProfileBar — compact horizontal hardware summary
// ---------------------------------------------------------------------------

export type DeviceProfileBarProps = {
  os: string;
  arch: string;
  totalRamBytes: number;
  gpu: {
    available: boolean;
    vendor?: string;
    model?: string;
    totalVramBytes?: number;
    availableVramBytes?: number;
    memoryModel?: string;
  };
  cacheState: 'fresh' | 'stale' | 'empty';
  generatedAt?: string;
  loading: boolean;
  onRefresh: () => void;
};

function cacheStateBadge(state: 'fresh' | 'stale' | 'empty'): { label: string; cls: string } {
  if (state === 'fresh') return { label: 'Fresh', cls: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' };
  if (state === 'stale') return { label: 'Cached', cls: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]' };
  return { label: 'Empty', cls: 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]' };
}

export function DeviceProfileBar({
  os,
  arch,
  totalRamBytes,
  gpu,
  cacheState,
  generatedAt,
  loading,
  onRefresh,
}: DeviceProfileBarProps) {
  const { t } = useTranslation();
  const badge = cacheStateBadge(cacheState);
  const gpuName = [gpu.vendor, gpu.model].filter(Boolean).join(' ') || t('runtimeConfig.recommend.machineGpuUnknown', { defaultValue: 'GPU unavailable' });
  const vram = gpu.totalVramBytes && gpu.totalVramBytes > 0 ? formatBytes(gpu.totalVramBytes) : '\u2014';
  const ram = formatBytes(totalRamBytes);

  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)]/70 bg-white/95 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
      {/* Row 1: GPU name (bold title) + refresh controls right-aligned */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          {/* Monitor / GPU icon */}
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]">
            <svg className="h-5 w-5 text-[var(--nimi-text-secondary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <span className="text-base font-bold text-[var(--nimi-text-primary)]">{gpuName}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
        </div>

        <div className="flex items-center gap-3">
          {generatedAt ? (
            <span className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" title={generatedAt}>
              {t('runtimeConfig.recommend.lastChecked', { defaultValue: 'Last checked:' })} {formatRelativeLocaleTime(generatedAt)}
            </span>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            <span className="inline-flex items-center gap-1.5">
              <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {loading
                ? t('runtimeConfig.recommend.refreshing', { defaultValue: 'Refreshing\u2026' })
                : t('runtimeConfig.recommend.refreshHardware', { defaultValue: 'Refresh Hardware' })}
            </span>
          </Button>
        </div>
      </div>

      {/* Row 2: Two spec columns */}
      <div className="grid grid-cols-2 gap-4 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-5 py-3">
        {/* Left column: GPU Specs */}
        <div className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
            {t('runtimeConfig.recommend.hwGpuSpecs', { defaultValue: 'GPU Specs' })}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
            <HwStat label="VRAM" value={vram} />
            <HwStat
              label="BW"
              value={'\u2014'}
              title={t('runtimeConfig.recommend.bandwidthPending', { defaultValue: 'Memory bandwidth \u2014 data pending' })}
              muted
            />
          </div>
        </div>

        {/* Right column: System */}
        <div className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
            {t('runtimeConfig.recommend.hwSystem', { defaultValue: 'System' })}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
            <HwStat label="RAM" value={ram} />
            <HwStat label={t('runtimeConfig.recommend.machineOs', { defaultValue: 'OS' })} value={`${os} ${arch}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HwStat({ label, value, title, muted }: { label: string; value: string; title?: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5" title={title}>
      <span className="text-xs font-medium text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{label}:</span>
      <span className={`font-semibold ${muted ? 'text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]' : 'text-[var(--nimi-text-primary)]'}`}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TierSummaryBar — colored tier count chips
// ---------------------------------------------------------------------------

export type TierSummaryBarProps = {
  counts: Record<string, number>;
  activeGrades: Set<string>;
  onToggleGrade: (grade: string) => void;
};

const TIER_BAR_ITEMS: { grade: string; label: string; dot: string; bg: string; activeBg: string }[] = [
  { grade: 'runs_great', label: 'Runs Great', dot: 'bg-[var(--nimi-status-success)]', bg: 'hover:bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)]', activeBg: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] ring-1 ring-emerald-300' },
  { grade: 'runs_well', label: 'Runs Well', dot: 'bg-[var(--nimi-status-success)]', bg: 'hover:bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)]', activeBg: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] ring-1 ring-green-300' },
  { grade: 'tight_fit', label: 'Tight Fit', dot: 'bg-[var(--nimi-status-warning)]', bg: 'hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)]', activeBg: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] ring-1 ring-amber-300' },
  { grade: 'not_recommended', label: 'Not Recommended', dot: 'bg-[var(--nimi-status-danger)]', bg: 'hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)]', activeBg: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] ring-1 ring-rose-300' },
];

export function TierSummaryBar({ counts, activeGrades, onToggleGrade }: TierSummaryBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {TIER_BAR_ITEMS.map((item) => {
        const count = counts[item.grade] || 0;
        const active = activeGrades.has(item.grade);
        return (
          <button
            key={item.grade}
            type="button"
            onClick={() => onToggleGrade(item.grade)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] transition-all ${active ? item.activeBg : item.bg}`}
          >
            <span className={`h-2 w-2 rounded-full ${item.dot}`} />
            <span className="font-bold">{count}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterChip — multi-select dropdown
// ---------------------------------------------------------------------------

export function FilterChip({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = selected.size;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          count > 0
            ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_32%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]'
            : 'border-[var(--nimi-border-subtle)] bg-white text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)]'
        }`}
      >
        {label}
        {count > 0 ? <span className="rounded-full bg-[var(--nimi-action-primary-bg)] px-1.5 text-[10px] text-white">{count}</span> : null}
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ScrollArea className="absolute left-0 z-50 mt-1 max-h-56 w-52 rounded-xl border border-[var(--nimi-border-subtle)] bg-white shadow-lg" contentClassName="py-1">
            {options.map((option) => {
              const checked = selected.has(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onToggle(option)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${checked ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]'}`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-strong)]'}`}>
                    {checked ? (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    ) : null}
                  </span>
                  {option}
                </button>
              );
            })}
          </ScrollArea>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectChip — single-select dropdown (same visual style as FilterChip)
// ---------------------------------------------------------------------------

export function SelectChip({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption ? selectedOption.label : label;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-border-strong)]"
      >
        <span className="text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{label}</span>
        <span className="text-[var(--nimi-text-secondary)]">{displayLabel}</span>
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ScrollArea className="absolute left-0 z-50 mt-1 max-h-56 w-52 rounded-xl border border-[var(--nimi-border-subtle)] bg-white shadow-lg" contentClassName="py-1">
            {options.map((option) => {
              const checked = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${checked ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]'}`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${checked ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-strong)]'}`}>
                    {checked ? (
                      <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    ) : null}
                  </span>
                  {option.label}
                </button>
              );
            })}
          </ScrollArea>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelRow — compact table-like row
// ---------------------------------------------------------------------------

export type ModelRowProps = {
  item: LocalRuntimeRecommendationFeedItemDescriptor;
  totalVramBytes?: number;
  onSelect: () => void;
};

export function ModelRow({ item, totalVramBytes, onSelect }: ModelRowProps) {
  const { t } = useTranslation();
  const recommendation = item.recommendation;
  const grade = tierToGrade(recommendation?.tier);
  const params = parseParamsFromTitle(item.title);
  const license = parseLicenseShort(item.installPayload.license);
  const sizeBytes = primaryEntrySize(item);
  const vramPct = computeVramPercentage(sizeBytes, totalVramBytes);
  const lastMod = item.lastModified ? formatRelativeLocaleTime(item.lastModified) : '—';

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full items-center gap-3 rounded-2xl border border-[var(--nimi-border-subtle)]/70 bg-white/95 px-4 py-3 text-left shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition-all hover:border-[var(--nimi-border-strong)] hover:shadow-[0_6px_18px_rgba(15,23,42,0.06)]"
    >
      {/* Name + params + badges */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{item.title}</span>
          {params ? <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] font-medium text-[var(--nimi-text-muted)]">{params}</span> : null}
          {item.verified ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
              {t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}
            </span>
          ) : null}
          {item.installedState.installed ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--nimi-status-success)]">
              {t('runtimeConfig.recommend.installedState', { defaultValue: 'Installed' })}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
          <span>{parseProviderFromRepo(item.repo)}</span>
          <span>·</span>
          <span>{lastMod}</span>
        </div>
      </div>

      {/* License */}
      <div className="hidden w-20 shrink-0 text-center md:block">
        {license ? (
          <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${licenseColorClass(license)}`}>{license}</span>
        ) : <span className="text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]">—</span>}
      </div>

      {/* Size */}
      <div className="hidden w-16 shrink-0 text-right md:block">
        <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">{formatSizeLabel(sizeBytes)}</span>
      </div>

      {/* VRAM % */}
      <div className="hidden w-20 shrink-0 md:block">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 flex-1 rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]">
            <div
              className={`h-full rounded-full transition-all ${vramBarColorClass(vramPct)}`}
              style={{ width: `${Math.min(vramPct ?? 0, 100)}%` }}
            />
          </div>
          <span className={`text-[11px] font-medium ${vramPercentageColorClass(vramPct)}`}>
            {vramPct !== null ? `${vramPct}%` : '—'}
          </span>
        </div>
      </div>

      {/* Grade badge */}
      <div className="w-28 shrink-0 text-right">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${gradeColorClass(grade)}`}>
          {gradeLabel(grade)}
        </span>
      </div>

      {/* Arrow right */}
      <svg
        className="h-4 w-4 shrink-0 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] transition-transform group-hover:translate-x-0.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}
