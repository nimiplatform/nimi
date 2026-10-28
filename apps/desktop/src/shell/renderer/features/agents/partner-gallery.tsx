import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, InlineAlert, LoadingSkeleton, Popover, PopoverContent, PopoverTrigger, ScrollArea } from '@nimiplatform/kit/ui';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { ArrowRight, BookOpen, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, MessageCircle, Settings } from 'lucide-react';
import { useAppStore, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useHomeListPosition } from '../../app-shell/providers/use-home-list-position.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type { PartnerDirectoryItem } from './partner-directory-model.js';
import { readPartnerLastChat, selectGalleryPartners, type PartnerGalleryFilter, type PartnerGallerySort } from './partner-gallery-model.js';
import { usePartnerChat } from './use-partner-chat.js';
import { PartnerArtwork, usePartnerMediaVisibility, usePartnerSource } from './partner-media.js';
import './partner-gallery.css';

const P = 'runtimeConfig.partners';
type GalleryProps = {
  partners: readonly PartnerDirectoryItem[];
  accountId: string;
  scopeKey: string;
  query: string;
  active: boolean;
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onRetry(): void;
  onLoadMore(): void;
};

function PartnerActions({ partner, onChat, onDetails, onManage, busy }: {
  partner: PartnerDirectoryItem; busy: boolean; onChat(): void; onDetails(): void; onManage(): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const active = partner.lifecycle === AgentLifecycleStatus.ACTIVE;
  const run = (action: () => void) => { setOpen(false); action(); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button className="partner-more" aria-label={t(`${P}.gallery.more`, { name: partner.displayName })}><Ellipsis size={18} /></button></PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} className="p-1.5">
      <div className="partner-action-list" role="group" aria-label={partner.displayName}>
        <button onClick={() => run(onDetails)}><BookOpen size={16} />{t(`${P}.gallery.viewDetails`)}</button>
        <button disabled={!active || busy} onClick={() => run(onChat)}><MessageCircle size={16} />{t(`${P}.chat`)}</button>
        <button disabled={!active} onClick={() => run(onManage)}><Settings size={16} />{t(`${P}.manage`)}</button>
      </div>
    </PopoverContent>
  </Popover>;
}

function PartnerCard({ partner, accountId, scopeKey, enabled, busy, onChat, onSelect }: {
  partner: PartnerDirectoryItem; accountId: string; scopeKey: string; enabled: boolean; busy: boolean;
  onChat(): void; onSelect(settings?: boolean): void;
}) {
  const { t } = useTranslation();
  const { element, visible } = usePartnerMediaVisibility<HTMLElement>(enabled);
  const source = usePartnerSource(partner, accountId, scopeKey, enabled && visible);
  const name = partner.displayName || t(`${P}.unnamed`);
  const active = partner.lifecycle === AgentLifecycleStatus.ACTIVE;
  return <article ref={element} className="partner-card" data-testid="partner-card">
    <button className="partner-card-open" data-view-key={partner.localAgentRef} aria-label={t(`${P}.gallery.viewPartner`, { name })} onClick={() => onSelect()}>
      <span className="partner-card-image"><PartnerArtwork source={source.data} avatarUrl={source.avatarUrl} name={name} />
        {!active ? <span className="partner-status">{t(`${P}.lifecycle.${partner.lifecycle}`, { defaultValue: t(`${P}.lifecycle.0`) })}</span> : null}
      </span>
      <span className="partner-card-copy"><span className="partner-card-name" title={name}>{name}</span>
        <span className="partner-card-world" title={source.data?.worldName}>{source.data?.worldName ? t(`${P}.gallery.fromWorld`, { name: source.data.worldName })
          : t(source.isPending && partner.sourceRef ? `${P}.sourceLoading` : `${P}.sourceUnavailable`)}</span>
      </span>
    </button>
    <div className="partner-card-actions"><PartnerActions partner={partner} busy={busy} onChat={onChat} onDetails={() => onSelect()} onManage={() => onSelect(true)} /></div>
  </article>;
}

function PartnerHero({ partners, accountId, scopeKey, enabled, busy, onChat, onSelect }: {
  partners: readonly PartnerDirectoryItem[]; accountId: string; scopeKey: string; enabled: boolean; busy: boolean;
  onChat(partner: PartnerDirectoryItem): void; onSelect(partner: PartnerDirectoryItem, settings?: boolean): void;
}) {
  const { t } = useTranslation();
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const index = Math.max(0, partners.findIndex(partner => partner.localAgentRef === selectedRef));
  const partner = partners[index]!;
  const source = usePartnerSource(partner, accountId, scopeKey, enabled);
  const name = partner.displayName || t(`${P}.unnamed`);
  const previous = () => setSelectedRef(partners[(index - 1 + partners.length) % partners.length]!.localAgentRef);
  const next = () => setSelectedRef(partners[(index + 1) % partners.length]!.localAgentRef);
  return <section className="partner-hero" aria-label={t(`${P}.gallery.featured`)} aria-roledescription={t(`${P}.gallery.carousel`)}>
    <button className="partner-hero-image" aria-label={t(`${P}.gallery.viewPartner`, { name })} onClick={() => onSelect(partner)}><PartnerArtwork source={source.data} avatarUrl={source.avatarUrl} name={name} variant="hero" /></button>
    <div className="partner-hero-copy" aria-live="polite" aria-atomic="true">
      <span className="partner-hero-kicker">{t(`${P}.gallery.featured`)}</span>
      <h2><button onClick={() => onSelect(partner)}>{name}</button></h2>
      <p className="partner-hero-world">{source.data?.worldName ? t(`${P}.gallery.fromWorld`, { name: source.data.worldName }) : t(source.isPending && partner.sourceRef ? `${P}.sourceLoading` : `${P}.sourceUnavailable`)}</p>
      <p className="partner-hero-description">{source.data?.summary || t(`${P}.gallery.invitation`)}</p>
      {source.data?.updated ? <p className="partner-source-note">{t(`${P}.sourceUpdated`)}</p> : null}
      <div className="partner-hero-actions">
        <Button tone="primary" className="partner-chat-button" disabled={busy || partner.lifecycle !== AgentLifecycleStatus.ACTIVE} onClick={() => onChat(partner)}>{t(`${P}.chat`)}<ArrowRight size={17} /></Button>
        <PartnerActions partner={partner} busy={busy} onChat={() => onChat(partner)} onDetails={() => onSelect(partner)} onManage={() => onSelect(partner, true)} />
      </div>
    </div>
    {partners.length > 1 ? <><div className="partner-hero-dots" aria-label={t(`${P}.gallery.chooseFeatured`)}>{partners.map((item, position) => <button key={item.localAgentRef} aria-label={t(`${P}.gallery.showFeatured`, { name: item.displayName })} aria-current={position === index ? 'true' : undefined} onClick={() => setSelectedRef(item.localAgentRef)}><span /></button>)}</div>
      <div className="partner-hero-arrows"><button aria-label={t(`${P}.gallery.previous`)} onClick={previous}><ChevronLeft size={18} /></button><button aria-label={t(`${P}.gallery.next`)} onClick={next}><ChevronRight size={18} /></button></div></> : null}
  </section>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function PartnerGallery(props: GalleryProps) {
  const { t } = useTranslation();
  const { sdk } = useDesktopRendererBindings();
  const auth = useAppStore(state => state.auth.status);
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const [filter, setFilter] = useState<PartnerGalleryFilter>('all');
  const [sort, setSort] = useState<PartnerGallerySort>('newest');
  const chat = usePartnerChat(props.accountId);
  const canRead = props.active && auth === 'authenticated';
  const recentQueries = useQueries({ queries: props.partners.map(partner => ({
    queryKey: ['partner-last-chat', props.accountId, props.scopeKey, partner.localAgentRef],
    queryFn: () => readPartnerLastChat(sdk, props.accountId, partner),
    enabled: canRead && filter === 'recent', staleTime: 15_000, retry: false, networkMode: 'always' as const,
  })) });
  const lastChats = new Map(props.partners.map((partner, index) => [partner.localAgentRef, recentQueries[index]?.data ?? null]));
  const searched = props.partners.filter(partner => partner.displayName.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase()));
  const items = selectGalleryPartners({ partners: searched, accountId: props.accountId, filter, sort, lastChats });
  const featured = useMemo(() => selectGalleryPartners({ partners: props.partners.filter(partner => partner.lifecycle === AgentLifecycleStatus.ACTIVE),
    accountId: props.accountId, filter: 'all', sort: 'newest', lastChats: new Map() }).slice(0, 5), [props.partners, props.accountId]);
  const viewport = useHomeListPosition(JSON.stringify(['partner-gallery', props.accountId, props.scopeKey, props.query, filter, sort]), !props.loading);
  const recentLoading = filter === 'recent' && recentQueries.some(query => query.isPending);
  const recentFailed = filter === 'recent' && recentQueries.some(query => query.isError);
  const select = (partner: PartnerDirectoryItem, settings = false) => {
    void navigation.push({ ...destination, partner: { localAgentRef: partner.localAgentRef, ...(settings ? { settingsSection: 'overview' as const } : {}) } });
  };
  return <ScrollArea viewportRef={viewport} className={`min-h-0 min-w-0 flex-1 ${props.active ? 'hidden lg:block' : 'hidden'}`}><div className="partner-gallery" data-partner-gallery="true">
    <header className="partner-gallery-header"><h1>{t(`${P}.title`)}</h1><p>{t(`${P}.gallery.subtitle`)}</p></header>
    {props.error ? <InlineAlert tone="warning" action={<Button size="sm" onClick={props.onRetry}>{t('Common.retry')}</Button>}>{t(`${P}.loadFailed`)}</InlineAlert> : null}
    {chat.failed ? <InlineAlert tone="warning">{t(`${P}.actionFailed`)}</InlineAlert> : null}
    {props.loading ? <LoadingSkeleton lines={6} /> : <>
      {!props.query.trim() && filter === 'all' && featured.length ? <PartnerHero partners={featured} accountId={props.accountId} scopeKey={props.scopeKey} enabled={canRead} busy={Boolean(chat.openingRef)} onChat={partner => { void chat.openChat(partner); }} onSelect={select} /> : null}
      <section className="partner-collection" aria-label={t(`${P}.gallery.collection`)}>
        <div className="partner-collection-toolbar"><h2>{t(`${P}.title`)}</h2>
          <div className="partner-gallery-filters" role="group" aria-label={t(`${P}.gallery.filterLabel`)}>
            {(['all', 'world', 'recent', 'created'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(`${P}.gallery.filters.${value}`)}</button>)}
          </div>
          {filter !== 'recent' ? <label className="partner-gallery-sort"><select aria-label={t(`${P}.gallery.sortLabel`)} value={sort} onChange={event => setSort(event.target.value as PartnerGallerySort)}>
            {(['newest', 'oldest', 'name'] as const).map(value => <option key={value} value={value}>{t(`${P}.gallery.sort.${value}`)}</option>)}
          </select><ChevronDown size={14} aria-hidden="true" /></label> : null}
        </div>
        {recentLoading ? <p className="partner-gallery-notice" role="status">{t(`${P}.gallery.recentLoading`)}</p> : null}
        {recentFailed ? <InlineAlert tone="warning" action={<Button size="sm" onClick={() => { recentQueries.filter(query => query.isError).forEach(query => { void query.refetch(); }); }}>{t('Common.retry')}</Button>}>{t(`${P}.gallery.recentFailed`)}</InlineAlert> : null}
        {items.length ? <div className="partner-gallery-grid">{items.map(partner => <PartnerCard key={partner.localAgentRef} partner={partner} accountId={props.accountId} scopeKey={props.scopeKey} enabled={canRead} busy={Boolean(chat.openingRef)} onChat={() => { void chat.openChat(partner); }} onSelect={settings => select(partner, settings)} />)}</div>
          : !recentLoading && !recentFailed && !props.error ? <EmptyState title={t(!props.partners.length && !props.hasMore ? `${P}.empty` : props.query.trim() ? `${P}.noMatch` : `${P}.gallery.empty.${filter}`)}
            action={!props.partners.length && !props.hasMore ? <Button onClick={() => { void navigation.push({ id: 'explore', exploreSection: 'worlds' }); }}>{t(`${P}.discover`)}</Button> : filter !== 'all' ? <Button onClick={() => setFilter('all')}>{t(`${P}.gallery.showAll`)}</Button> : undefined} /> : null}
        {props.hasMore ? <div className="partner-gallery-pagination"><p>{t(`${P}.partial`, { count: props.partners.length })}</p><Button disabled={props.loadingMore} onClick={props.onLoadMore}>{t(`${P}.loadMore`)}</Button></div> : null}
      </section>
    </>}
  </div></ScrollArea>;
}
