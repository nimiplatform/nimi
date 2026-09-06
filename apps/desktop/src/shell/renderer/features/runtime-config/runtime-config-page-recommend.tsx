import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Button,
  InlineAlert,
  LoadingSkeleton,
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
import { ModelAboutCard } from './runtime-config-model-card';
import { formatBytes } from './runtime-config-model-center-utils';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import {
  AuthorAvatar,
  MarketDetailColumns,
  MarketMeta,
  ModelIdentityHeader,
  ModelSpecsCard,
  ModelStatsCard,
  ModelTagRow,
} from './runtime-config-model-market-detail';
import type { ModelSpecEntry } from './runtime-config-model-market-detail';
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
        <ModelMarketLoadingState />
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

function ModelMarketLoadingState() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 shadow-[var(--nimi-elevation-base)]">
        <span
          className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--nimi-border-strong)] border-t-transparent"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.recommend.loadingTitle', { defaultValue: 'Fetching the latest model market data…' })}
          </p>
          <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.recommend.loadingDescription', { defaultValue: 'Syncing catalog recommendations and installable variants. This usually takes a few seconds.' })}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]"
          >
            <LoadingSkeleton lines={3} className="animate-pulse motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
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
  const result = props.result;
  return (
    <RuntimePageShell>
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('Common.back', { defaultValue: 'Back' })}</Button>
      <ModelIdentityHeader author={result.author} title={result.title} verified={result.verified} />
      <MarketMeta categories={result.categories} license={result.license} updatedAt={result.lastModified} downloads={result.downloads} likes={result.likes} />
      <ModelTagRow tags={result.tags} />
      <MarketDetailColumns
        main={(
          <>
            <ModelAboutCard modelLocator={result.modelLocator} />
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.variantsTitle', { defaultValue: 'Exact variants' })}</h3>
              {variants.isPending ? <p className="text-sm text-[var(--nimi-text-muted)]">{t('Common.loading', { defaultValue: 'Loading…' })}</p> : null}
              {variants.isError ? <InlineAlert tone="danger">{t('runtimeConfig.recommend.variantsFailed', { defaultValue: 'Variants could not be loaded.' })}</InlineAlert> : null}
              {variants.data?.length === 0 ? <InlineAlert tone="info">{t('runtimeConfig.recommend.variantsUnavailable', { defaultValue: 'No installable variants were returned.' })}</InlineAlert> : null}
              <div className="grid gap-3">
                {variants.data?.map((candidate) => (
                  <CandidateCard key={candidate.offerRef} candidate={candidate} onOpen={() => props.onSelectCandidate(candidate)} />
                ))}
              </div>
            </section>
          </>
        )}
        sidebar={(
          <>
            <ModelStatsCard downloads={result.downloads} likes={result.likes} updatedAt={result.lastModified} />
            <ModelSpecsCard
              title={t('runtimeConfig.recommend.specsTitle', { defaultValue: 'Specifications' })}
              entries={searchResultSpecEntries(result, t)}
            />
          </>
        )}
      />
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

  const candidate = props.candidate;
  return (
    <RuntimePageShell>
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('Common.back', { defaultValue: 'Back' })}</Button>
      <ModelIdentityHeader author={candidate.author} title={candidate.title} verified={candidate.verified} />
      <MarketMeta categories={candidate.categories} format={candidate.format} size={candidate.totalSizeBytes} license={candidate.license} updatedAt={candidate.lastModified} downloads={candidate.downloads} likes={candidate.likes} />
      <ModelTagRow tags={candidate.tags} />
      {candidate.editorialReason ? <InlineAlert tone="info">{candidate.editorialReason}</InlineAlert> : null}
      <MarketDetailColumns
        main={(
          <>
            <ModelAboutCard offerRef={candidate.offerRef} />
            <InstallPlanPanel
              installed={candidate.installed}
              installable={candidate.installable}
              plan={plan}
              error={error}
              busy={busy}
              runtimeWritesDisabled={props.model.runtimeWritesDisabled}
              onReview={() => { void review(); }}
              onInstall={() => { void install(); }}
              onOpenLocalAssets={() => props.model.onChangePage('localAssets')}
            />
          </>
        )}
        sidebar={(
          <>
            <ModelStatsCard downloads={candidate.downloads} likes={candidate.likes} updatedAt={candidate.lastModified} installed={candidate.installed} />
            <ModelSpecsCard
              title={t('runtimeConfig.recommend.specsTitle', { defaultValue: 'Specifications' })}
              entries={candidateSpecEntries(candidate, t)}
            />
          </>
        )}
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

  const candidate = props.context.candidate;
  return (
    <RuntimePageShell>
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('runtimeConfig.recommend.backToPlan', { defaultValue: 'Back to capability plan' })}</Button>
      <ModelIdentityHeader
        author={candidate.author}
        title={candidate.title || slot?.displayLabel || t('runtimeConfig.recommend.contextTitle', { defaultValue: 'Model for this capability slot' })}
        verified={candidate.verified}
      />
      <p className="text-sm text-[var(--nimi-text-muted)]">
        {recipe
          ? `${recipe.title} · ${slot?.displayLabel || props.context.slotId} · ${candidate.variantLabel}`
          : `${props.context.slotId} · ${candidate.variantLabel}`}
      </p>
      <MarketMeta
        categories={candidate.categories}
        format={candidate.format}
        size={candidate.totalSizeBytes}
        license={candidate.license}
        updatedAt={candidate.lastModified}
        downloads={candidate.downloads}
        likes={candidate.likes}
      />
      <ModelTagRow tags={candidate.tags} />
      {recipesQuery.isPending ? <p className="text-sm text-[var(--nimi-text-muted)]">{t('Common.loading', { defaultValue: 'Loading…' })}</p> : null}
      {!recipesQuery.isPending && !contextValid ? (
        <InlineAlert tone="danger">{t('runtimeConfig.recommend.contextInvalid', { defaultValue: 'This offer is no longer admitted for the selected Recipe slot.' })}</InlineAlert>
      ) : null}
      {offer ? <ApplicabilityNotice applicability={offer.applicability} reasons={offer.reasons} /> : null}
      {offer ? (
        <MarketDetailColumns
          main={(
            <>
              <ModelAboutCard offerRef={candidate.offerRef} />
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
            </>
          )}
          sidebar={(
            <>
              <ModelStatsCard
                downloads={candidate.downloads}
                likes={candidate.likes}
                updatedAt={candidate.lastModified}
                installed={Boolean(offer.installedModelAssetId) || offer.candidate.installed}
              />
              <ModelSpecsCard
                title={t('runtimeConfig.recommend.specsTitle', { defaultValue: 'Specifications' })}
                entries={candidateSpecEntries(candidate, t)}
              />
            </>
          )}
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
  const plan = props.plan;
  return (
    <Surface tone="card" className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.detailInstallTitle', { defaultValue: 'Install' })}</h3>
      {props.error ? <InlineAlert tone="danger">{props.error}</InlineAlert> : null}
      {plan ? (
        <div className="space-y-2 text-xs text-[var(--nimi-text-secondary)]">
          <p className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.installPlanReady', { defaultValue: 'Install plan ready' })}</p>
          <dl className="space-y-1.5">
            <PlanRow label={t('runtimeConfig.recommend.planEntry', { defaultValue: 'Entry' })} value={plan.entry || plan.modelId} mono />
            <PlanRow label={t('runtimeConfig.recommend.planRepo', { defaultValue: 'Repo' })} value={plan.repo ? `${plan.repo}@${plan.revision}` : ''} mono />
            {plan.engine ? <PlanRow label={t('runtimeConfig.recommend.planEngine', { defaultValue: 'Engine' })} value={plan.engine} /> : null}
            <PlanRow
              label={t('runtimeConfig.recommend.colSize', { defaultValue: 'Size' })}
              value={plan.totalSizeBytes ? formatBytes(plan.totalSizeBytes) : t('runtimeConfig.recommend.unknownDownloadSize', { defaultValue: 'Download size unknown' })}
            />
            <PlanRow label={t('runtimeConfig.recommend.planFiles', { defaultValue: 'File count' })} value={String(plan.files.length)} />
            {plan.license ? <PlanRow label={t('runtimeConfig.recommend.specLicense', { defaultValue: 'License' })} value={plan.license} /> : null}
          </dl>
          {plan.files.length > 0 ? (
            <details className="rounded-lg border border-[var(--nimi-border-subtle)] px-2.5 py-1.5">
              <summary className="cursor-pointer select-none font-medium text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.recommend.planFileList', { count: plan.files.length, defaultValue: '{{count}} files' })}
              </summary>
              <ul className="mt-1.5 max-h-44 space-y-0.5 overflow-auto font-mono text-[11px] text-[var(--nimi-text-muted)]">
                {plan.files.map((file) => (
                  <li key={file} className="break-all">{file}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {plan.warnings.length > 0 ? (
            <p className="text-[var(--nimi-status-warning)]">
              {t('runtimeConfig.recommend.planWarnings', { defaultValue: 'Warnings' })}: {plan.warnings.join(' · ')}
            </p>
          ) : null}
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

function PlanRow(props: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[var(--nimi-text-muted)]">{props.label}</dt>
      <dd className={`min-w-0 break-all text-right ${props.mono ? 'font-mono text-[11px]' : 'font-medium'}`}>{props.value}</dd>
    </div>
  );
}

function categoryLabels(categories: readonly string[], t: TFunction): string {
  return categories
    .map((value) => t(`runtimeConfig.recommend.capability.${value}`, { defaultValue: value }))
    .join(' / ');
}

function searchResultSpecEntries(result: NimiRuntimeModelAssetCatalogSearchResult, t: TFunction): ModelSpecEntry[] {
  return [
    { key: 'capability', label: t('runtimeConfig.recommend.capabilityLabel', { defaultValue: 'Capability' }), value: categoryLabels(result.categories, t) },
    { key: 'modelType', label: t('runtimeConfig.recommend.specModelType', { defaultValue: 'Model Type' }), value: result.modelType },
    { key: 'license', label: t('runtimeConfig.recommend.specLicense', { defaultValue: 'License' }), value: result.license },
    { key: 'author', label: t('runtimeConfig.recommend.specAuthor', { defaultValue: 'Author' }), value: result.author },
    { key: 'source', label: t('runtimeConfig.recommend.specSource', { defaultValue: 'Source' }), value: result.sourceLabel },
  ];
}

function candidateSpecEntries(candidate: NimiRuntimeModelAssetMarketCandidate, t: TFunction): ModelSpecEntry[] {
  return [
    { key: 'capability', label: t('runtimeConfig.recommend.capabilityLabel', { defaultValue: 'Capability' }), value: categoryLabels(candidate.categories, t) },
    { key: 'variant', label: t('runtimeConfig.recommend.specVariant', { defaultValue: 'Variant' }), value: candidate.variantLabel },
    { key: 'format', label: t('runtimeConfig.recommend.specFormats', { defaultValue: 'Formats' }), value: candidate.format },
    { key: 'modelType', label: t('runtimeConfig.recommend.specModelType', { defaultValue: 'Model Type' }), value: candidate.modelType },
    { key: 'size', label: t('runtimeConfig.recommend.colSize', { defaultValue: 'Size' }), value: candidate.totalSizeBytes ? formatBytes(candidate.totalSizeBytes) : undefined },
    { key: 'license', label: t('runtimeConfig.recommend.specLicense', { defaultValue: 'License' }), value: candidate.license },
    { key: 'author', label: t('runtimeConfig.recommend.specAuthor', { defaultValue: 'Author' }), value: candidate.author },
    { key: 'source', label: t('runtimeConfig.recommend.specSource', { defaultValue: 'Source' }), value: candidate.sourceLabel },
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown Runtime error');
}
