import { useLayoutEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, InlineAlert, LoadingSkeleton, ScrollArea, SearchField, SidebarShell } from '@nimiplatform/kit/ui';
import { ArrowLeft } from 'lucide-react';
import { PartnerDetails } from './partner-details.js';
import { useAppStore, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useHomeListPosition } from '../../app-shell/providers/use-home-list-position.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { partnerDirectoryQueryKey, readPartnerDirectoryPage } from './partner-directory-model.js';
import { PartnerGallery } from './partner-gallery.js';
import { PartnerDirectoryRow } from './partner-directory-row.js';
import './partner-directory.css';

const P = 'runtimeConfig.partners';

export function PartnerDirectory() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const auth = useAppStore(state => state.auth);
  const realm = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const accountId = String(auth.user?.id ?? '');
  const selectedRef = destination.partner?.localAgentRef ?? '';
  const query = destination.partnerQuery ?? '';
  const inventory = useInfiniteQuery({
    queryKey: [...partnerDirectoryQueryKey(accountId, realm), auth.authorizationRevision],
    queryFn: ({ pageParam }) => readPartnerDirectoryPage(bindings.sdk, accountId, pageParam),
    initialPageParam: '', getNextPageParam: page => page.nextPageToken || undefined,
    enabled: auth.status === 'authenticated', staleTime: 15_000, networkMode: 'always',
  });
  const partners = useMemo(() => [...new Map((inventory.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.localAgentRef, item])).values()], [inventory.data]);
  const visible = partners.filter(partner => partner.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const viewport = useHomeListPosition(JSON.stringify(['partners', accountId, realm, query]), !inventory.isPending);
  const heading = useRef<HTMLHeadingElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const directory = useRef<HTMLDivElement>(null);
  const previousSelection = useRef(selectedRef);
  useLayoutEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = selectedRef;
    const narrow = window.matchMedia?.('(max-width: 1023px)');
    const moveFocus = (event?: MediaQueryListEvent) => {
      if (!narrow?.matches) {
        if (selectedRef && document.activeElement?.closest('[data-partner-gallery]')) detail.current?.focus({ preventScroll: true });
        else if (!selectedRef && previous && !event) [...(directory.current?.querySelectorAll<HTMLElement>('[data-partner-gallery] [data-view-key]') ?? [])].find(node => node.dataset.viewKey === previous)?.focus({ preventScroll: true });
        return;
      }
      if (selectedRef && (!event || viewport.current?.contains(document.activeElement) || document.activeElement === document.body)) detail.current?.focus({ preventScroll: true });
      else if (!selectedRef && previous && !event) ([...(viewport.current?.querySelectorAll<HTMLElement>('[data-view-key]') ?? [])].find(node => node.dataset.viewKey === previous) ?? heading.current)?.focus({ preventScroll: true });
    };
    moveFocus();
    narrow?.addEventListener('change', moveFocus);
    return () => narrow?.removeEventListener('change', moveFocus);
  }, [selectedRef, viewport]);
  if (auth.status !== 'authenticated' && auth.status !== 'refresh-pending') return <EmptyState title={t(`${P}.signIn`)} />;
  const showList = () => { void navigation.push({ ...destination, partner: undefined }); };
  return <div ref={directory} className="flex min-h-0 flex-1 gap-3" data-testid="partner-directory">
    <SidebarShell aria-label={t(`${P}.title`)} className={`partner-directory-sidebar min-h-0 w-full shrink-0 lg:w-[272px] ${selectedRef ? 'hidden lg:flex' : 'flex'}`}>
      <header className="partner-directory-header">
        <h1 ref={heading} tabIndex={-1}>{t(`${P}.title`)}</h1>
        <SearchField className="partner-directory-search" aria-label={t(`${P}.search`)} placeholder={t(`${P}.search`)} value={query}
          onChange={event => { void navigation.replace({ ...destination, partnerQuery: event.target.value }); }}
          onClear={() => { void navigation.replace({ ...destination, partnerQuery: '' }); }} clearLabel={t('Common.clear')} />
        {inventory.hasNextPage && query.trim() ? <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{t(`${P}.searchPartial`)}</p> : null}
      </header>
      <ScrollArea viewportRef={viewport} className="min-h-0 flex-1" contentClassName="space-y-1 px-2 pb-4">
        {inventory.isPending ? <LoadingSkeleton lines={3} /> : null}
        {inventory.isError ? <InlineAlert tone="warning" action={<Button size="sm" onClick={() => { void inventory.refetch(); }}>{t('Common.retry')}</Button>}>{t(`${P}.loadFailed`)}</InlineAlert> : null}
        {visible.map(partner => <PartnerDirectoryRow key={`${accountId}:${realm}:${auth.authorizationRevision}:${partner.localAgentRef}`} partner={partner}
          accountId={accountId} scopeKey={`${realm}:${auth.authorizationRevision}`} enabled={auth.status === 'authenticated'} selected={selectedRef === partner.localAgentRef}
          onSelect={() => { void navigation.push({ ...destination, partner: { localAgentRef: partner.localAgentRef } }); }} />)}
        {!inventory.isPending && !inventory.isError && !partners.length && !inventory.hasNextPage ? <EmptyState title={t(`${P}.empty`)} action={<Button onClick={() => { void navigation.push({ id: 'explore', exploreSection: 'worlds' }); }}>{t(`${P}.discover`)}</Button>} /> : null}
        {partners.length > 0 && !visible.length ? <p className="p-3 text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.noMatch`)}</p> : null}
        {inventory.hasNextPage ? <div className="px-3 pt-3 text-xs text-[var(--nimi-text-secondary)]"><p>{t(`${P}.partial`, { count: partners.length })}</p>
          <Button size="sm" disabled={inventory.isFetchingNextPage} onClick={() => { void inventory.fetchNextPage(); }}>{t(`${P}.loadMore`)}</Button></div> : null}
      </ScrollArea>
    </SidebarShell>
    <PartnerGallery key={`${accountId}:${realm}:${auth.authorizationRevision}`} partners={partners} accountId={accountId} scopeKey={`${realm}:${auth.authorizationRevision}`}
      query={query} active={!selectedRef} loading={inventory.isPending} error={inventory.isError} hasMore={Boolean(inventory.hasNextPage)} loadingMore={inventory.isFetchingNextPage}
      onRetry={() => { void inventory.refetch(); }} onLoadMore={() => { void inventory.fetchNextPage(); }} />
    {selectedRef ? <ScrollArea className="min-h-0 min-w-0 flex-1" contentClassName="mx-auto max-w-[1120px] p-5">
      <div ref={detail} tabIndex={-1} role="region" aria-label={t(`${P}.details`)}><Button tone="ghost" size="sm" onClick={showList} className="mb-4"><ArrowLeft size={16} />{t(`${P}.gallery.back`)}</Button>
        <PartnerDetails key={`${accountId}:${realm}:${auth.authorizationRevision}:${selectedRef}`} scopeKey={`${realm}:${auth.authorizationRevision}`} localAgentRef={selectedRef} accountId={accountId} /></div>
    </ScrollArea> : null}
  </div>;
}
