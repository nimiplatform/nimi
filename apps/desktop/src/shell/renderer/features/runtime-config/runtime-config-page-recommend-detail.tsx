import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeLocaleTime } from '@renderer/i18n';
import {
  localRuntime,
  type LocalRuntimeAssetKind,
  type LocalRuntimeCatalogVariantDescriptor,
  type LocalRuntimeInstallPayload,
  type LocalRuntimeInstallPlanDescriptor,
  type LocalRuntimeRecommendationFeedItemDescriptor,
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
  quantQualityColorClass,
  quantQualityLabel,
  tierToGrade,
  vramPercentageColorClass,
} from './runtime-config-page-recommend-utils';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendDetailPageProps = {
  item: LocalRuntimeRecommendationFeedItemDescriptor;
  totalVramBytes?: number;
  model: RuntimeConfigPanelControllerModel;
  onBack: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferKindFromCapabilities(capabilities: string[]): LocalRuntimeAssetKind {
  if (capabilities.includes('image')) return 'image';
  if (capabilities.includes('video')) return 'video';
  if (capabilities.includes('tts')) return 'tts';
  if (capabilities.includes('stt')) return 'stt';
  if (capabilities.includes('embedding') || capabilities.includes('text.embed')) return 'embedding';
  return 'chat';
}

function installPayloadFromPlan(plan: LocalRuntimeInstallPlanDescriptor): LocalRuntimeInstallPayload {
  return {
    modelId: plan.modelId,
    kind: inferKindFromCapabilities(plan.capabilities),
    repo: plan.repo,
    revision: plan.revision,
    capabilities: plan.capabilities,
    engine: plan.engine,
    entry: plan.entry,
    files: plan.files,
    license: plan.license,
    hashes: plan.hashes,
    endpoint: plan.endpoint,
    engineConfig: plan.engineConfig,
  };
}

function resolveInstallPlanPayload(
  item: LocalRuntimeRecommendationFeedItemDescriptor,
  options?: { entry?: string; files?: string[]; hashes?: Record<string, string> },
) {
  return {
    source: item.source,
    modelId: item.installPayload.modelId,
    repo: item.installPayload.repo,
    revision: item.installPayload.revision,
    capabilities: item.installPayload.capabilities,
    engine: item.installPayload.engine,
    entry: options?.entry || item.installPayload.entry,
    files: options?.files || item.installPayload.files,
    license: item.installPayload.license,
    hashes: options?.hashes || item.installPayload.hashes,
    endpoint: item.installPayload.endpoint,
    engineConfig: item.installPayload.engineConfig,
  };
}

function formatSizeLabel(sizeBytes: number): string {
  return sizeBytes > 0 ? formatBytes(sizeBytes) : '\u2014';
}

// ---------------------------------------------------------------------------
// RecommendDetailPage — full-page model detail (canirun.ai style)
// ---------------------------------------------------------------------------

export function RecommendDetailPage({ item, totalVramBytes, model, onBack }: RecommendDetailPageProps) {
  const { t } = useTranslation();

  // Plan / variants / install state
  const [planPreview, setPlanPreview] = useState<LocalRuntimeInstallPlanDescriptor | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');
  const [variants, setVariants] = useState<LocalRuntimeCatalogVariantDescriptor[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState('');
  const [installing, setInstalling] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const recommendation = item.recommendation;
  const params = parseParamsFromTitle(item.title);
  const license = parseLicenseShort(item.installPayload.license);
  const provider = parseProviderFromRepo(item.repo);
  const grade = tierToGrade(recommendation?.tier);
  const hfUrl = buildHuggingFaceUrl(item.repo);

  // Actions
  const reviewInstallPlan = useCallback(async (
    options?: { entry?: string; files?: string[]; hashes?: Record<string, string> },
  ) => {
    setPlanLoading(true);
    setPlanError('');
    try {
      const plan = await localRuntime.resolveInstallPlan(resolveInstallPlanPayload(item, options));
      setPlanPreview(plan);
    } catch (err) {
      setPlanPreview(null);
      setPlanError(err instanceof Error ? err.message : String(err || 'Failed to resolve install plan.'));
    } finally {
      setPlanLoading(false);
    }
  }, [item]);

  const openVariants = useCallback(async () => {
    setVariantsLoading(true);
    setVariantsError('');
    try {
      const rows = await localRuntime.listRepoVariants(item.repo);
      setVariants(rows);
    } catch (err) {
      setVariants([]);
      setVariantsError(err instanceof Error ? err.message : String(err || 'Failed to load variants.'));
    } finally {
      setVariantsLoading(false);
    }
  }, [item.repo]);

  const installReviewedPlan = useCallback(async () => {
    if (!planPreview) return;
    setInstalling(true);
    try {
      await model.installLocalModel(installPayloadFromPlan(planPreview));
    } finally {
      setInstalling(false);
    }
  }, [model, planPreview]);

  const openLocalModels = useCallback(() => {
    model.setLocalModelQuery(item.title || item.installPayload.modelId);
    model.onChangePage('local');
  }, [model, item]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Back navigation */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)] transition-colors"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        {t('runtimeConfig.recommend.backToList', { defaultValue: 'Back to models' })}
      </button>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="mt-1 shrink-0">
            <ModelIcon engine={item.preferredEngine} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-[var(--nimi-text-primary)]">{item.title}</h1>

            {/* License sub-line */}
            {license ? (
              <div className="mt-1 flex items-center gap-2">
                <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${licenseColorClass(license)}`}>{license}</span>
              </div>
            ) : null}

            {/* Meta tags row */}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--nimi-text-muted)]">
              <span className="font-medium text-[var(--nimi-text-secondary)]">{provider}</span>
              <span className="text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]">&middot;</span>
              {params ? (
                <>
                  <span className="font-medium text-[var(--nimi-text-secondary)]">{params}</span>
                  <span className="text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]">&middot;</span>
                </>
              ) : null}
              <span>{item.preferredEngine}</span>
            </div>

            {/* Tagline / summary */}
            <p className="mt-3 text-sm leading-6 text-[var(--nimi-text-secondary)]">
              {recommendationSummary(recommendation)}
            </p>

            {/* External links */}
            <div className="mt-3 flex items-center gap-4">
              <a
                href={hfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] transition-colors"
              >
                HuggingFace
                <ExternalLinkIcon />
              </a>
            </div>
          </div>

          {/* Grade badge (top-right) */}
          <div className="shrink-0">
            <span className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold ${gradeColorClass(grade)}`}>
              {gradeLabel(grade)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Stats row ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-[var(--nimi-border-subtle)]/70 bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/50 px-5 py-3">
        {item.downloads ? (
          <StatBlock label={t('runtimeConfig.recommend.detailStatDownloads', { defaultValue: 'Downloads' })} value={item.downloads.toLocaleString()} />
        ) : null}
        {typeof item.likes === 'number' ? (
          <StatBlock label={t('runtimeConfig.recommend.detailStatLikes', { defaultValue: 'Likes' })} value={item.likes.toLocaleString()} />
        ) : null}
        {item.lastModified ? (
          <StatBlock label={t('runtimeConfig.recommend.detailStatReleased', { defaultValue: 'Released' })} value={formatRelativeLocaleTime(item.lastModified)} />
        ) : null}
        <StatBlock
          label={t('runtimeConfig.recommend.detailStatContext', { defaultValue: 'Context' })}
          value="\u2014"
          title={t('runtimeConfig.recommend.ctxLenPending', { defaultValue: 'Context length \u2014 data pending' })}
        />
      </div>

      {/* ── Use Cases ─────────────────────────────────────────────────── */}
      {item.capabilities.length > 0 ? (
        <div>
          <SectionHeading>{t('runtimeConfig.recommend.detailUseCases', { defaultValue: 'Use Cases' })}</SectionHeading>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.capabilities.map((cap) => (
              <span key={cap} className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] px-3.5 py-1.5 text-xs font-medium text-[var(--nimi-status-info)]">{cap}</span>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Quantization Table ────────────────────────────────────────── */}
      {item.entries.length > 0 ? (
        <div>
          <SectionHeading>{t('runtimeConfig.recommend.quantTitle', { defaultValue: 'Quantization Options' })}</SectionHeading>
          <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--nimi-border-subtle)]/70">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/80 text-xs">
                  <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.quantColQuant', { defaultValue: 'Quant' })}</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.quantColBits', { defaultValue: 'Bits' })}</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">VRAM</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.quantColQuality', { defaultValue: 'Quality' })}</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.detailQuantStatus', { defaultValue: 'Status' })}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {item.entries.map((entry) => {
                  const quantLevel = parseQuantLevelFromEntry(entry.entry);
                  const bits = parseQuantBitsFromEntry(entry.entry);
                  const quality = quantQualityLabel(bits);
                  const qualityColor = quantQualityColorClass(quality);
                  const vramPct = computeVramPercentage(entry.totalSizeBytes, totalVramBytes);
                  const isRecommended = recommendation?.recommendedEntry === entry.entry;
                  return (
                    <tr key={entry.entryId} className={`border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_52%,transparent)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/80 ${isRecommended ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30' : ''}`}>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-medium text-[var(--nimi-text-primary)]">{quantLevel || entry.entry}</span>
                        {isRecommended ? (
                          <span className="ml-2 rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--nimi-action-primary-bg)]">
                            {t('runtimeConfig.recommend.quantBest', { defaultValue: 'BEST' })}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--nimi-text-secondary)]">{bits ?? '\u2014'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">{formatSizeLabel(entry.totalSizeBytes)}</span>
                          {vramPct !== null ? (
                            <span className={`text-[10px] font-medium ${vramPercentageColorClass(vramPct)}`}>({vramPct}%)</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {quality ? (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${qualityColor}`}>{quality}</span>
                        ) : <span className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{'\u2014'}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{'\u2014'}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void reviewInstallPlan({
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

      {/* ── About ─────────────────────────────────────────────────────── */}
      {item.description ? (
        <div>
          <SectionHeading>{t('runtimeConfig.recommend.aboutTitle', { defaultValue: 'About This Model' })}</SectionHeading>
          <p className="mt-2 text-sm leading-7 text-[var(--nimi-text-secondary)]">{item.description}</p>
        </div>
      ) : null}

      {/* ── Highlights (tags + formats) ───────────────────────────────── */}
      {(item.tags.length > 0 || item.formats.length > 0 || item.verified) ? (
        <div>
          <SectionHeading>{t('runtimeConfig.recommend.highlightsTitle', { defaultValue: 'Highlights' })}</SectionHeading>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.verified ? (
              <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-action-primary-bg)]">
                {t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}
              </span>
            ) : null}
            {item.formats.map((fmt) => (
              <span key={`fmt-${fmt}`} className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700">{fmt}</span>
            ))}
            {item.tags.map((tag) => (
              <span key={`tag-${tag}`} className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]">{tag}</span>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Specifications ────────────────────────────────────────────── */}
      <div>
        <SectionHeading>{t('runtimeConfig.recommend.specsTitle', { defaultValue: 'Specifications' })}</SectionHeading>
        <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-3 rounded-xl border border-[var(--nimi-border-subtle)]/70 bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/50 p-5 text-sm sm:grid-cols-3">
          <SpecRow label={t('runtimeConfig.recommend.specParams', { defaultValue: 'Parameters' })} value={params || '\u2014'} />
          <SpecRow label={t('runtimeConfig.recommend.specEngine', { defaultValue: 'Engine' })} value={item.preferredEngine || '\u2014'} />
          <SpecRow
            label={t('runtimeConfig.recommend.specMinVram', { defaultValue: 'Min VRAM' })}
            value={item.entries.length > 0 ? formatSizeLabel(item.entries.reduce((min, e) => Math.min(min, e.totalSizeBytes), Infinity)) : '\u2014'}
          />
          <SpecRow
            label={t('runtimeConfig.recommend.detailSpecRecommendedVram', { defaultValue: 'Recommended' })}
            value={item.entries.length > 0 ? formatSizeLabel(item.entries.reduce((max, e) => Math.max(max, e.totalSizeBytes), 0)) : '\u2014'}
          />
          <SpecRow label={t('runtimeConfig.recommend.specLicense', { defaultValue: 'License' })} value={license || '\u2014'} />
          <SpecRow label={t('runtimeConfig.recommend.specFormats', { defaultValue: 'Formats' })} value={item.formats.join(', ') || '\u2014'} />
          <SpecRow
            label={t('runtimeConfig.recommend.specUpdated', { defaultValue: 'Updated' })}
            value={item.lastModified ? formatRelativeLocaleTime(item.lastModified) : '\u2014'}
          />
          <SpecRow
            label={t('runtimeConfig.recommend.detailSpecContext', { defaultValue: 'Context' })}
            value="\u2014"
          />
        </div>
      </div>

      {/* ── Install Section ───────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeading>{t('runtimeConfig.recommend.detailInstallTitle', { defaultValue: 'Install' })}</SectionHeading>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {item.installedState.installed ? (
            <Button variant="secondary" size="sm" onClick={openLocalModels}>
              {t('runtimeConfig.recommend.openLocalModels', { defaultValue: 'Open in Local Models' })}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={!item.actionState.canReviewInstallPlan || planLoading}
                onClick={() => void reviewInstallPlan()}
              >
                {planLoading
                  ? t('runtimeConfig.recommend.reviewingPlan', { defaultValue: 'Reviewing\u2026' })
                  : t('runtimeConfig.recommend.reviewInstallPlan', { defaultValue: 'Review Install Plan' })}
              </Button>
              {item.actionState.canOpenVariants ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={variantsLoading}
                  onClick={() => void openVariants()}
                >
                  {variantsLoading
                    ? t('runtimeConfig.recommend.loadingVariants', { defaultValue: 'Loading variants\u2026' })
                    : t('runtimeConfig.recommend.openVariants', { defaultValue: 'Open Variants' })}
                </Button>
              ) : null}
            </>
          )}
          {installing ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-action-primary-bg)]">
              {t('runtimeConfig.recommend.installing', { defaultValue: 'Installing\u2026' })}
            </span>
          ) : model.runtimeWritesDisabled ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-status-warning)]">
              {t('runtimeConfig.recommend.readOnly', { defaultValue: 'Read-only mode' })}
            </span>
          ) : null}
        </div>

        {/* Install Plan Review */}
        {(planPreview || planError) ? (
          <Card className="rounded-xl border border-[var(--nimi-border-subtle)]/70 bg-white p-5 shadow-none">
            <div className="flex items-center gap-2 mb-3">
              <PackageIcon className="h-4 w-4 text-[var(--nimi-action-primary-bg)]" />
              <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.recommend.installPreviewTitle', { defaultValue: 'Install Review' })}
              </h4>
            </div>
            {planError ? (
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">{planError}</div>
            ) : null}
            {planPreview ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-3">
                  <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{planPreview.modelId}</p>
                  <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{planPreview.repo}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-[var(--nimi-text-secondary)] sm:grid-cols-4">
                  <div>
                    <span className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.planEngine', { defaultValue: 'Engine' })}</span>
                    <p className="mt-0.5">{planPreview.engine}</p>
                  </div>
                  <div>
                    <span className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.planEntry', { defaultValue: 'Entry' })}</span>
                    <p className="mt-0.5 font-mono">{planPreview.entry}</p>
                  </div>
                  <div>
                    <span className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.planFiles', { defaultValue: 'Files' })}</span>
                    <p className="mt-0.5">{planPreview.files.length}</p>
                  </div>
                  <div>
                    <span className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.planRuntimeMode', { defaultValue: 'Runtime mode' })}</span>
                    <p className="mt-0.5">{planPreview.engineRuntimeMode}</p>
                  </div>
                </div>
                {planPreview.warnings.length > 0 ? (
                  <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] px-4 py-3 text-xs text-[var(--nimi-status-warning)]">
                    <p className="font-medium">{t('runtimeConfig.recommend.planWarnings', { defaultValue: 'Warnings' })}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {planPreview.warnings.map((w) => <li key={w}>{w}</li>)}
                    </ul>
                  </div>
                ) : null}
                <Button
                  size="sm"
                  disabled={model.runtimeWritesDisabled || installing}
                  onClick={() => void installReviewedPlan()}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <DownloadIcon className="h-4 w-4" />
                    {installing
                      ? t('runtimeConfig.recommend.installing', { defaultValue: 'Installing\u2026' })
                      : t('runtimeConfig.recommend.startInstall', { defaultValue: 'Start Install' })}
                  </span>
                </Button>
              </div>
            ) : null}
          </Card>
        ) : null}

        {/* Variants */}
        {variantsError ? (
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">{variantsError}</div>
        ) : null}
        {variants.length > 0 ? (
          <Card className="rounded-xl border border-[var(--nimi-border-subtle)]/70 bg-white p-5 shadow-none">
            <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)] mb-3">
              {t('runtimeConfig.recommend.variantsTitle', { defaultValue: 'Variants' })}
            </h4>
            <div className="space-y-2">
              {variants.map((variant) => (
                <div key={variant.entry || variant.filename} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-[var(--nimi-text-secondary)]">{variant.entry || variant.filename}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--nimi-text-muted)]">
                      {[variant.format || 'unknown', variant.sizeBytes ? formatBytes(variant.sizeBytes) : ''].filter(Boolean).join(' \u00b7 ')}
                    </p>
                  </div>
                  {variant.recommendation?.tier ? (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${recommendationTierClass(variant.recommendation.tier)}`}>
                      {recommendationTierLabel(variant.recommendation.tier)}
                    </span>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void reviewInstallPlan({
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
      </div>

      {/* ── Hardware Detection (placeholder) ──────────────────────────── */}
      {totalVramBytes ? (
        <div className="rounded-xl border border-[var(--nimi-border-subtle)]/70 bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/50 px-5 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.recommend.detailHardware', { defaultValue: 'Your Hardware' })}
          </h4>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">
            VRAM: {formatBytes(totalVramBytes)}
          </p>
        </div>
      ) : null}

      {/* ── Diagnostics (collapsible) ─────────────────────────────────── */}
      <div className="border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] pt-4">
        <button
          type="button"
          onClick={() => setShowDiagnostics((prev) => !prev)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)] transition-colors"
        >
          {t('runtimeConfig.recommend.showDiagnostics', { defaultValue: 'Show diagnostics' })}
          <svg className={`h-3 w-3 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        {showDiagnostics ? (
          <div className="mt-3 space-y-3">
            <RecommendationDetailList
              recommendation={recommendation}
              className="space-y-1"
              rowClassName="text-xs text-[var(--nimi-text-muted)]"
              labelClassName="font-medium text-[var(--nimi-text-secondary)]"
              valueClassName="text-[var(--nimi-text-secondary)]"
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-bold text-[var(--nimi-text-primary)]">{children}</h3>;
}

function StatBlock({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{label}</span>
      <span className="text-sm font-bold text-[var(--nimi-text-primary)]">{value}</span>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs font-medium text-[var(--nimi-text-muted)]">{label}</span>
      <p className="mt-0.5 text-sm font-medium text-[var(--nimi-text-primary)]">{value}</p>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
