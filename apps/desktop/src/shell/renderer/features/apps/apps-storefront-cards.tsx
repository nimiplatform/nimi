// AppsHome Storefront discovery grid with explicit distinction between
// "no cover declared" (normal icon card) and "cover failed to load" (error state).
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042c

import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff, RotateCw, Sparkles } from 'lucide-react';
import { Button, Surface } from '@nimiplatform/kit/ui';
import type { DesktopAppGroup } from './apps-entry-groups.js';
import type { AppCardActionId } from './apps-card-actions.js';
import { AppArtworkIcon } from './apps-card-visuals.js';
import { CAPABILITY_COPY_KEYS } from './apps-ai-config-section.js';
import {
  STOREFRONT_CATEGORIES,
  formatPackageByteSize,
  resolveEntryOrigin,
  resolvePackageStorefrontView,
  type ProductOriginId,
} from './apps-storefront.js';

export interface AppsDiscoveryGridProps {
  readonly groups: readonly DesktopAppGroup[];
  readonly actionDispatcherFor: (entryKey: string) => (action: AppCardActionId) => void;
}

export function AppsDiscoveryGrid({
  groups,
  actionDispatcherFor,
}: AppsDiscoveryGridProps): ReactElement | null {
  const { t, i18n } = useTranslation();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [originFilter, setOriginFilter] = useState<string>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<string>('all');

  const cards = useMemo(() => groups.map((group) => {
    const primary = group.primary;
    const sf = resolvePackageStorefrontView(primary, i18n.language);
    const origin = resolveEntryOrigin(primary);
    const capabilities = primary.appInfo?.capabilityContractRefs
      ?? primary.catalogTarget?.capabilityContractRefs
      ?? primary.localDevelopment?.capabilityContractRefs
      ?? [];
    const sizeLabel = primary.committedRelease ? null : formatPackageByteSize(primary.catalogTarget?.assetSize);
    return { group, primary, sf, origin, capabilities, sizeLabel };
  }), [groups, i18n.language]);

  const availableCategories = useMemo(() => {
    const present = new Set(cards.map((c) => c.sf.category).filter(Boolean) as string[]);
    return STOREFRONT_CATEGORIES.filter((cat) => present.has(cat));
  }, [cards]);

  const availableOrigins = useMemo(() => {
    const order: readonly ProductOriginId[] = ['nimi-official', 'open-source-adapted', 'community'];
    const present = new Set(cards.map((c) => c.origin).filter(Boolean) as ProductOriginId[]);
    return order.filter((o) => present.has(o));
  }, [cards]);

  const availableCapabilities = useMemo(() => {
    const present = new Set<string>();
    for (const c of cards) {
      for (const cap of c.capabilities) {
        if (CAPABILITY_COPY_KEYS[cap]) present.add(cap);
      }
    }
    return [...present].sort();
  }, [cards]);

  const filtered = useMemo(() => cards.filter((card) => {
    if (categoryFilter !== 'all' && card.sf.category !== categoryFilter) return false;
    if (originFilter !== 'all' && card.origin !== originFilter) return false;
    if (capabilityFilter !== 'all' && !card.capabilities.includes(capabilityFilter)) return false;
    return true;
  }), [cards, categoryFilter, originFilter, capabilityFilter]);

  if (groups.length === 0) return null;

  const hasActiveFilter = categoryFilter !== 'all' || originFilter !== 'all' || capabilityFilter !== 'all';

  return (
    <Surface
      as="section"
      tone="card"
      padding="none"
      className="desktop-module-card"
      data-testid="apps-home-discover"
      aria-label={t('Apps.storefront.filter.discoverTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="desktop-module-section-title flex items-baseline gap-2">
          <span>{t('Apps.storefront.filter.discoverTitle')}</span>
          <span className="text-xs font-normal text-[color:var(--nimi-text-muted)]">
            {t('Apps.library.allAppsCount', { count: filtered.length })}
          </span>
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          {availableOrigins.length > 0 ? (
            <select
              aria-label={t('Apps.storefront.filter.allOrigins')}
              data-testid="apps-discover-origin-filter"
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value)}
              className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-2.5 py-1 text-xs text-[color:var(--nimi-text-primary)]"
            >
              <option value="all">{t('Apps.storefront.filter.allOrigins')}</option>
              {availableOrigins.map((origin) => (
                <option key={origin} value={origin}>{t(`Apps.storefront.origin.${origin}`)}</option>
              ))}
            </select>
          ) : null}

          {availableCapabilities.length > 0 ? (
            <select
              aria-label={t('Apps.storefront.filter.allCapabilities')}
              data-testid="apps-discover-capability-filter"
              value={capabilityFilter}
              onChange={(e) => setCapabilityFilter(e.target.value)}
              className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-2.5 py-1 text-xs text-[color:var(--nimi-text-primary)]"
            >
              <option value="all">{t('Apps.storefront.filter.allCapabilities')}</option>
              {availableCapabilities.map((cap) => (
                <option key={cap} value={cap}>{t(CAPABILITY_COPY_KEYS[cap]!.label)}</option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {availableCategories.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t('Apps.storefront.category.all')}>
          <button
            type="button"
            data-testid="apps-discover-category-all"
            onClick={() => setCategoryFilter('all')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              categoryFilter === 'all'
                ? 'bg-[var(--nimi-action-primary-bg)] text-white'
                : 'border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-[color:var(--nimi-text-secondary)] hover:text-[color:var(--nimi-text-primary)]'
            }`}
          >
            {t('Apps.storefront.category.all')}
          </button>
          {availableCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              data-testid={`apps-discover-category-${cat}`}
              onClick={() => setCategoryFilter(cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                categoryFilter === cat
                  ? 'bg-[var(--nimi-action-primary-bg)] text-white'
                  : 'border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-[color:var(--nimi-text-secondary)] hover:text-[color:var(--nimi-text-primary)]'
              }`}
            >
              {t(`Apps.storefront.category.${cat}`)}
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="mt-5 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--nimi-border-subtle)] py-10 text-center">
          <p className="text-sm text-[color:var(--nimi-text-secondary)]">{t('Apps.storefront.filter.discoverEmpty')}</p>
          {hasActiveFilter ? (
            <Button
              tone="secondary"
              size="sm"
              onClick={() => {
                setCategoryFilter('all');
                setOriginFilter('all');
                setCapabilityFilter('all');
              }}
            >
              {t('Apps.storefront.filter.clearFilters')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((card) => (
            <DiscoveryAppCard
              key={card.group.appId}
              card={card}
              onOpen={() => actionDispatcherFor(card.primary.identity.entryKey)('details')}
            />
          ))}
        </div>
      )}
    </Surface>
  );
}

function DiscoveryAppCard({
  card,
  onOpen,
}: {
  readonly card: {
    readonly group: DesktopAppGroup;
    readonly primary: DesktopAppGroup['primary'];
    readonly sf: ReturnType<typeof resolvePackageStorefrontView>;
    readonly origin: ProductOriginId | null;
    readonly capabilities: readonly string[];
    readonly sizeLabel: string | null;
  };
  readonly onOpen: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [retry, setRetry] = useState(0);
  const [failedAtAttempt, setFailedAtAttempt] = useState<number | null>(null);
  const coverUrl = card.sf.coverUrl;
  const coverFailed = coverUrl !== null && failedAtAttempt === retry;
  const release = card.primary.committedRelease;
  let sourceLabel = card.sizeLabel ?? t('Apps.action.details');
  if (release) sourceLabel = t('Apps.version.installed', { version: release.version });
  if (card.primary.localDevelopment) sourceLabel = t('Apps.sourceBadge.localDevelopment');

  return (
    <article
      data-testid={`apps-discover-card-${card.group.appId}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_86%,transparent)] transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_45%,var(--nimi-border-subtle))]"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[linear-gradient(135deg,color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,var(--nimi-surface-active)),color-mix(in_srgb,var(--nimi-surface-card)_92%,transparent))]">
        {coverUrl ? (
          coverFailed ? (
            <div
              data-testid={`apps-discover-cover-error-${card.group.appId}`}
              className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center"
            >
              <ImageOff className="h-6 w-6 text-[color:var(--nimi-text-muted)]" aria-hidden="true" />
              <span className="text-xs text-[color:var(--nimi-text-secondary)]">
                {t('Apps.storefront.imageLoadFailed')}
              </span>
              <Button
                tone="ghost"
                size="sm"
                leadingIcon={<RotateCw className="h-3 w-3" aria-hidden="true" />}
                onClick={(event) => {
                  event.stopPropagation();
                  setRetry((n) => n + 1);
                }}
              >
                {t('Apps.storefront.imageRetry')}
              </Button>
            </div>
          ) : (
            <button type="button" onClick={onOpen} className="block h-full w-full text-left">
              <img
                key={`${coverUrl}:${retry}`}
                src={retry > 0 ? `${coverUrl}?retry=${retry}` : coverUrl}
                alt={card.sf.displayName}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                onError={() => setFailedAtAttempt(retry)}
              />
            </button>
          )
        ) : (
          /* Intentional branded icon card when an unmigrated app has no storefront cover (NOT a load error). */
          <button
            type="button"
            data-testid={`apps-discover-icon-cover-${card.group.appId}`}
            onClick={onOpen}
            className="flex h-full w-full items-center justify-center"
          >
            <AppArtworkIcon
              appId={card.group.appId}
              displayName={card.sf.displayName}
              iconUrl={card.group.iconUrl}
              size="detail"
              className="shadow-md"
            />
          </button>
        )}

        {card.origin ? (
          <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {t(`Apps.storefront.origin.${card.origin}`)}
          </span>
        ) : null}
      </div>

      <button type="button" onClick={onOpen} className="flex flex-1 flex-col gap-2 p-3.5 text-left">
        <div className="flex items-start gap-2.5">
          {coverUrl ? (
            <AppArtworkIcon
              appId={card.group.appId}
              displayName={card.sf.displayName}
              iconUrl={card.group.iconUrl}
              size="sm"
              className="mt-0.5 shrink-0"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-[color:var(--nimi-text-primary)]">
              {card.sf.displayName}
            </h3>
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[color:var(--nimi-text-secondary)]">
              {card.sf.summary || card.group.appId}
            </p>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-[color:var(--nimi-text-muted)]">
          <span className="inline-flex items-center gap-1 truncate">
            {card.capabilities.length > 0 && CAPABILITY_COPY_KEYS[card.capabilities[0]!] ? (
              <>
                <Sparkles className="h-3 w-3 shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
                <span className="truncate">{t(CAPABILITY_COPY_KEYS[card.capabilities[0]!]!.label)}</span>
              </>
            ) : (
              <span>{card.sf.category ? t(`Apps.storefront.category.${card.sf.category}`) : ''}</span>
            )}
          </span>
          <span className="shrink-0 font-medium text-[color:var(--nimi-text-secondary)]">
            {sourceLabel}
          </span>
        </div>
      </button>
    </article>
  );
}
