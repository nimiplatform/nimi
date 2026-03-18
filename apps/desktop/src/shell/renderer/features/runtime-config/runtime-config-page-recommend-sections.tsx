import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeLocaleTime } from '@renderer/i18n';
import type {
  LocalRuntimeCatalogVariantDescriptor,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeRecommendationFeedItemDescriptor,
} from '@runtime/local-runtime';
import { Button, Card } from './runtime-config-primitives';
import {
  DownloadIcon,
  PackageIcon,
  ModelIcon,
} from './runtime-config-local-model-center-icons';
import {
  RecommendationDetailList,
  RecommendationDiagnosticsPanel,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
} from './runtime-config-local-model-center-helpers';
import { formatBytes } from './runtime-config-model-center-utils';
import {
  buildHuggingFaceUrl,
  computeVramPercentage,
  gradeColorClass,
  gradeLabel,
  licenseColorClass,
  parseParamsFromTitle,
  parseLicenseShort,
  parseProviderFromRepo,
  parseQuantBitsFromEntry,
  parseQuantLevelFromEntry,
  primaryEntrySize,
  quantQualityLabel,
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
  if (state === 'fresh') return { label: 'Fresh', cls: 'bg-emerald-100 text-emerald-700' };
  if (state === 'stale') return { label: 'Cached', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Empty', cls: 'bg-slate-100 text-slate-500' };
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
  const vram = gpu.totalVramBytes && gpu.totalVramBytes > 0 ? formatBytes(gpu.totalVramBytes) : '—';
  const ram = formatBytes(totalRamBytes);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200/70 bg-white/95 px-5 py-3 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 text-sm">
        <svg className="h-4 w-4 text-mint-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <span className="font-semibold text-slate-900">{gpuName}</span>
      </div>

      <Stat label="VRAM" value={vram} />
      <Stat label="BW" value="—" title={t('runtimeConfig.recommend.bandwidthPending', { defaultValue: 'Memory bandwidth — data pending' })} />
      <Stat label="RAM" value={ram} />
      <Stat label={t('runtimeConfig.recommend.machineOs', { defaultValue: 'OS' })} value={`${os} ${arch}`} />
      <Stat label="Cores" value="—" title={t('runtimeConfig.recommend.coresPending', { defaultValue: 'Compute cores — data pending' })} />

      <div className="ml-auto flex items-center gap-2">
        {generatedAt ? (
          <span className="text-[11px] text-slate-400" title={generatedAt}>
            {formatRelativeLocaleTime(generatedAt)}
          </span>
        ) : null}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          {loading
            ? t('runtimeConfig.recommend.refreshing', { defaultValue: 'Refreshing…' })
            : t('runtimeConfig.recommend.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline gap-1.5 text-sm" title={title}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
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
  { grade: 'runs_great', label: 'Runs Great', dot: 'bg-emerald-500', bg: 'hover:bg-emerald-50', activeBg: 'bg-emerald-50 ring-1 ring-emerald-300' },
  { grade: 'runs_well', label: 'Runs Well', dot: 'bg-green-500', bg: 'hover:bg-green-50', activeBg: 'bg-green-50 ring-1 ring-green-300' },
  { grade: 'tight_fit', label: 'Tight Fit', dot: 'bg-amber-500', bg: 'hover:bg-amber-50', activeBg: 'bg-amber-50 ring-1 ring-amber-300' },
  { grade: 'not_recommended', label: 'Not Recommended', dot: 'bg-rose-500', bg: 'hover:bg-rose-50', activeBg: 'bg-rose-50 ring-1 ring-rose-300' },
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
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-700 transition-all ${active ? item.activeBg : item.bg}`}
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
            ? 'border-mint-300 bg-mint-50 text-mint-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
        }`}
      >
        {label}
        {count > 0 ? <span className="rounded-full bg-mint-500 px-1.5 text-[10px] text-white">{count}</span> : null}
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 max-h-56 w-52 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            {options.map((option) => {
              const checked = selected.has(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onToggle(option)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${checked ? 'bg-mint-50 text-mint-700' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-mint-500 bg-mint-500' : 'border-slate-300'}`}>
                    {checked ? (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    ) : null}
                  </span>
                  {option}
                </button>
              );
            })}
          </div>
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
  expanded: boolean;
  onToggle: () => void;
};

export function ModelRow({ item, totalVramBytes, expanded, onToggle }: ModelRowProps) {
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
      onClick={onToggle}
      className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
        expanded
          ? 'border-mint-300 bg-mint-50/30 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'
          : 'border-slate-200/70 bg-white/95 shadow-[0_2px_8px_rgba(15,23,42,0.03)] hover:border-slate-300 hover:shadow-[0_6px_18px_rgba(15,23,42,0.06)]'
      }`}
    >
      {/* Engine icon */}
      <ModelIcon engine={item.preferredEngine} />

      {/* Name + params + badges */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-900">{item.title}</span>
          {params ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{params}</span> : null}
          {item.verified ? (
            <span className="rounded-full bg-mint-100 px-1.5 py-0.5 text-[10px] font-medium text-mint-700">
              {t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}
            </span>
          ) : null}
          {item.installedState.installed ? (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              {t('runtimeConfig.recommend.installedState', { defaultValue: 'Installed' })}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
          <span>{parseProviderFromRepo(item.repo)}</span>
          <span>·</span>
          <span>{lastMod}</span>
        </div>
      </div>

      {/* License */}
      <div className="hidden w-20 shrink-0 text-center md:block">
        {license ? (
          <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${licenseColorClass(license)}`}>{license}</span>
        ) : <span className="text-[11px] text-slate-300">—</span>}
      </div>

      {/* Size */}
      <div className="hidden w-16 shrink-0 text-right md:block">
        <span className="text-xs font-medium text-slate-700">{formatSizeLabel(sizeBytes)}</span>
      </div>

      {/* VRAM % */}
      <div className="hidden w-20 shrink-0 md:block">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 flex-1 rounded-full bg-slate-100">
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

      {/* Context length (pending backend) */}
      <div className="hidden w-16 shrink-0 text-right lg:block">
        <span className="text-[11px] text-slate-400" title={t('runtimeConfig.recommend.ctxLenPending', { defaultValue: 'Context length — data pending' })}>—</span>
      </div>

      {/* Tok/s (pending backend) */}
      <div className="hidden w-20 shrink-0 text-right lg:block">
        <span className="text-[11px] text-slate-400" title={t('runtimeConfig.recommend.tpsPending', { defaultValue: 'Estimated tok/s — data pending' })}>—</span>
      </div>

      {/* Grade badge */}
      <div className="w-28 shrink-0 text-right">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${gradeColorClass(grade)}`}>
          {gradeLabel(grade)}
        </span>
      </div>

      {/* Expand chevron */}
      <svg
        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ModelRowExpanded — inline accordion detail
// ---------------------------------------------------------------------------

export type ModelRowExpandedProps = {
  item: LocalRuntimeRecommendationFeedItemDescriptor;
  totalVramBytes?: number;
  runtimeWritesDisabled: boolean;
  planPreview: LocalRuntimeInstallPlanDescriptor | null;
  planLoading: boolean;
  planError: string;
  variants: LocalRuntimeCatalogVariantDescriptor[];
  variantsLoading: boolean;
  variantsError: string;
  installing: boolean;
  onReviewPlan: (item: LocalRuntimeRecommendationFeedItemDescriptor, options?: { entry?: string; files?: string[]; hashes?: Record<string, string> }) => void;
  onOpenVariants: (item: LocalRuntimeRecommendationFeedItemDescriptor) => void;
  onOpenLocalModels: (item: LocalRuntimeRecommendationFeedItemDescriptor) => void;
  onInstallReviewedPlan: () => void;
};

export function ModelRowExpanded({
  item,
  totalVramBytes,
  runtimeWritesDisabled,
  planPreview,
  planLoading,
  planError,
  variants,
  variantsLoading,
  variantsError,
  installing,
  onReviewPlan,
  onOpenVariants,
  onOpenLocalModels,
  onInstallReviewedPlan,
}: ModelRowExpandedProps) {
  const { t } = useTranslation();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const recommendation = item.recommendation;
  const params = parseParamsFromTitle(item.title);
  const license = parseLicenseShort(item.installPayload.license);
  const provider = parseProviderFromRepo(item.repo);
  const grade = tierToGrade(recommendation?.tier);
  const hfUrl = buildHuggingFaceUrl(item.repo);

  return (
    <div className="rounded-b-2xl border-x border-b border-mint-200/60 bg-gradient-to-b from-mint-50/20 to-white px-5 pb-5 pt-4 space-y-5">
      {/* ① Model Overview Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
          {license ? (
            <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${licenseColorClass(license)}`}>{license}</span>
          ) : null}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{provider}</span>
          {params ? <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">{params}</span> : null}
          {item.verified ? (
            <span className="rounded-full bg-mint-100 px-1.5 py-0.5 text-[10px] font-medium text-mint-700">
              {t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}
            </span>
          ) : null}
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${gradeColorClass(grade)}`}>
            {gradeLabel(grade)}
          </span>
        </div>
        {item.description ? (
          <p className="mt-1.5 text-sm leading-6 text-slate-600 line-clamp-2">{item.description}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
          <a href={hfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mint-600 hover:text-mint-700 hover:underline">
            HuggingFace
            <ExternalLinkIcon />
          </a>
          {item.downloads ? <span className="text-slate-500">{item.downloads.toLocaleString()} downloads</span> : null}
          {typeof item.likes === 'number' ? <span className="text-slate-500">{item.likes.toLocaleString()} likes</span> : null}
          <span className="text-slate-400" title={t('runtimeConfig.recommend.ctxLenPending', { defaultValue: 'Context length — data pending' })}>
            {t('runtimeConfig.recommend.detailContext', { defaultValue: 'Context: —' })}
          </span>
        </div>
      </div>

      {/* ② Quantization Options */}
      {item.entries.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t('runtimeConfig.recommend.quantTitle', { defaultValue: 'Quantization Options' })}
          </h4>
          <div className="overflow-x-auto rounded-xl border border-slate-200/70">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="px-3 py-2 font-medium text-slate-500">{t('runtimeConfig.recommend.quantColQuant', { defaultValue: 'Quant' })}</th>
                  <th className="px-3 py-2 font-medium text-slate-500">{t('runtimeConfig.recommend.quantColBits', { defaultValue: 'Bits' })}</th>
                  <th className="px-3 py-2 font-medium text-slate-500">{t('runtimeConfig.recommend.quantColSize', { defaultValue: 'Size' })}</th>
                  <th className="px-3 py-2 font-medium text-slate-500">{t('runtimeConfig.recommend.quantColVram', { defaultValue: 'VRAM %' })}</th>
                  <th className="px-3 py-2 font-medium text-slate-500">{t('runtimeConfig.recommend.quantColQuality', { defaultValue: 'Quality' })}</th>
                  <th className="px-3 py-2 font-medium text-slate-500" />
                </tr>
              </thead>
              <tbody>
                {item.entries.map((entry) => {
                  const quantLevel = parseQuantLevelFromEntry(entry.entry);
                  const bits = parseQuantBitsFromEntry(entry.entry);
                  const quality = quantQualityLabel(bits);
                  const vramPct = computeVramPercentage(entry.totalSizeBytes, totalVramBytes);
                  const isRecommended = recommendation?.recommendedEntry === entry.entry;
                  return (
                    <tr key={entry.entryId} className={`border-b border-slate-50 transition-colors hover:bg-mint-50/30 ${isRecommended ? 'bg-mint-50/40' : ''}`}>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
                        {quantLevel || entry.entry}
                        {isRecommended ? <span className="ml-1.5 rounded bg-mint-100 px-1 py-0.5 text-[9px] font-medium text-mint-700">{t('runtimeConfig.recommend.quantBest', { defaultValue: 'BEST' })}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{bits ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{formatSizeLabel(entry.totalSizeBytes)}</td>
                      <td className="px-3 py-2">
                        <span className={`font-medium ${vramPercentageColorClass(vramPct)}`}>
                          {vramPct !== null ? `${vramPct}%` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-amber-500">{quality || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onReviewPlan(item, {
                            entry: entry.entry,
                            files: entry.files,
                            hashes: entry.sha256 ? { [entry.entry]: entry.sha256 } : undefined,
                          })}
                        >
                          {t('runtimeConfig.recommend.quantReview', { defaultValue: 'Review' })}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ③ About This Model */}
      {item.description ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t('runtimeConfig.recommend.aboutTitle', { defaultValue: 'About This Model' })}
          </h4>
          <p className="text-sm leading-6 text-slate-600">{item.description}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">{recommendationSummary(recommendation)}</p>
        </div>
      ) : null}

      {/* ④ Highlights */}
      {(item.capabilities.length > 0 || item.tags.length > 0 || item.verified) ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t('runtimeConfig.recommend.highlightsTitle', { defaultValue: 'Highlights' })}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {item.capabilities.map((cap) => (
              <span key={`cap-${cap}`} className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">{cap}</span>
            ))}
            {item.verified ? (
              <span className="rounded-full bg-mint-100 px-2.5 py-1 text-[11px] font-medium text-mint-700">
                {t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}
              </span>
            ) : null}
            {item.formats.map((fmt) => (
              <span key={`fmt-${fmt}`} className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700">{fmt}</span>
            ))}
            {item.tags.map((tag) => (
              <span key={`tag-${tag}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{tag}</span>
            ))}
          </div>
        </div>
      ) : null}

      {/* ⑤ Specifications */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          {t('runtimeConfig.recommend.specsTitle', { defaultValue: 'Specifications' })}
        </h4>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-3">
          <SpecRow label={t('runtimeConfig.recommend.specParams', { defaultValue: 'Parameters' })} value={params || '—'} />
          <SpecRow label={t('runtimeConfig.recommend.specEngine', { defaultValue: 'Engine' })} value={item.preferredEngine || '—'} />
          <SpecRow label={t('runtimeConfig.recommend.specFormats', { defaultValue: 'Formats' })} value={item.formats.join(', ') || '—'} />
          <SpecRow label={t('runtimeConfig.recommend.specLicense', { defaultValue: 'License' })} value={license || '—'} />
          <SpecRow
            label={t('runtimeConfig.recommend.specUpdated', { defaultValue: 'Updated' })}
            value={item.lastModified ? formatRelativeLocaleTime(item.lastModified) : '—'}
          />
          <SpecRow
            label={t('runtimeConfig.recommend.specMinVram', { defaultValue: 'Min VRAM' })}
            value={item.entries.length > 0 ? formatSizeLabel(item.entries.reduce((min, e) => Math.min(min, e.totalSizeBytes), Infinity)) : '—'}
          />
        </div>
      </div>

      {/* ⑥ Install & Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        {item.installedState.installed ? (
          <Button variant="secondary" size="sm" onClick={() => onOpenLocalModels(item)}>
            {t('runtimeConfig.recommend.openLocalModels', { defaultValue: 'Open in Local Models' })}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={!item.actionState.canReviewInstallPlan || planLoading}
              onClick={() => onReviewPlan(item)}
            >
              {planLoading
                ? t('runtimeConfig.recommend.reviewingPlan', { defaultValue: 'Reviewing…' })
                : t('runtimeConfig.recommend.reviewInstallPlan', { defaultValue: 'Review Install Plan' })}
            </Button>
            {item.actionState.canOpenVariants ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={variantsLoading}
                onClick={() => onOpenVariants(item)}
              >
                {variantsLoading
                  ? t('runtimeConfig.recommend.loadingVariants', { defaultValue: 'Loading variants…' })
                  : t('runtimeConfig.recommend.openVariants', { defaultValue: 'Open Variants' })}
              </Button>
            ) : null}
          </>
        )}
        {installing ? (
          <span className="rounded-full bg-mint-100 px-2.5 py-1 text-[11px] font-medium text-mint-700">
            {t('runtimeConfig.recommend.installing', { defaultValue: 'Installing…' })}
          </span>
        ) : runtimeWritesDisabled ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700">
            {t('runtimeConfig.recommend.readOnly', { defaultValue: 'Read-only mode' })}
          </span>
        ) : null}
      </div>

      {/* ⑦ Install Review Panel */}
      {(planPreview || planError) ? (
        <Card className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-none">
          <div className="flex items-center gap-2">
            <PackageIcon className="h-4 w-4 text-mint-600" />
            <h4 className="text-sm font-semibold text-slate-900">
              {t('runtimeConfig.recommend.installPreviewTitle', { defaultValue: 'Install Review' })}
            </h4>
          </div>
          {planError ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{planError}</div>
          ) : null}
          {planPreview ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold text-slate-900">{planPreview.modelId}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{planPreview.repo}</p>
              </div>
              <div className="space-y-1 text-[11px] text-slate-600">
                <p><span className="font-medium text-slate-800">{t('runtimeConfig.recommend.planEngine', { defaultValue: 'Engine' })}:</span> {planPreview.engine}</p>
                <p><span className="font-medium text-slate-800">{t('runtimeConfig.recommend.planEntry', { defaultValue: 'Entry' })}:</span> <span className="font-mono">{planPreview.entry}</span></p>
                <p><span className="font-medium text-slate-800">{t('runtimeConfig.recommend.planFiles', { defaultValue: 'Files' })}:</span> {planPreview.files.length}</p>
                <p><span className="font-medium text-slate-800">{t('runtimeConfig.recommend.planRuntimeMode', { defaultValue: 'Runtime mode' })}:</span> {planPreview.engineRuntimeMode}</p>
              </div>
              {planPreview.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  <p className="font-medium">{t('runtimeConfig.recommend.planWarnings', { defaultValue: 'Warnings' })}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {planPreview.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </div>
              ) : null}
              <Button
                size="sm"
                disabled={runtimeWritesDisabled || installing}
                onClick={onInstallReviewedPlan}
              >
                <span className="inline-flex items-center gap-1.5">
                  <DownloadIcon className="h-4 w-4" />
                  {installing
                    ? t('runtimeConfig.recommend.installing', { defaultValue: 'Installing…' })
                    : t('runtimeConfig.recommend.startInstall', { defaultValue: 'Start Install' })}
                </span>
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Variants (loaded on demand) */}
      {variantsError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{variantsError}</div>
      ) : null}
      {variants.length > 0 ? (
        <Card className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-none">
          <h4 className="text-sm font-semibold text-slate-900">
            {t('runtimeConfig.recommend.variantsTitle', { defaultValue: 'Variants' })}
          </h4>
          <div className="mt-3 space-y-2">
            {variants.map((variant) => (
              <div key={variant.entry || variant.filename} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] text-slate-700">{variant.entry || variant.filename}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {[variant.format || 'unknown', variant.sizeBytes ? formatBytes(variant.sizeBytes) : ''].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {variant.recommendation?.tier ? (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${recommendationTierClass(variant.recommendation.tier)}`}>
                      {recommendationTierLabel(variant.recommendation.tier)}
                    </span>
                  ) : null}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onReviewPlan(item, {
                    entry: variant.entry || variant.filename,
                    files: variant.files,
                    hashes: variant.sha256 ? { [variant.entry || variant.filename]: variant.sha256 } : undefined,
                  })}
                >
                  {t('runtimeConfig.recommend.reviewVariantPlan', { defaultValue: 'Review this variant' })}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ⑧ Diagnostics (collapsible) */}
      <div className="border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => setShowDiagnostics((prev) => !prev)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
        >
          {t('runtimeConfig.recommend.showDiagnostics', { defaultValue: 'Show diagnostics' })}
          <svg className={`h-3 w-3 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        {showDiagnostics ? (
          <div className="mt-3 space-y-3">
            <RecommendationDetailList
              recommendation={recommendation}
              className="space-y-1"
              rowClassName="text-[11px] text-slate-500"
              labelClassName="font-medium text-slate-700"
              valueClassName="text-slate-600"
            />
            <RecommendationDiagnosticsPanel recommendation={recommendation} className="mt-0" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-medium text-slate-500">{label}:</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
