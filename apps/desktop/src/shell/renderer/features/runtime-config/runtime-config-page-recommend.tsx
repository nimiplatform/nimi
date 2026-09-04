import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  InlineAlert,
  SearchField,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import type {
  NimiRuntimeLocalInstallPlanDescriptor,
  NimiRuntimeModelAssetCatalogSearchResult,
  NimiRuntimeModelAssetMarketCandidate,
  NimiRuntimeRecommendationApplicability,
} from '@nimiplatform/sdk/runtime';

import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { formatBytes, formatCompactCount } from './runtime-config-model-center-utils';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import type {
  RuntimeConfigModelMarketContext,
  RuntimeConfigPanelControllerModel,
} from './runtime-config-panel-types';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell';

const MARKET_CATEGORIES = ['chat', 'image', 'video'] as const;
type MarketCategory = typeof MARKET_CATEGORIES[number];

type RecommendPageProps = {
  readonly model: RuntimeConfigPanelControllerModel;
  readonly context: RuntimeConfigModelMarketContext | null;
  readonly onReturnToLoadout: () => void;
};

export function RecommendPage(props: RecommendPageProps) {
  const { t } = useTranslation();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const [category, setCategory] = useState<MarketCategory>('chat');
  const [query, setQuery] = useState('');
  const [selectedSearchResult, setSelectedSearchResult] = useState<NimiRuntimeModelAssetCatalogSearchResult | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<NimiRuntimeModelAssetMarketCandidate | null>(null);
  const normalizedQuery = query.trim();

  useEffect(() => {
    setSelectedSearchResult(null);
    setSelectedCandidate(null);
  }, [category]);

  const featuredQuery = useQuery({
    queryKey: ['model-market', 'featured', category],
    queryFn: () => client.listFeaturedModelAssets({ category, pageSize: 80 }),
    refetchOnWindowFocus: false,
  });
  const searchQuery = useQuery({
    queryKey: ['model-market', 'search', category, normalizedQuery],
    queryFn: () => client.searchCatalog({ query: normalizedQuery, category, pageSize: 50 }),
    enabled: normalizedQuery.length > 0,
    refetchOnWindowFocus: false,
  });

  if (props.context) {
    return (
      <ContextualMarketDetail
        context={props.context}
        model={props.model}
        onBack={props.onReturnToLoadout}
      />
    );
  }
  if (selectedCandidate) {
    return (
      <MarketCandidateDetail
        candidate={selectedCandidate}
        model={props.model}
        onBack={() => setSelectedCandidate(null)}
      />
    );
  }
  if (selectedSearchResult) {
    return (
      <CatalogSearchDetail
        result={selectedSearchResult}
        onBack={() => setSelectedSearchResult(null)}
        onSelectCandidate={setSelectedCandidate}
      />
    );
  }

  const featured = featuredQuery.data;
  const showSearch = normalizedQuery.length > 0;
  const rows = showSearch ? searchQuery.data ?? [] : featured?.items ?? [];
  const showStaleSnapshot = !showSearch && featured?.source.availability === 'available' && featured.source.freshness === 'stale';
  const candidateSourceCount = showSearch
    ? 0
    : new Set((rows as readonly NimiRuntimeModelAssetMarketCandidate[]).map((candidate) => candidate.sourceLabel)).size;

  return (
    <RuntimePageShell>
      <RuntimePageHeader
        title={t('runtimeConfig.sidebar.modelMarket', { defaultValue: 'Model Market' })}
        description={t('runtimeConfig.recommend.marketDescription', {
          defaultValue: 'Discover ModelAssets, inspect an exact variant, then review its Runtime-owned install plan.',
        })}
        actions={showStaleSnapshot ? (
          <StatusBadge
            tone="warning"
            shape="soft"
            title={t('runtimeConfig.recommend.staleNotice', { defaultValue: 'Showing the last successful model recommendation snapshot.' })}
          >
            {t('runtimeConfig.recommend.staleBadge', { defaultValue: 'Snapshot' })}
          </StatusBadge>
        ) : undefined}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-0.5">
          {MARKET_CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${category === value
                ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]'
                : 'text-[var(--nimi-text-muted)]'}`}
            >
              {t(`runtimeConfig.recommend.category.${value}`, { defaultValue: value[0]!.toUpperCase() + value.slice(1) })}
            </button>
          ))}
        </div>
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t('runtimeConfig.recommend.searchPlaceholder', { defaultValue: 'Search the full catalog…' })}
          className="min-w-56 flex-1"
        />
      </div>

      {!showSearch && featured?.source.availability === 'unavailable' ? (
        <InlineAlert tone="warning">
          {t('runtimeConfig.recommend.recommendationsUnavailable', {
            defaultValue: 'Model recommendations are unavailable. Full catalog search is still available.',
          })}
        </InlineAlert>
      ) : null}
      {(showSearch ? searchQuery.isError : featuredQuery.isError) ? (
        <InlineAlert tone="danger">
          {showSearch
            ? t('runtimeConfig.recommend.searchFailed', { defaultValue: 'Catalog search failed.' })
            : t('runtimeConfig.recommend.loadFailed', { defaultValue: 'Model recommendations could not be loaded.' })}
        </InlineAlert>
      ) : null}

      {(showSearch ? searchQuery.isPending : featuredQuery.isPending) ? (
        <p className="text-sm text-[var(--nimi-text-muted)]">{t('Common.loading', { defaultValue: 'Loading…' })}</p>
      ) : rows.length === 0 ? (
        <Surface tone="card" className="border-dashed p-6 text-sm text-[var(--nimi-text-muted)]">
          {showSearch
            ? t('runtimeConfig.recommend.noSearchResults', { defaultValue: 'No catalog models matched this query.' })
            : featured?.source.availability === 'available'
              ? t('runtimeConfig.recommend.recommendationsEmpty', { defaultValue: 'This recommendation snapshot contains no models in the selected category.' })
              : t('runtimeConfig.recommend.searchInstead', { defaultValue: 'Search the catalog to find a model.' })}
        </Surface>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {showSearch
            ? (rows as readonly NimiRuntimeModelAssetCatalogSearchResult[]).map((row) => (
              <SearchResultCard key={row.modelLocator} result={row} onOpen={() => setSelectedSearchResult(row)} />
            ))
            : (rows as readonly NimiRuntimeModelAssetMarketCandidate[]).map((candidate) => (
              <CandidateCard key={candidate.offerRef} candidate={candidate} showSource={candidateSourceCount > 1} onOpen={() => setSelectedCandidate(candidate)} />
            ))}
        </div>
      )}
    </RuntimePageShell>
  );
}

function SearchResultCard(props: {
  readonly result: NimiRuntimeModelAssetCatalogSearchResult;
  readonly onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { result } = props;
  return (
    <button type="button" onClick={props.onOpen} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 text-left shadow-[var(--nimi-elevation-base)] hover:border-[var(--nimi-border-strong)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AuthorAvatar author={result.author} />
            <h3 className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{result.title}</h3>
          </div>
          <p className="mt-1 truncate text-xs text-[var(--nimi-text-muted)]">{result.sourceLabel}</p>
        </div>
        {result.verified ? <div className="shrink-0"><StatusBadge tone="success" shape="soft">{t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}</StatusBadge></div> : null}
      </div>
      {result.description ? <p className="mt-2 line-clamp-2 text-xs text-[var(--nimi-text-secondary)]">{result.description}</p> : null}
      <MarketMeta categories={result.categories} license={result.license} updatedAt={result.lastModified} downloads={result.downloads} likes={result.likes} />
      <p className="mt-3 text-xs font-medium text-[var(--nimi-action-primary-bg)]">
        {t('runtimeConfig.recommend.inspectVariants', { defaultValue: 'Inspect exact variants' })}
      </p>
    </button>
  );
}

function CandidateCard(props: {
  readonly candidate: NimiRuntimeModelAssetMarketCandidate;
  readonly showSource?: boolean;
  readonly onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { candidate } = props;
  // The variant label is the only per-card differentiator (repo title is
  // identical across variants), so it owns the headline. Allow a second
  // wrapped line instead of tail-truncating the quant suffix away.
  const variantTitle = candidate.variantLabel || candidate.title;
  return (
    <button type="button" onClick={props.onOpen} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 text-left shadow-[var(--nimi-elevation-base)] hover:border-[var(--nimi-border-strong)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AuthorAvatar author={candidate.author} />
            <h3 className="line-clamp-2 break-all text-sm font-semibold text-[var(--nimi-text-primary)]" title={variantTitle}>{variantTitle}</h3>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.showSource && candidate.sourceLabel ? <StatusBadge tone="neutral" shape="soft">{candidate.sourceLabel}</StatusBadge> : null}
          {candidate.installed ? <StatusBadge tone="success" shape="soft">{t('runtimeConfig.recommend.installedState', { defaultValue: 'Installed' })}</StatusBadge> : null}
        </div>
      </div>
      {candidate.editorialReason ? <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{candidate.editorialReason}</p> : null}
      <MarketMeta categories={candidate.categories} size={candidate.totalSizeBytes} license={candidate.license} updatedAt={candidate.lastModified} downloads={candidate.downloads} likes={candidate.likes} />
    </button>
  );
}

function CatalogSearchDetail(props: {
  readonly result: NimiRuntimeModelAssetCatalogSearchResult;
  readonly onBack: () => void;
  readonly onSelectCandidate: (candidate: NimiRuntimeModelAssetMarketCandidate) => void;
}) {
  const { t } = useTranslation();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const variants = useQuery({
    queryKey: ['model-market', 'variants', props.result.modelLocator],
    queryFn: () => client.listCatalogVariants(props.result.modelLocator),
    refetchOnWindowFocus: false,
  });
  return (
    <RuntimePageShell>
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('Common.back', { defaultValue: 'Back' })}</Button>
      <RuntimePageHeader title={props.result.title} description={props.result.description} />
      <MarketMeta categories={props.result.categories} license={props.result.license} updatedAt={props.result.lastModified} downloads={props.result.downloads} likes={props.result.likes} />
      <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.variantsTitle', { defaultValue: 'Exact variants' })}</h3>
      {variants.isPending ? <p className="text-sm text-[var(--nimi-text-muted)]">{t('Common.loading', { defaultValue: 'Loading…' })}</p> : null}
      {variants.isError ? <InlineAlert tone="danger">{t('runtimeConfig.recommend.variantsFailed', { defaultValue: 'Variants could not be loaded.' })}</InlineAlert> : null}
      {variants.data?.length === 0 ? <InlineAlert tone="info">{t('runtimeConfig.recommend.variantsUnavailable', { defaultValue: 'No installable variants were returned.' })}</InlineAlert> : null}
      <div className="grid gap-3">
        {variants.data?.map((candidate) => (
          <CandidateCard key={candidate.offerRef} candidate={candidate} onOpen={() => props.onSelectCandidate(candidate)} />
        ))}
      </div>
    </RuntimePageShell>
  );
}

function MarketCandidateDetail(props: {
  readonly candidate: NimiRuntimeModelAssetMarketCandidate;
  readonly model: RuntimeConfigPanelControllerModel;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const [plan, setPlan] = useState<NimiRuntimeLocalInstallPlanDescriptor | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const review = async () => {
    setBusy(true);
    setError('');
    try {
      setPlan(await client.resolveOfferInstallPlan(props.candidate.offerRef));
    } catch (reason) {
      setPlan(null);
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await props.model.installResolvedModelPlan(plan);
      await queryClient.invalidateQueries({ queryKey: ['model-market'] });
      props.onBack();
    } finally {
      setBusy(false);
    }
  };

  return (
    <RuntimePageShell>
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('Common.back', { defaultValue: 'Back' })}</Button>
      <RuntimePageHeader title={props.candidate.title} description={props.candidate.description} />
      <MarketMeta categories={props.candidate.categories} format={props.candidate.format} size={props.candidate.totalSizeBytes} license={props.candidate.license} updatedAt={props.candidate.lastModified} downloads={props.candidate.downloads} likes={props.candidate.likes} />
      {props.candidate.editorialReason ? <InlineAlert tone="info">{props.candidate.editorialReason}</InlineAlert> : null}
      <InstallPlanPanel
        installed={props.candidate.installed}
        installable={props.candidate.installable}
        plan={plan}
        error={error}
        busy={busy}
        runtimeWritesDisabled={props.model.runtimeWritesDisabled}
        onReview={() => { void review(); }}
        onInstall={() => { void install(); }}
        onOpenLocalAssets={() => props.model.onChangePage('localAssets')}
      />
    </RuntimePageShell>
  );
}

function ContextualMarketDetail(props: {
  readonly context: RuntimeConfigModelMarketContext;
  readonly model: RuntimeConfigPanelControllerModel;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const loadouts = useMemo(() => sdk.machineProduct().local.loadouts, [sdk]);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<NimiRuntimeLocalInstallPlanDescriptor | null>(null);
  const [planError, setPlanError] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const recipesQuery = useQuery({
    queryKey: ['model-market', 'recipe-context', props.context.capabilityContract],
    queryFn: () => loadouts.listRecipes(props.context.capabilityContract),
    refetchOnWindowFocus: false,
  });
  const recipe = recipesQuery.data?.find((item) => (
    item.recipeId === props.context.recipeId && item.revision === props.context.recipeRevision
  ));
  const slot = recipe?.slots.find((item) => item.slotId === props.context.slotId);
  const offer = slot?.offers.find((item) => item.candidate.offerRef === props.context.candidate.offerRef);
  const contextValid = Boolean(recipe && slot && offer);

  useEffect(() => {
    setPlan(null);
    setPlanError('');
  }, [props.context.candidate.offerRef]);

  const review = async () => {
    if (!contextValid || offer?.installedModelAssetId || offer?.candidate.installed) return;
    setPlanLoading(true);
    setPlanError('');
    try {
      setPlan(await client.resolveOfferInstallPlan(props.context.candidate.offerRef));
    } catch (error) {
      setPlan(null);
      setPlanError(errorMessage(error));
    } finally {
      setPlanLoading(false);
    }
  };

  const install = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await props.model.installResolvedModelPlan(plan);
      await Promise.all([
        recipesQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['model-market', 'featured'] }),
      ]);
      props.onBack();
    } finally {
      setBusy(false);
    }
  };

  return (
    <RuntimePageShell>
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('runtimeConfig.recommend.backToPlan', { defaultValue: 'Back to capability plan' })}</Button>
      <RuntimePageHeader
        title={props.context.candidate.title || slot?.displayLabel || t('runtimeConfig.recommend.contextTitle', { defaultValue: 'Model for this capability slot' })}
        description={recipe
          ? `${recipe.title} · ${slot?.displayLabel || props.context.slotId} · ${props.context.candidate.variantLabel}`
          : `${props.context.slotId} · ${props.context.candidate.variantLabel}`}
      />
      <MarketMeta
        categories={props.context.candidate.categories}
        format={props.context.candidate.format}
        size={props.context.candidate.totalSizeBytes}
        license={props.context.candidate.license}
        updatedAt={props.context.candidate.lastModified}
        downloads={props.context.candidate.downloads}
        likes={props.context.candidate.likes}
      />
      {recipesQuery.isPending ? <p className="text-sm text-[var(--nimi-text-muted)]">{t('Common.loading', { defaultValue: 'Loading…' })}</p> : null}
      {!recipesQuery.isPending && !contextValid ? (
        <InlineAlert tone="danger">{t('runtimeConfig.recommend.contextInvalid', { defaultValue: 'This offer is no longer admitted for the selected Recipe slot.' })}</InlineAlert>
      ) : null}
      {offer ? <ApplicabilityNotice applicability={offer.applicability} reasons={offer.reasons} /> : null}
      {offer ? (
        <InstallPlanPanel
          installed={Boolean(offer.installedModelAssetId) || offer.candidate.installed}
          installable={offer.applicability !== 'unsupported' && offer.candidate.installable}
          plan={plan}
          error={planError}
          busy={busy || planLoading}
          runtimeWritesDisabled={props.model.runtimeWritesDisabled}
          onReview={() => { void review(); }}
          onInstall={() => { void install(); }}
          onOpenLocalAssets={() => props.model.onChangePage('localAssets')}
        />
      ) : null}
    </RuntimePageShell>
  );
}

function ApplicabilityNotice(props: {
  readonly applicability: NimiRuntimeRecommendationApplicability;
  readonly reasons: readonly string[];
}) {
  const { t } = useTranslation();
  const tone = props.applicability === 'supported' ? 'success' : props.applicability === 'unknown' ? 'warning' : 'danger';
  return (
    <InlineAlert tone={tone}>
      <p>{t(`runtimeConfig.recommend.applicability.${props.applicability}`, { defaultValue: props.applicability })}</p>
      {props.reasons.length > 0 ? <p className="mt-1 font-mono text-xs">{props.reasons.join(' · ')}</p> : null}
    </InlineAlert>
  );
}

function InstallPlanPanel(props: {
  readonly installed: boolean;
  readonly installable: boolean;
  readonly plan: NimiRuntimeLocalInstallPlanDescriptor | null;
  readonly error: string;
  readonly busy: boolean;
  readonly runtimeWritesDisabled: boolean;
  readonly onReview: () => void;
  readonly onInstall: () => void;
  readonly onOpenLocalAssets: () => void;
}) {
  const { t } = useTranslation();
  if (props.installed) {
    return (
      <Surface tone="card" className="flex items-center justify-between gap-3 p-4">
        <span className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.recommend.alreadyInstalled', { defaultValue: 'This exact ModelAsset is installed.' })}</span>
        <Button size="sm" tone="secondary" onClick={props.onOpenLocalAssets}>{t('runtimeConfig.recommend.openLocalAssets', { defaultValue: 'Open Local Assets' })}</Button>
      </Surface>
    );
  }
  return (
    <Surface tone="card" className="space-y-3 p-4">
      {props.error ? <InlineAlert tone="danger">{props.error}</InlineAlert> : null}
      {props.plan ? (
        <div className="space-y-1 text-xs text-[var(--nimi-text-secondary)]">
          <p className="font-semibold text-[var(--nimi-text-primary)]">{props.plan.entry || props.plan.modelId}</p>
          <p>{props.plan.repo}@{props.plan.revision}</p>
          <p>{props.plan.totalSizeBytes ? formatBytes(props.plan.totalSizeBytes) : t('runtimeConfig.recommend.unknownDownloadSize', { defaultValue: 'Download size unknown' })} · {props.plan.files.length} {t('runtimeConfig.recommend.files', { defaultValue: 'files' })}</p>
          {props.plan.warnings.length > 0 ? <p className="text-[var(--nimi-status-warning)]">{props.plan.warnings.join(' · ')}</p> : null}
        </div>
      ) : null}
      {!props.installable ? (
        <p className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.notInstallable', { defaultValue: 'This offer is not installable.' })}</p>
      ) : props.plan ? (
        <Button size="sm" tone="primary" disabled={props.busy || props.runtimeWritesDisabled} onClick={props.onInstall}>
          {t('runtimeConfig.recommend.startInstall', { defaultValue: 'Download and install' })}
        </Button>
      ) : (
        <Button size="sm" tone="primary" disabled={props.busy} onClick={props.onReview}>
          {props.busy
            ? t('runtimeConfig.recommend.reviewingPlan', { defaultValue: 'Reviewing…' })
            : t('runtimeConfig.recommend.reviewInstallPlan', { defaultValue: 'Review install' })}
        </Button>
      )}
    </Surface>
  );
}

// HuggingFace-style market card meta row: one inline line of icon+text items
// joined by dot separators instead of chip badges.
function MarketMeta(props: {
  readonly categories: readonly string[];
  readonly format?: string;
  readonly size?: number;
  readonly license?: string;
  readonly updatedAt?: string;
  readonly downloads?: number;
  readonly likes?: number;
}) {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const items: Array<{ key: string; node: ReactNode }> = [];
  const categoryLabel = props.categories
    .map((value) => t(`runtimeConfig.recommend.capability.${value}`, { defaultValue: value }))
    .join(' / ');
  if (categoryLabel) {
    items.push({
      key: 'category',
      node: (
        <span className="inline-flex items-center gap-1">
          <TaskTypeIcon className="h-3.5 w-3.5" />
          {categoryLabel}
        </span>
      ),
    });
  }
  if (props.format) {
    items.push({ key: 'format', node: <span>{props.format}</span> });
  }
  if (props.size) {
    items.push({ key: 'size', node: <span>{formatBytes(props.size)}</span> });
  }
  if (props.license) {
    items.push({ key: 'license', node: <span>{props.license}</span> });
  }
  if (props.updatedAt) {
    items.push({
      key: 'updated',
      node: <span>{t('runtimeConfig.recommend.updatedAt', { when: i18n.formatRelativeTime(props.updatedAt), defaultValue: 'Updated {{when}}' })}</span>,
    });
  }
  if (props.downloads) {
    items.push({
      key: 'downloads',
      node: (
        <span
          className="inline-flex items-center gap-1"
          title={t('runtimeConfig.recommend.downloads', { count: props.downloads, defaultValue: '{{count}} downloads' })}
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {formatCompactCount(props.downloads)}
        </span>
      ),
    });
  }
  if (props.likes) {
    items.push({
      key: 'likes',
      node: (
        <span
          className="inline-flex items-center gap-1"
          title={t('runtimeConfig.recommend.likes', { count: props.likes, defaultValue: '{{count}} likes' })}
        >
          <HeartIcon className="h-3.5 w-3.5" />
          {formatCompactCount(props.likes)}
        </span>
      ),
    });
  }
  return items.length > 0 ? (
    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--nimi-text-muted)]">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {item.node}
        </Fragment>
      ))}
    </div>
  ) : null;
}

// Local stand-in for organization avatars: deterministic color tile with the
// author's initial, so cards keep the HuggingFace-style org marker without any
// remote image dependency. Swap for an <img> once the model-index feed carries
// real avatar URLs.
function AuthorAvatar(props: { readonly author?: string }) {
  const author = (props.author ?? '').trim();
  const initial = author ? (Array.from(author)[0] ?? '').toUpperCase() : '';
  if (!initial) {
    return null;
  }
  let hash = 0;
  for (const ch of author) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return (
    <span
      aria-hidden="true"
      title={author}
      className="flex h-5 w-5 shrink-0 select-none items-center justify-center rounded-md text-[11px] font-semibold text-white"
      style={{ backgroundColor: `hsl(${hash % 360} 45% 42%)` }}
    >
      {initial}
    </span>
  );
}

function TaskTypeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function HeartIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown Runtime error');
}
