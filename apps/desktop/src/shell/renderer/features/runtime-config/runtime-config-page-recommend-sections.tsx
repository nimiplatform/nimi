import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger, ProgressIndicator, ScrollArea } from '@nimiplatform/kit/ui';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import type {
  NimiRuntimeLocalRecommendationFeedItem,
} from '@nimiplatform/sdk/runtime';
import { Button } from './runtime-config-primitives';
import { formatBytes } from './runtime-config-model-center-utils';
import {
  computeVramPercentage,
  parseParamsFromTitle,
  parseLicenseShort,
  parseQuantLevelFromEntry,
  formatRepoOwnerFromRepo,
  primaryEntryName,
  primaryEntrySize,
  recommendationTier,
  recommendationTierColorClass,
  recommendationTierI18nKey,
  recommendationTierLabel,
  vramFitColorClass,
  vramFitI18nKey,
  vramFitTier,
  vramPercentageColorClass,
} from './runtime-config-page-recommend-utils';

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
  if (state === 'fresh') return { label: 'Fresh', cls: 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]' };
  if (state === 'stale') return { label: 'Cached', cls: 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]' };
  return { label: 'Empty', cls: 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]' };
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
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const badge = cacheStateBadge(cacheState);
  const gpuName = [gpu.vendor, gpu.model].filter(Boolean).join(' ') || t('runtimeConfig.recommend.machineGpuUnknown', { defaultValue: 'GPU unavailable' });
  const vram = gpu.totalVramBytes && gpu.totalVramBytes > 0 ? formatBytes(gpu.totalVramBytes) : '\u2014';
  const ram = formatBytes(totalRamBytes);

  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)]">
      {/* Row 1: GPU name (bold title) + refresh controls right-aligned */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          {/* Monitor / GPU icon */}
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--nimi-surface-panel)]">
            <svg className="h-5 w-5 text-[var(--nimi-text-secondary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <span className="text-base font-bold text-[var(--nimi-text-primary)]">{gpuName}</span>
          <span className={`rounded-full px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium ${badge.cls}`}>{badge.label}</span>
        </div>

        <div className="flex items-center gap-3">
          {generatedAt ? (
            <span className="text-xs text-[var(--nimi-text-muted)]" title={generatedAt}>
              {t('runtimeConfig.recommend.lastChecked', { defaultValue: 'Last checked:' })} {i18n.formatRelativeTime(generatedAt)}
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
      <div className="grid grid-cols-2 gap-4 border-t border-[var(--nimi-border-subtle)] px-5 py-3">
        {/* Left column: GPU Specs */}
        <div className="space-y-1">
          <span className="text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
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
          <span className="text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
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
      <span className="text-xs font-medium text-[var(--nimi-text-muted)]">{label}:</span>
      <span className={`font-semibold ${muted ? 'text-[var(--nimi-text-muted)]' : 'text-[var(--nimi-text-primary)]'}`}>{value}</span>
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            count > 0
              ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_32%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]'
              : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)]'
          }`}
        >
          {label}
          {count > 0 ? <span className="rounded-full bg-[var(--nimi-action-primary-bg)] px-1.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-action-primary-text)]">{count}</span> : null}
          <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-52 overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ScrollArea className="max-h-56" viewportClassName="max-h-56" contentClassName="py-1">
          {options.map((option) => {
            const checked = selected.has(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => onToggle(option)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${checked ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)]'}`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-strong)]'}`}>
                  {checked ? (
                    <svg className="h-3 w-3 text-[var(--nimi-action-primary-text)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : null}
                </span>
                {option}
              </button>
            );
          })}
        </ScrollArea>
      </PopoverContent>
    </Popover>
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
  contentClassName = 'w-52 overflow-hidden p-0',
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption ? selectedOption.label : label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-border-strong)]"
        >
          <span className="text-[var(--nimi-text-muted)]">{label}</span>
          <span className="font-semibold text-[var(--nimi-action-primary-bg)]">{displayLabel}</span>
          <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={contentClassName}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ScrollArea className="max-h-56" viewportClassName="max-h-56" contentClassName="py-1">
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
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${checked ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)]'}`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${checked ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-strong)]'}`}>
                  {checked ? (
                    <svg className="h-2.5 w-2.5 text-[var(--nimi-action-primary-text)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : null}
                </span>
                {option.label}
              </button>
            );
          })}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// CapabilityTabs — segmented control for the feed capability (chat/image/video)
// ---------------------------------------------------------------------------

export function CapabilityTabs({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]'
                : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelCard — card-based list item (replaces the former table row)
// ---------------------------------------------------------------------------

export type ModelCardProps = {
  item: NimiRuntimeLocalRecommendationFeedItem;
  totalVramBytes?: number;
  onSelect: () => void;
};

export function ModelCard({ item, totalVramBytes, onSelect }: ModelCardProps) {
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const recommendation = item.recommendation;
  const tier = recommendationTier(recommendation?.tier);
  const params = parseParamsFromTitle(item.title);
  const license = parseLicenseShort(item.installPayload.license);
  const quant = parseQuantLevelFromEntry(primaryEntryName(item));
  const sizeBytes = primaryEntrySize(item);
  const vramPct = computeVramPercentage(sizeBytes, totalVramBytes);
  const lastMod = item.lastModified ? i18n.formatRelativeTime(item.lastModified) : '';

  // Fit badge: prefer the Runtime-issued tier; fall back to a VRAM-based fit
  // band only when Runtime scored nothing. No data → no badge.
  const fit = tier ? null : vramFitTier(vramPct);
  const badgeLabel = tier
    ? t(`runtimeConfig.recommend.${recommendationTierI18nKey(tier)}`, { defaultValue: recommendationTierLabel(tier) })
    : fit
      ? t(`runtimeConfig.recommend.${vramFitI18nKey(fit)}`, { defaultValue: fit })
      : '';
  const badgeClass = tier ? recommendationTierColorClass(tier) : fit ? vramFitColorClass(fit) : '';

  const metaLabels: string[] = [];
  if (params) metaLabels.push(params);
  if (quant) metaLabels.push(quant);
  if (sizeBytes > 0) metaLabels.push(formatBytes(sizeBytes));
  if (item.downloads) metaLabels.push(t('runtimeConfig.recommend.downloads', { count: item.downloads, defaultValue: '{{count}} downloads' }));
  if (typeof item.likes === 'number') metaLabels.push(t('runtimeConfig.recommend.likes', { count: item.likes, defaultValue: '{{count}} likes' }));
  if (license) metaLabels.push(license);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full flex-col gap-2 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3.5 text-left shadow-[var(--nimi-elevation-base)] transition-all hover:border-[var(--nimi-border-strong)] hover:bg-[var(--nimi-action-ghost-hover)] hover:shadow-[var(--nimi-elevation-raised)]"
    >
      {/* Header: name + org, fit badge + chevron on the right */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--nimi-text-primary)]">{item.title}</span>
          <div className="mt-0.5 flex items-center gap-2 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
            <span>{formatRepoOwnerFromRepo(item.repo)}</span>
            {lastMod ? (
              <>
                <span>·</span>
                <span>{lastMod}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {badgeLabel ? (
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[length:var(--nimi-type-caption-size)] font-semibold ${badgeClass}`}>
              {badgeLabel}
            </span>
          ) : null}
          <svg
            className="h-4 w-4 text-[var(--nimi-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--nimi-text-secondary)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>

      {/* Capability tags + state badges */}
      {(item.capabilities.length > 0 || item.verified || item.installedState.installed) ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {item.capabilities.map((cap) => (
            <span key={cap} className="rounded-full bg-[var(--nimi-status-info-soft-bg)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-status-info-soft-text)]">{cap}</span>
          ))}
          {item.verified ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-action-primary-bg)]">
              {t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}
            </span>
          ) : null}
          {item.installedState.installed ? (
            <span className="rounded-full bg-[var(--nimi-status-success-soft-bg)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-status-success-soft-text)]">
              {t('runtimeConfig.recommend.installedState', { defaultValue: 'Installed' })}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Structured meta labels — empty values are never rendered */}
      {metaLabels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {metaLabels.map((label) => (
            <span key={label} className="rounded bg-[var(--nimi-surface-panel)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-text-muted)]">{label}</span>
          ))}
        </div>
      ) : null}

      {/* VRAM usage bar — hidden without size or VRAM data */}
      {vramPct !== null ? (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.recommend.vramUsageLabel', { defaultValue: 'VRAM usage' })}
          </span>
          <ProgressIndicator value={Math.min(vramPct, 100)} className="min-w-0 flex-1" />
          <span className={`shrink-0 text-[length:var(--nimi-type-caption-size)] font-medium ${vramPercentageColorClass(vramPct)}`}>
            {vramPct}%
          </span>
        </div>
      ) : null}
    </button>
  );
}
