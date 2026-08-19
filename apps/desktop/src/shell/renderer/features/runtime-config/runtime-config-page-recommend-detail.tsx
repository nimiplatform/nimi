import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import {
  type NimiRuntimeLocalRecommendationFeedItem,
} from '@nimiplatform/sdk/runtime';
import { ModelIcon } from './runtime-config-local-model-center-icons';
import { SectionTitle } from './runtime-config-primitives';
import {
  RecommendationDetailList,
  RecommendationDiagnosticsPanel,
  recommendationSummary,
} from './runtime-config-local-model-center-helpers';
import {
  RecommendInstallSection,
  useRecommendInstallController,
} from './runtime-config-page-recommend-install-section';
import { RecommendQuantizationTable } from './runtime-config-recommend-quantization-table';
import { formatBytes } from './runtime-config-model-center-utils';
import {
  buildHuggingFaceUrl,
  licenseColorClass,
  parseParamsFromTitle,
  parseLicenseShort,
  formatRepoOwnerFromRepo,
  recommendationTier,
  recommendationTierColorClass,
  recommendationTierI18nKey,
  recommendationTierLabel,
} from './runtime-config-page-recommend-utils';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendDetailPageProps = {
  item: NimiRuntimeLocalRecommendationFeedItem;
  totalVramBytes?: number;
  model: RuntimeConfigPanelControllerModel;
  onBack: () => void;
};

function formatSizeLabel(sizeBytes: number): string {
  return sizeBytes > 0 ? formatBytes(sizeBytes) : '\u2014';
}

// ---------------------------------------------------------------------------
// RecommendDetailPage — full-page model detail (canirun.ai style)
// ---------------------------------------------------------------------------

export function RecommendDetailPage({ item, totalVramBytes, model, onBack }: RecommendDetailPageProps) {
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const installController = useRecommendInstallController({ item, model });
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const recommendation = item.recommendation;
  const params = parseParamsFromTitle(item.title);
  const license = parseLicenseShort(item.installPayload.license);
  const provider = formatRepoOwnerFromRepo(item.repo);
  const tier = recommendationTier(recommendation?.tier);
  const hfUrl = buildHuggingFaceUrl(item.repo);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 pb-4">
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
            <h1 className="text-xl font-semibold text-[var(--nimi-text-primary)]">{item.title}</h1>

            {/* License sub-line */}
            {license ? (
              <div className="mt-1 flex items-center gap-2">
                <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${licenseColorClass(license)}`}>{license}</span>
              </div>
            ) : null}

            {/* Meta tags row */}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--nimi-text-muted)]">
              <span className="font-medium text-[var(--nimi-text-secondary)]">{provider}</span>
              <span className="text-[var(--nimi-text-muted)]">&middot;</span>
              {params ? (
                <>
                  <span className="font-medium text-[var(--nimi-text-secondary)]">{params}</span>
                  <span className="text-[var(--nimi-text-muted)]">&middot;</span>
                </>
              ) : null}
              <span>{item.preferredEngine}</span>
            </div>

            {/* Tagline / summary */}
            <p className="mt-3 text-sm leading-6 text-[var(--nimi-text-secondary)]">
              {recommendationSummary(recommendation, t)}
            </p>

            {/* External links */}
            <div className="mt-3 flex items-center gap-4">
              <a
                href={hfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)] hover:bg-[var(--nimi-surface-panel)] transition-colors"
              >
                HuggingFace
                <ExternalLinkIcon />
              </a>
            </div>
          </div>

          {/* Runtime recommendation (top-right) */}
          <div className="shrink-0">
            <span className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold ${recommendationTierColorClass(tier)}`}>
              {t(`runtimeConfig.recommend.${recommendationTierI18nKey(tier)}`, { defaultValue: recommendationTierLabel(tier) })}
            </span>
          </div>
        </div>
      </div>

      {/* ── Stats row ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-5 py-3">
        {item.downloads ? (
          <StatBlock label={t('runtimeConfig.recommend.detailStatDownloads', { defaultValue: 'Downloads' })} value={item.downloads.toLocaleString()} />
        ) : null}
        {typeof item.likes === 'number' ? (
          <StatBlock label={t('runtimeConfig.recommend.detailStatLikes', { defaultValue: 'Likes' })} value={item.likes.toLocaleString()} />
        ) : null}
        {item.lastModified ? (
          <StatBlock label={t('runtimeConfig.recommend.detailStatReleased', { defaultValue: 'Released' })} value={i18n.formatRelativeTime(item.lastModified)} />
        ) : null}
      </div>

      {/* ── Use Cases ─────────────────────────────────────────────────── */}
      {item.capabilities.length > 0 ? (
        <div>
          <SectionTitle>{t('runtimeConfig.recommend.detailUseCases', { defaultValue: 'Use Cases' })}</SectionTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.capabilities.map((cap) => (
              <span key={cap} className="rounded-full bg-[var(--nimi-status-info-soft-bg)] px-3.5 py-1.5 text-xs font-medium text-[var(--nimi-status-info-soft-text)]">{cap}</span>
            ))}
          </div>
        </div>
      ) : null}

      <RecommendQuantizationTable
        item={item}
        totalVramBytes={totalVramBytes}
        onReviewInstallPlan={(options) => void installController.reviewInstallPlan(options)}
      />

      {/* ── About ─────────────────────────────────────────────────────── */}
      {item.description ? (
        <div>
          <SectionTitle>{t('runtimeConfig.recommend.aboutTitle', { defaultValue: 'About This Model' })}</SectionTitle>
          <p className="mt-2 text-sm leading-7 text-[var(--nimi-text-secondary)]">{item.description}</p>
        </div>
      ) : null}

      {/* ── Highlights (tags + formats) ───────────────────────────────── */}
      {(item.tags.length > 0 || item.formats.length > 0 || item.verified) ? (
        <div>
          <SectionTitle>{t('runtimeConfig.recommend.highlightsTitle', { defaultValue: 'Highlights' })}</SectionTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.verified ? (
              <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-action-primary-bg)]">
                {t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}
              </span>
            ) : null}
            {item.formats.map((fmt) => (
              <span key={`fmt-${fmt}`} className="rounded-full bg-[var(--nimi-status-info-soft-bg)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-info-soft-text)]">{fmt}</span>
            ))}
            {item.tags.map((tag) => (
              <span key={`tag-${tag}`} className="rounded-full bg-[var(--nimi-surface-panel)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]">{tag}</span>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Specifications ────────────────────────────────────────────── */}
      <div>
        <SectionTitle>{t('runtimeConfig.recommend.specsTitle', { defaultValue: 'Specifications' })}</SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-3 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-5 text-sm sm:grid-cols-3">
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
            value={item.lastModified ? i18n.formatRelativeTime(item.lastModified) : '\u2014'}
          />
        </div>
      </div>

      {/* ── Install Section ───────────────────────────────────────────── */}
      <RecommendInstallSection item={item} model={model} controller={installController} />

      {/* ── Hardware Detection (placeholder) ──────────────────────────── */}
      {totalVramBytes ? (
        <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-5 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.recommend.detailHardware', { defaultValue: 'Your Hardware' })}
          </h4>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">
            VRAM: {formatBytes(totalVramBytes)}
          </p>
        </div>
      ) : null}

      {/* ── Diagnostics (collapsible) ─────────────────────────────────── */}
      <div className="border-t border-[var(--nimi-border-subtle)] pt-4">
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

function StatBlock({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-wider text-[var(--nimi-text-muted)]">{label}</span>
      <span className="text-sm font-bold text-[var(--nimi-text-primary)]">{value}</span>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  // Hide empty fields instead of rendering an em-dash placeholder.
  if (!value || value === '\u2014') return null;
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
