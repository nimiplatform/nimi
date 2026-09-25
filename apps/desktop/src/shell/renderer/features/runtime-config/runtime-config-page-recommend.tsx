import { formatBytes } from '../../components/download-format.js';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Button,
  InlineAlert,
  LoadingSkeleton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchField,
  SelectField,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import {
  Boxes,
  Filter,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Music,
  Play,
  type LucideIcon,
} from 'lucide-react';
import type {
  NimiRuntimeLocalInstallPlanDescriptor,
  NimiRuntimeModelAssetCatalogSearchResult,
  NimiRuntimeModelAssetMarketCandidate,
  NimiRuntimeRecommendationApplicability,
} from '@nimiplatform/sdk/runtime';

import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { ModelAboutCard } from './runtime-config-model-card';

import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import {
  MarketDetailColumns,
  MarketMeta,
  ModelIdentityHeader,
  ModelMakerLogo,
  ModelSpecsCard,
  ModelStatsCard,
  ModelTagRow,
} from './runtime-config-model-market-detail';
import type { ModelSpecEntry } from './runtime-config-model-market-detail';
import {
  buildNimiCollection,
  communityFeedCategories,
  initialModelLibraryCategory,
  mergeCommunityFeeds,
  MODEL_LIBRARY_CATEGORIES,
  nimiCollectionForCategory,
  onDeviceContentIds,
  type ModelLibraryCategory,
  type NimiCollectionItem,
} from './runtime-config-model-library-collection';
import { NimiCollectionDetail, NimiCollectionSection } from './runtime-config-model-library-collection-view';
import type {
  RuntimeConfigModelMarketContext,
  RuntimeConfigModelMarketSlotContext,
  RuntimeConfigPanelControllerModel,
} from './runtime-config-panel-types';
import { RUNTIME_MODEL_LIBRARY_KEY } from './use-runtime-model-library';

// The market toolbar keeps search, the filter popover, and the sort select on
// one row; the sort trigger shares field tokens with the adjacent search field.
const MARKET_FILTER_TRIGGER_CLASS = 'min-h-9 gap-1.5 rounded-lg border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-2.5 text-xs font-medium text-[var(--nimi-text-secondary)] shadow-none';

// Category chips carry a small glyph per kind; "All" stays text-only.
const CATEGORY_ICONS: Readonly<Record<ModelLibraryCategory, LucideIcon | null>> = {
  all: null,
  chat: MessageSquare,
  image: ImageIcon,
  video: Play,
  voice: Mic,
  music: Music,
  other: Boxes,
};

export function filterModelMarketRows<T extends { title: string; author?: string; license?: string; downloads?: number; totalSizeBytes?: number }>(
  rows: readonly T[], author: string, license: string, sort: string,
): T[] {
  const filtered = rows.filter((row) => (author === 'all' || `author:${row.author}` === author)
    && (license === 'all' || `license:${row.license}` === license));
  if (sort === 'default') return filtered;
  return filtered.sort((a, b) => {
    if (sort === 'downloads') return (b.downloads ?? 0) - (a.downloads ?? 0) || a.title.localeCompare(b.title);
    if (sort === 'size') return (a.totalSizeBytes ?? Infinity) - (b.totalSizeBytes ?? Infinity) || a.title.localeCompare(b.title);
    return a.title.localeCompare(b.title);
  });
}

type RecommendPageProps = {
  readonly model: RuntimeConfigPanelControllerModel;
  readonly context: RuntimeConfigModelMarketContext | null;
  /** Refreshes the downloaded files after a Nimi collection install completes. */
  readonly onModelInstalled: () => Promise<void>;
  readonly onReturnToLoadout: () => void;
  /** Opens the Model Library downloaded tab (installed inventory). */
  readonly onOpenDownloaded: () => void;
};

export function RecommendPage(props: RecommendPageProps) {
  const { t } = useTranslation();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const sdk = useDesktopRendererSdk();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<ModelLibraryCategory>(() => initialModelLibraryCategory(props.context?.capabilityContract));
  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('all');
  const [license, setLicense] = useState('all');
  const [sort, setSort] = useState('default');
  const [selectedSearchResult, setSelectedSearchResult] = useState<NimiRuntimeModelAssetCatalogSearchResult | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<NimiRuntimeModelAssetMarketCandidate | null>(null);
  const [selectedCollectionItem, setSelectedCollectionItem] = useState<NimiCollectionItem | null>(null);
  const normalizedQuery = query.trim();
  const feedCategories = communityFeedCategories(category);
  // Runtime search narrows only by the community feed categories.
  const searchCategory = category !== 'all' ? feedCategories[0] : undefined;

  useEffect(() => {
    setSelectedSearchResult(null);
    setSelectedCandidate(null);
    setSelectedCollectionItem(null);
    setAuthor('all');
    setLicense('all');
  }, [category]);

  const featuredQuery = useQuery({
    queryKey: ['model-market', 'featured', category],
    queryFn: async () => mergeCommunityFeeds(await Promise.all(
      feedCategories.map((value) => client.listFeaturedModelAssets({ category: value, pageSize: 80 })),
    )),
    enabled: feedCategories.length > 0,
    refetchOnWindowFocus: false,
  });
  const searchQuery = useQuery({
    queryKey: ['model-market', 'search', category, normalizedQuery],
    queryFn: () => client.searchCatalog({ query: normalizedQuery, category: searchCategory, pageSize: 50 }),
    enabled: normalizedQuery.length > 0,
    refetchOnWindowFocus: false,
  });
  // The catalog and recipes make up the collection. The installed files only
  // add the on-device mark, so a failed inventory read never hides browsing.
  const catalogQuery = useQuery({
    queryKey: ['model-market', 'collection-catalog'],
    queryFn: () => client.listVerifiedAssets(),
    refetchOnWindowFocus: false,
  });
  const recipesQuery = useQuery({
    queryKey: ['model-market', 'collection-recipes'],
    queryFn: () => sdk.machineProduct().local.loadouts.listRecipes(),
    refetchOnWindowFocus: false,
  });
  const assetsQuery = useQuery({
    queryKey: ['model-market', 'collection-assets'],
    queryFn: () => client.listModelAssets(),
    refetchOnWindowFocus: false,
  });
  const collection = useMemo(
    () => buildNimiCollection({ catalog: catalogQuery.data ?? [], recipes: recipesQuery.data ?? [] }),
    [catalogQuery.data, recipesQuery.data],
  );
  const onDevice = useMemo(() => onDeviceContentIds(assetsQuery.data ?? []), [assetsQuery.data]);

  const installFromCollection = async (templateId: string) => {
    const plan = await client.resolveInstallPlan({ source: 'verified', templateId });
    if (!plan.installAvailable) throw new Error(plan.warnings.join(' · ') || plan.reasonCode);
    const result = await props.model.installResolvedModelPlan(plan);
    if (result.status === 'failed') throw result.error;
    if (result.status === 'completed') {
      await Promise.all([
        props.onModelInstalled(),
        queryClient.invalidateQueries({ queryKey: RUNTIME_MODEL_LIBRARY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['model-market'] }),
      ]);
    }
  };

  if (props.context?.kind === 'slot') {
    return (
      <ContextualMarketDetail
        context={props.context}
        model={props.model}
        onBack={props.onReturnToLoadout}
        onOpenDownloaded={props.onOpenDownloaded}
      />
    );
  }
  if (selectedCollectionItem) {
    return (
      <NimiCollectionDetail
        item={selectedCollectionItem}
        onDevice={onDevice}
        runtimeWritesDisabled={props.model.runtimeWritesDisabled}
        onBack={() => setSelectedCollectionItem(null)}
        onInstall={installFromCollection}
      />
    );
  }
  if (selectedCandidate) {
    return (
      <MarketCandidateDetail
        candidate={selectedCandidate}
        model={props.model}
        onBack={() => setSelectedCandidate(null)}
        onOpenDownloaded={props.onOpenDownloaded}
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
  const rawRows = showSearch ? searchQuery.data?.items ?? [] : featured?.items ?? [];
  const huggingFaceUnavailable = showSearch && Boolean(searchQuery.data?.huggingFaceUnavailable);
  const rows = filterModelMarketRows<NimiRuntimeModelAssetCatalogSearchResult | NimiRuntimeModelAssetMarketCandidate>(rawRows, author, license, sort);
  const authors = [...new Set(rawRows.map((row) => row.author).filter((value): value is string => Boolean(value)))].sort();
  const licenses = [...new Set(rawRows.map((row) => row.license).filter((value): value is string => Boolean(value)))].sort();
  const showStaleSnapshot = !showSearch && featured?.source.availability === 'available' && featured.source.freshness === 'stale';
  const candidateSourceCount = showSearch
    ? 0
    : new Set((rows as readonly NimiRuntimeModelAssetMarketCandidate[]).map((candidate) => candidate.sourceLabel)).size;
  const filtersActive = author !== 'all' || license !== 'all';
  const totalCount = showSearch ? rows.length : collection.models.length + rows.length;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t('runtimeConfig.recommend.searchPlaceholder', { defaultValue: 'Search models' })}
            className="min-h-9 min-w-56 flex-1"
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                tone="secondary"
                active={filtersActive}
                className="min-h-9"
                leadingIcon={<Filter className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                {t('runtimeConfig.recommend.filterButton', { defaultValue: 'Filter' })}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.recommend.filterAuthor')}</span>
                  <SelectField aria-label={t('runtimeConfig.recommend.filterAuthor')} value={author} onValueChange={setAuthor}
                    className="w-full"
                    options={[{ value: 'all', label: t('runtimeConfig.recommend.allAuthors') }, ...authors.map((value) => ({ value: `author:${value}`, label: value }))]} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.recommend.filterLicense')}</span>
                  <SelectField aria-label={t('runtimeConfig.recommend.filterLicense')} value={license} onValueChange={setLicense}
                    className="w-full"
                    options={[{ value: 'all', label: t('runtimeConfig.recommend.allLicenses') }, ...licenses.map((value) => ({ value: `license:${value}`, label: value }))]} />
                </label>
              </div>
            </PopoverContent>
          </Popover>
          <SelectField aria-label={t('runtimeConfig.recommend.sortResults')} value={sort} onValueChange={setSort}
            className="w-auto min-w-36" selectClassName={MARKET_FILTER_TRIGGER_CLASS}
            options={['default', 'title', 'downloads', ...(rawRows.some((row) => 'totalSizeBytes' in row && row.totalSizeBytes) ? ['size'] : [])].map((value) => ({ value, label: t(`runtimeConfig.recommend.resultSort.${value}`) }))} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {MODEL_LIBRARY_CATEGORIES.map((value) => {
            const Icon = CATEGORY_ICONS[value];
            const selected = category === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(value)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors ${selected
                  ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]'
                  : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]'}`}
              >
                {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                {t(`runtimeConfig.recommend.category.${value}`, { defaultValue: value[0]!.toUpperCase() + value.slice(1) })}
              </button>
            );
          })}
          {totalCount > 0 ? (
            <span className="ml-auto text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.recommend.totalCount', { count: totalCount, defaultValue: '{{count}} models' })}
            </span>
          ) : null}
        </div>
      </div>

      {showSearch ? (
        <div className="space-y-4">
          {huggingFaceUnavailable ? (
            <InlineAlert tone="warning">
              {t('runtimeConfig.recommend.hfSearchUnavailable', {
                defaultValue: 'Hugging Face is unavailable. Search is limited to the local catalog.',
              })}
            </InlineAlert>
          ) : null}
          {searchQuery.isError ? (
            <InlineAlert tone="danger">{t('runtimeConfig.recommend.searchFailed', { defaultValue: 'Catalog search failed.' })}</InlineAlert>
          ) : null}
          {searchQuery.isPending ? (
            <ModelMarketLoadingState />
          ) : rows.length === 0 ? (
            searchQuery.isError || huggingFaceUnavailable ? null : (
              <Surface tone="card" className="border-dashed p-6 text-sm text-[var(--nimi-text-muted)]">
                {t('runtimeConfig.recommend.noSearchResults', { defaultValue: 'No catalog models matched this query.' })}
              </Surface>
            )
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {(rows as readonly NimiRuntimeModelAssetCatalogSearchResult[]).map((row) => (
                <SearchResultCard key={row.modelLocator} result={row} onOpen={() => setSelectedSearchResult(row)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <NimiCollectionSection
            collection={nimiCollectionForCategory(collection, category)}
            loading={catalogQuery.isPending || recipesQuery.isPending}
            failed={catalogQuery.isError || recipesQuery.isError}
            onOpen={setSelectedCollectionItem}
          />
          {feedCategories.length > 0 ? (
            <section data-testid="model-library-community" className="space-y-3" aria-labelledby="model-library-community-title">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 id="model-library-community-title" className="flex items-baseline gap-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {t('runtimeConfig.modelLibrary.community.title')}
                    {featured ? <span className="text-xs font-normal text-[var(--nimi-text-muted)]">{featured.items.length}</span> : null}
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.modelLibrary.community.description')}</p>
                </div>
                {showStaleSnapshot ? (
                  <StatusBadge
                    tone="warning"
                    shape="soft"
                    title={t('runtimeConfig.recommend.staleNotice', { defaultValue: 'Showing the last successful model recommendation snapshot.' })}
                  >
                    {t('runtimeConfig.recommend.staleBadge', { defaultValue: 'Snapshot' })}
                  </StatusBadge>
                ) : null}
              </div>
              {featured?.source.availability === 'unavailable' ? (
                <InlineAlert tone="warning">
                  {t('runtimeConfig.recommend.recommendationsUnavailable', {
                    defaultValue: 'Model recommendations are unavailable. Full catalog search is still available.',
                  })}
                </InlineAlert>
              ) : null}
              {featuredQuery.isError ? (
                <InlineAlert tone="danger">{t('runtimeConfig.recommend.loadFailed', { defaultValue: 'Model recommendations could not be loaded.' })}</InlineAlert>
              ) : null}
              {featuredQuery.isPending ? (
                <ModelMarketLoadingState />
              ) : rows.length === 0 ? (
                featuredQuery.isError ? null : (
                  <Surface tone="card" className="border-dashed p-6 text-sm text-[var(--nimi-text-muted)]">
                    {featured?.source.availability === 'available'
                      ? t('runtimeConfig.recommend.recommendationsEmpty', { defaultValue: 'This recommendation snapshot contains no models in the selected category.' })
                      : t('runtimeConfig.recommend.searchInstead', { defaultValue: 'Search the catalog to find a model.' })}
                  </Surface>
                )
              ) : (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {(rows as readonly NimiRuntimeModelAssetMarketCandidate[]).map((candidate) => (
                    <CandidateCard key={candidate.offerRef} candidate={candidate} showSource={candidateSourceCount > 1} onOpen={() => setSelectedCandidate(candidate)} />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.modelLibrary.community.notInCategory')}</p>
          )}
        </>
      )}
    </div>
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
            <ModelMakerLogo author={result.author} tags={result.tags} />
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
            <ModelMakerLogo author={candidate.author} tags={candidate.tags} />
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
    <div className="space-y-4">
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('Common.back', { defaultValue: 'Back' })}</Button>
      <ModelIdentityHeader author={result.author} tags={result.tags} title={result.title} verified={result.verified} />
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
    </div>
  );
}

function MarketCandidateDetail(props: {
  readonly candidate: NimiRuntimeModelAssetMarketCandidate;
  readonly model: RuntimeConfigPanelControllerModel;
  readonly onBack: () => void;
  readonly onOpenDownloaded: () => void;
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
      const result = await props.model.installResolvedModelPlan(plan);
      if (result.status === 'cancelled') {
        return;
      }
      if (result.status === 'failed') {
        setPlan(null);
        setError(errorMessage(result.error));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['model-market'] });
      props.onBack();
    } catch (reason) {
      setPlan(null);
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const candidate = props.candidate;
  return (
    <div className="space-y-4">
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('Common.back', { defaultValue: 'Back' })}</Button>
      <ModelIdentityHeader
        author={candidate.author}
        tags={candidate.tags}
        title={candidate.title}
        verified={candidate.verified}
        actions={(
          <ModelInstallAction
            installed={candidate.installed}
            installable={candidate.installable}
            plan={plan}
            busy={busy}
            runtimeWritesDisabled={props.model.runtimeWritesDisabled}
            onReview={() => { void review(); }}
            onInstall={() => { void install(); }}
            onOpenLocalAssets={props.onOpenDownloaded}
          />
        )}
      />
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
              onReview={() => { void review(); }}
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
    </div>
  );
}

function ContextualMarketDetail(props: {
  readonly context: RuntimeConfigModelMarketSlotContext;
  readonly model: RuntimeConfigPanelControllerModel;
  readonly onBack: () => void;
  readonly onOpenDownloaded: () => void;
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
      const result = await props.model.installResolvedModelPlan(plan);
      if (result.status === 'cancelled') {
        return;
      }
      if (result.status === 'failed') {
        setPlan(null);
        setPlanError(errorMessage(result.error));
        return;
      }
      await Promise.all([
        recipesQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['model-market', 'featured'] }),
      ]);
      props.onBack();
    } catch (error) {
      setPlan(null);
      setPlanError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const candidate = props.context.candidate;
  return (
    <div className="space-y-4">
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('runtimeConfig.recommend.backToPlan', { defaultValue: 'Back to capability plan' })}</Button>
      <ModelIdentityHeader
        author={candidate.author}
        tags={candidate.tags}
        title={candidate.title || slot?.displayLabel || t('runtimeConfig.recommend.contextTitle', { defaultValue: 'Model for this capability slot' })}
        verified={candidate.verified}
        actions={offer ? (
          <ModelInstallAction
            installed={Boolean(offer.installedModelAssetId) || offer.candidate.installed}
            installable={offer.applicability !== 'unsupported' && offer.candidate.installable}
            plan={plan}
            busy={busy || planLoading}
            runtimeWritesDisabled={props.model.runtimeWritesDisabled}
            onReview={() => { void review(); }}
            onInstall={() => { void install(); }}
            onOpenLocalAssets={props.onOpenDownloaded}
          />
        ) : null}
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
                onReview={() => { void review(); }}
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
    </div>
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

// The install entry lives in the detail header so it stays visible without
// scrolling; the panel below only carries resolved plan details, errors, and
// availability notes once a review has run.
export function ModelInstallAction(props: {
  readonly installed: boolean;
  readonly installable: boolean;
  readonly plan: NimiRuntimeLocalInstallPlanDescriptor | null;
  readonly busy: boolean;
  readonly runtimeWritesDisabled: boolean;
  readonly onReview: () => void;
  readonly onInstall: () => void;
  readonly onOpenLocalAssets: () => void;
}) {
  const { t } = useTranslation();
  if (props.installed) {
    return (
      <Button size="sm" tone="secondary" onClick={props.onOpenLocalAssets}>
        {t('runtimeConfig.recommend.openLocalAssets', { defaultValue: 'Open Downloaded' })}
      </Button>
    );
  }
  if (!props.installable) {
    return null;
  }
  if (props.plan) {
    return (
      <Button size="sm" tone="primary" disabled={props.busy || props.runtimeWritesDisabled || !props.plan.installAvailable} onClick={props.onInstall}>
        {t('runtimeConfig.recommend.startInstall', { defaultValue: 'Download and install' })}
      </Button>
    );
  }
  return (
    <Button size="sm" tone="primary" disabled={props.busy} onClick={props.onReview}>
      {props.busy
        ? t('runtimeConfig.recommend.reviewingPlan', { defaultValue: 'Reviewing…' })
        : t('runtimeConfig.recommend.reviewInstallPlan', { defaultValue: 'Review install' })}
    </Button>
  );
}

// @nimi-authority: rule.nimi.runtime.local-compute.r016
export function InstallPlanPanel(props: {
  readonly installed: boolean;
  readonly installable: boolean;
  readonly plan: NimiRuntimeLocalInstallPlanDescriptor | null;
  readonly error: string;
  readonly busy: boolean;
  readonly onReview: () => void;
}) {
  const { t } = useTranslation();
  const plan = props.plan;
  // The header owns the install action, so this card only appears when there
  // is plan detail, an error, or an availability note worth showing.
  if (props.installed || (!plan && !props.error && props.installable)) {
    return null;
  }
  return (
    <Surface tone="card" className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.detailInstallTitle', { defaultValue: 'Install' })}</h3>
        {plan ? (
          <Button size="sm" tone="ghost" disabled={props.busy} onClick={props.onReview}>
            {t('runtimeConfig.recommend.reviewInstallPlan', { defaultValue: 'Review install' })}
          </Button>
        ) : null}
      </div>
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
              value={plan.totalSizeBytes ? formatBytes(plan.totalSizeBytes) : t('runtimeConfig.local.unknownDownloadSize')}
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
      ) : null}
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
