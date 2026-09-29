import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, IconButton, InlineAlert, LoadingSkeleton, StatusBadge } from '@nimiplatform/kit/ui';
import { ArrowRight, Check, ChevronLeft, ChevronRight } from 'lucide-react';

import { formatBytes } from '../../components/download-format.js';
import { ModelFamilyLogoTile } from '../../components/provider-logo-tile.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import {
  groupNimiCollectionItems,
  nimiCollectionPreview,
  nimiCollectionSizeRange,
  type ModelLibraryCategory,
  type NimiCollection,
  type NimiCollectionItem,
  type NimiCollectionRequirement,
  type NimiCollectionVersion,
} from './runtime-config-model-library-collection.js';

/** "2.36–4.70 GB" when both ends share a unit, otherwise both sizes in full. */
export function formatByteRange(min: number, max: number): string {
  if (max <= 0) return '';
  if (min <= 0 || min === max) return formatBytes(max);
  const low = formatBytes(min);
  const high = formatBytes(max);
  const [lowValue, lowUnit] = low.split(' ');
  const [highValue, highUnit] = high.split(' ');
  return lowUnit === highUnit ? `${lowValue}–${highValue} ${highUnit}` : `${low} – ${high}`;
}

function itemTitle(item: NimiCollectionItem, t: TFunction): string {
  if (item.kind === 'model') return item.title;
  return item.roleLabelKey ? t(item.roleLabelKey, { defaultValue: item.roleLabel }) : item.roleLabel;
}

/** Name the brand tile resolves from: the model itself, or the model a part serves. */
function itemBrandName(item: NimiCollectionItem): string {
  return item.kind === 'model' ? item.title : item.usedBy;
}

function itemSubtitle(item: NimiCollectionItem, t: TFunction): string {
  const size = nimiCollectionSizeRange(item);
  if (item.kind === 'part') {
    return [
      item.usedBy ? t('runtimeConfig.modelLibrary.collection.usedBy', { name: item.usedBy }) : '',
      item.versions[0]?.quantLabel ?? '',
      formatByteRange(size.min, size.max),
    ].filter(Boolean).join(' · ');
  }
  return [
    item.capability ? displayRuntimeConfigCapabilityLabel(item.capability, t) : '',
    item.versions.length > 1 ? t('runtimeConfig.modelLibrary.collection.versionCount', { count: item.versions.length }) : '',
    formatByteRange(size.min, size.max),
  ].filter(Boolean).join(' · ');
}

function NimiCollectionTile(props: {
  readonly item: NimiCollectionItem;
  readonly onOpen: () => void;
}) {
  const { t } = useTranslation();
  const title = itemTitle(props.item, t);
  return (
    <button
      type="button"
      data-collection-item={props.item.key}
      onClick={props.onOpen}
      className="flex min-w-0 items-center gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-left shadow-[var(--nimi-elevation-base)] hover:border-[var(--nimi-border-strong)]"
    >
      <ModelFamilyLogoTile name={itemBrandName(props.item)} seed={props.item.seed} label={title} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[var(--nimi-text-primary)]" title={title}>{title}</span>
        <span className="mt-0.5 block truncate text-xs text-[var(--nimi-text-muted)]">{itemSubtitle(props.item, t)}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
    </button>
  );
}

const TILE_GRID_CLASS = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3';

/** The collection preview shows two rows of tiles before "View all". */
const PREVIEW_ROWS = 2;

const GRID_MD_MEDIA_QUERY = '(min-width: 768px)';
const GRID_XL_MEDIA_QUERY = '(min-width: 1280px)';

/** Columns of the tile grid at the current viewport; the widest layout when media queries are unavailable. */
function readGridColumns(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 3;
  if (window.matchMedia(GRID_XL_MEDIA_QUERY).matches) return 3;
  if (window.matchMedia(GRID_MD_MEDIA_QUERY).matches) return 2;
  return 1;
}

function useGridColumns(): number {
  const [columns, setColumns] = useState(readGridColumns);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const update = () => setColumns(readGridColumns());
    const queries = [window.matchMedia(GRID_XL_MEDIA_QUERY), window.matchMedia(GRID_MD_MEDIA_QUERY)];
    for (const query of queries) query.addEventListener('change', update);
    return () => {
      for (const query of queries) query.removeEventListener('change', update);
    };
  }, []);
  return columns;
}

/**
 * Heading row of a discovery section. A preview offers "View all" on the
 * right; the full list leads with a back button to the previews instead.
 */
export function MarketSectionHeader(props: {
  readonly titleId: string;
  readonly title: string;
  readonly count?: number;
  readonly description?: string;
  readonly aside?: ReactNode;
  readonly onBack?: () => void;
  readonly onViewAll?: () => void;
  readonly viewAllTestId?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        {props.onBack ? (
          <IconButton
            size="sm"
            tone="ghost"
            data-testid="model-library-list-back"
            aria-label={t('Common.back', { defaultValue: 'Back' })}
            icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
            onClick={props.onBack}
            className="-ml-2 shrink-0"
          />
        ) : null}
        <div className="min-w-0">
          <h3 id={props.titleId} className="flex items-baseline gap-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
            {props.title}
            {props.count !== undefined ? <span className="text-xs font-normal text-[var(--nimi-text-muted)]">{props.count}</span> : null}
          </h3>
          {props.description ? <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{props.description}</p> : null}
        </div>
      </div>
      {props.aside || props.onViewAll ? (
        <div className="flex shrink-0 items-center gap-3">
          {props.aside}
          {props.onViewAll ? (
            <button
              type="button"
              data-testid={props.viewAllTestId}
              onClick={props.onViewAll}
              className="flex items-center gap-1 text-xs text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-action-primary-bg)]"
            >
              {t('runtimeConfig.modelLibrary.viewAll')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TileGridSkeleton() {
  return (
    <div role="status" aria-live="polite" className={TILE_GRID_CLASS}>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} aria-hidden="true" className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
          <LoadingSkeleton lines={2} className="animate-pulse motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

/** Discovery preview: two rows that sample every category, "View all", and a quiet way to the companion files. */
// @nimi-authority: rule.nimi.desktop.ai-consumption.model-verification-claims
export function NimiCollectionSection(props: {
  readonly collection: NimiCollection;
  readonly category: ModelLibraryCategory;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onOpen: (item: NimiCollectionItem) => void;
  readonly onViewAll: () => void;
  readonly onViewParts: () => void;
}) {
  const { t } = useTranslation();
  const columns = useGridColumns();
  const { models, parts } = props.collection;
  const ready = !props.loading && !props.failed;
  const limit = columns * PREVIEW_ROWS;
  const preview = nimiCollectionPreview(models, props.category, limit);
  return (
    <section data-testid="model-library-nimi-collection" className="space-y-3" aria-labelledby="model-library-nimi-collection-title">
      <MarketSectionHeader
        titleId="model-library-nimi-collection-title"
        title={t('runtimeConfig.modelLibrary.collection.title')}
        count={ready ? models.length : undefined}
        onViewAll={ready && models.length > limit ? props.onViewAll : undefined}
        viewAllTestId="model-library-nimi-view-all"
      />
      {props.failed ? <InlineAlert tone="danger">{t('runtimeConfig.modelLibrary.collection.loadFailed')}</InlineAlert> : null}
      {props.loading ? <TileGridSkeleton /> : null}
      {ready && models.length === 0 ? (
        <p className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.modelLibrary.collection.empty')}</p>
      ) : null}
      {preview.length > 0 ? (
        <div className={TILE_GRID_CLASS}>
          {preview.map((item) => <NimiCollectionTile key={item.key} item={item} onOpen={() => props.onOpen(item)} />)}
        </div>
      ) : null}
      {ready && parts.length > 0 ? (
        <button
          type="button"
          data-testid="model-library-nimi-parts"
          onClick={props.onViewParts}
          className="flex items-center gap-1 text-xs text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-action-primary-bg)]"
        >
          {t('runtimeConfig.modelLibrary.collection.partsEntry', { count: parts.length })}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

/** Every model, or every companion file, of the Nimi collection; All groups them under category headings. */
export function NimiCollectionList(props: {
  readonly kind: 'models' | 'parts';
  readonly items: readonly NimiCollectionItem[];
  readonly category: ModelLibraryCategory;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onOpen: (item: NimiCollectionItem) => void;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation();
  const ready = !props.loading && !props.failed;
  const models = props.kind === 'models';
  const groups = props.category === 'all'
    ? groupNimiCollectionItems(props.items, (item) => item.category)
    : [{ key: props.category, items: props.items }];
  const titleId = models ? 'model-library-nimi-list-title' : 'model-library-nimi-parts-title';
  return (
    <section data-testid={models ? 'model-library-nimi-list' : 'model-library-nimi-parts-list'} className="space-y-3" aria-labelledby={titleId}>
      <MarketSectionHeader
        titleId={titleId}
        title={t(models ? 'runtimeConfig.modelLibrary.collection.title' : 'runtimeConfig.modelLibrary.collection.partsTitle')}
        count={ready ? props.items.length : undefined}
        description={models ? undefined : t('runtimeConfig.modelLibrary.collection.partsHint')}
        onBack={props.onBack}
      />
      {props.failed ? <InlineAlert tone="danger">{t('runtimeConfig.modelLibrary.collection.loadFailed')}</InlineAlert> : null}
      {props.loading ? <TileGridSkeleton /> : null}
      {ready && props.items.length === 0 ? (
        <p className="text-sm text-[var(--nimi-text-muted)]">
          {t(models ? 'runtimeConfig.modelLibrary.collection.empty' : 'runtimeConfig.modelLibrary.collection.partsEmpty')}
        </p>
      ) : null}
      {ready ? groups.map((group) => (
        <div key={group.key} data-collection-group={group.key} className="space-y-2">
          {groups.length > 1 ? (
            <h4 className="flex items-baseline gap-2 pt-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
              {t(`runtimeConfig.recommend.category.${group.key}`)}
              <span className="font-normal text-[var(--nimi-text-muted)]">{group.items.length}</span>
            </h4>
          ) : null}
          <div className={TILE_GRID_CLASS}>
            {group.items.map((item) => <NimiCollectionTile key={item.key} item={item} onOpen={() => props.onOpen(item)} />)}
          </div>
        </div>
      )) : null}
    </section>
  );
}

/** What setting up one capability with the model also prepares, each with its size and the total. */
function NimiCollectionRequirementSection(props: {
  readonly requirement: NimiCollectionRequirement;
  readonly resolveItem: (key: string) => NimiCollectionItem | undefined;
  readonly onOpen: (item: NimiCollectionItem) => void;
}) {
  const { t } = useTranslation();
  const rows = props.requirement.items.flatMap((required) => {
    const item = props.resolveItem(required.key);
    return item ? [{ item, required, size: nimiCollectionSizeRange(required) }] : [];
  });
  // A partial list would understate the setup, so an unknown item hides the whole block.
  if (rows.length === 0 || rows.length !== props.requirement.items.length) return null;
  const total = rows.reduce((sum, row) => ({ min: sum.min + row.size.min, max: sum.max + row.size.max }), { min: 0, max: 0 });
  const titleId = `model-library-nimi-requirements-${props.requirement.capability}`;
  return (
    <section data-testid="model-library-nimi-requirements" data-capability={props.requirement.capability} className="space-y-2" aria-labelledby={titleId}>
      <h2 id={titleId} className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
        {t('runtimeConfig.modelLibrary.collection.alsoPrepared', {
          capability: displayRuntimeConfigCapabilityLabel(props.requirement.capability, t),
        })}
        <span className="text-xs font-normal text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.modelLibrary.collection.alsoPreparedSummary', {
            count: rows.length,
            size: formatByteRange(total.min, total.max),
          })}
        </span>
      </h2>
      <div className="divide-y divide-[var(--nimi-border-subtle)] overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
        {rows.map(({ item, required, size }) => {
          const quant = required.versions.length === 1 ? required.versions[0]?.quantLabel : '';
          return (
            <button
              key={item.key}
              type="button"
              data-requirement-item={item.key}
              onClick={() => props.onOpen(item)}
              className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[var(--nimi-action-ghost-hover)]"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--nimi-text-primary)]">
                {itemTitle(item, t)}
                {quant ? <span className="ml-2 text-xs text-[var(--nimi-text-muted)]">{quant}</span> : null}
              </span>
              <span className="shrink-0 text-sm text-[var(--nimi-text-secondary)]">{formatByteRange(size.min, size.max)}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// @nimi-authority: rule.nimi.runtime.local-compute.r016
export function NimiCollectionDetail(props: {
  readonly item: NimiCollectionItem;
  /** Content ids whose files are already on this device. */
  readonly onDevice: ReadonlySet<string>;
  readonly runtimeWritesDisabled: boolean;
  /** Finds the items a requirement names. */
  readonly resolveItem: (key: string) => NimiCollectionItem | undefined;
  readonly onBack: () => void;
  readonly onOpenItem: (item: NimiCollectionItem) => void;
  readonly onInstall: (templateId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { item } = props;
  const title = itemTitle(item, t);
  const subtitle = item.kind === 'part'
    ? (item.usedBy ? t('runtimeConfig.modelLibrary.collection.usedBy', { name: item.usedBy }) : '')
    : (item.capability ? displayRuntimeConfigCapabilityLabel(item.capability, t) : '');
  const install = async (version: NimiCollectionVersion) => {
    const templateId = version.templateIds[0];
    if (!templateId) return;
    setBusy(version.contentId);
    setError('');
    try {
      await props.onInstall(templateId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-testid="model-library-nimi-detail" className="space-y-4">
      <Button size="sm" tone="ghost" onClick={props.onBack}>{t('Common.back', { defaultValue: 'Back' })}</Button>
      <div className="flex min-w-0 items-center gap-3">
        <ModelFamilyLogoTile name={itemBrandName(item)} seed={item.seed} label={title} size="lg" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="break-words text-xl font-semibold text-[var(--nimi-text-primary)]">{title}</h1>
            <StatusBadge tone="neutral" shape="soft">{t('runtimeConfig.modelLibrary.collection.title')}</StatusBadge>
          </div>
          {subtitle ? <p className="mt-0.5 text-sm text-[var(--nimi-text-muted)]">{subtitle}</p> : null}
        </div>
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <section className="space-y-2" aria-labelledby="model-library-nimi-versions-title">
        <h2 id="model-library-nimi-versions-title" className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.modelLibrary.collection.versionsTitle')}
        </h2>
        <div className="divide-y divide-[var(--nimi-border-subtle)] rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
          {item.versions.map((version) => (
            <div key={version.contentId} data-collection-version={version.templateIds[0]} className="flex min-w-0 items-center gap-3 px-4 py-3">
              {version.quantLabel ? (
                <span className="w-12 shrink-0 text-sm font-semibold text-[var(--nimi-text-primary)]">{version.quantLabel}</span>
              ) : null}
              <span className="min-w-0 flex-1 text-sm text-[var(--nimi-text-secondary)]">{version.sizeBytes ? formatBytes(version.sizeBytes) : ''}</span>
              {props.onDevice.has(version.contentId) ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--nimi-status-success)]">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('runtimeConfig.modelLibrary.collection.onDevice')}
                </span>
              ) : (
                <Button
                  size="sm"
                  tone="secondary"
                  loading={busy === version.contentId}
                  disabled={busy !== null || props.runtimeWritesDisabled}
                  onClick={() => { void install(version); }}
                >
                  {t('runtimeConfig.modelLibrary.collection.download')}
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
      {item.requirements.map((requirement) => (
        <NimiCollectionRequirementSection
          key={requirement.capability}
          requirement={requirement}
          resolveItem={props.resolveItem}
          onOpen={props.onOpenItem}
        />
      ))}
      <details className="rounded-2xl border border-[var(--nimi-border-subtle)] px-4 py-3 text-xs text-[var(--nimi-text-secondary)]">
        <summary className="cursor-pointer select-none text-sm font-medium text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.recommend.technicalDetails')}
        </summary>
        <dl className="mt-2 space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.planRepo')}</dt>
            <dd className="min-w-0 break-all text-right font-mono text-[11px]">{item.revision ? `${item.repo}@${item.revision}` : item.repo}</dd>
          </div>
          {item.license ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.specLicense')}</dt>
              <dd className="min-w-0 break-all text-right font-medium">{item.license}</dd>
            </div>
          ) : null}
          {item.versions.map((version) => (
            <div key={version.contentId} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[var(--nimi-text-muted)]">{version.quantLabel || t('runtimeConfig.recommend.planEntry')}</dt>
              <dd className="min-w-0 break-all text-right font-mono text-[11px]">{version.entry}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
