import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, InlineAlert, LoadingSkeleton, ScrollArea, SearchField } from '@nimiplatform/kit/ui';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { Compass } from 'lucide-react';
import { useAppStore, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useHomeListPosition } from '../../app-shell/providers/use-home-list-position.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useSystemEntry } from '../system-entry/system-entry-context.js';
import { unreadCompanionReplies } from '../home/home-app-activity-model.js';
import { partnerDirectoryQueryKey, readPartnerDirectoryPage } from './partner-directory-model.js';
import { PartnerDirectoryRow } from './partner-directory-row.js';
import './partner-directory.css';

const P = 'runtimeConfig.partners';

export function PartnerDirectory({ onOpenConversation }: { onOpenConversation?: () => void } = {}) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const auth = useAppStore(state => state.auth);
  const realm = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const { appActivity, recentPartners } = useSystemEntry();
  const accountId = String(auth.user?.id ?? '');
  const selectedRef = destination.partner?.localAgentRef ?? '';
  const routeQuery = destination.contactView === 'partners' ? destination.partnerQuery ?? '' : undefined;
  const [localQuery, setLocalQuery] = useState(() => routeQuery ?? '');
  useEffect(() => {
    if (routeQuery !== undefined) setLocalQuery(routeQuery);
  }, [routeQuery]);
  const query = routeQuery ?? localQuery;
  const updateQuery = (next: string) => {
    setLocalQuery(next);
    if (destination.contactView === 'partners') {
      void navigation.replace({ ...destination, partnerQuery: next });
    }
  };
  const inventory = useInfiniteQuery({
    queryKey: [...partnerDirectoryQueryKey(accountId, realm), auth.authorizationRevision],
    queryFn: ({ pageParam }) => readPartnerDirectoryPage(bindings.sdk, accountId, pageParam),
    initialPageParam: '', getNextPageParam: page => page.nextPageToken || undefined,
    enabled: auth.status === 'authenticated', staleTime: 15_000, networkMode: 'always',
  });
  const partners = useMemo(() => [...new Map((inventory.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.localAgentRef, item])).values()], [inventory.data]);
  const visible = partners.filter(partner => partner.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const viewport = useHomeListPosition(JSON.stringify(['partners', accountId, realm, query]), !inventory.isPending);
  const unreadByPartnerRef = useMemo(() => {
    const unreadByActivity = unreadCompanionReplies(appActivity.recent.records);
    const map = new Map<string, number>();
    for (const item of recentPartners ?? []) {
      if (!item.activityAgentRef) continue;
      const count = unreadByActivity.get(item.activityAgentRef)?.length ?? 0;
      if (count > 0) map.set(item.localAgentRef, count);
    }
    return map;
  }, [appActivity.recent.records, recentPartners]);

  if (auth.status !== 'authenticated' && auth.status !== 'refresh-pending') return <EmptyState title={t(`${P}.signIn`)} />;
  const showEmptyState = !inventory.isPending && !inventory.isError && !partners.length && !inventory.hasNextPage;
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="partner-directory">
    <div className="shrink-0 space-y-2 px-3 pb-2.5 pt-2">
      <SearchField className="partner-directory-search w-full" aria-label={t(`${P}.search`)} placeholder={t(`${P}.search`)} value={query}
        onChange={event => updateQuery(event.target.value)}
        onClear={() => updateQuery('')} clearLabel={t('Common.clear')} />
      {!showEmptyState ? (
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" tone="ghost" leadingIcon={<Compass size={14} />}
            onClick={() => { void navigation.push({ id: 'explore', exploreSection: 'worlds', exploreSearchKind: 'characters' }); }}>
            {t(`${P}.discover`)}
          </Button>
        </div>
      ) : null}
      {inventory.hasNextPage && query.trim() ? <p className="px-1 text-xs text-[var(--nimi-text-secondary)]">{t(`${P}.searchPartial`)}</p> : null}
    </div>
    <ScrollArea viewportRef={viewport} className="min-h-0 flex-1" contentClassName="space-y-1 px-2.5 pb-20">
      {inventory.isPending ? <LoadingSkeleton lines={3} /> : null}
      {inventory.isError ? <InlineAlert tone="warning" action={<Button size="sm" onClick={() => { void inventory.refetch(); }}>{t('Common.retry')}</Button>}>{t(`${P}.loadFailed`)}</InlineAlert> : null}
      {visible.map(partner => <PartnerDirectoryRow key={`${accountId}:${realm}:${auth.authorizationRevision}:${partner.localAgentRef}`} partner={partner}
        accountId={accountId} scopeKey={`${realm}:${auth.authorizationRevision}`} enabled={auth.status === 'authenticated'} selected={selectedRef === partner.localAgentRef}
        unreadCount={unreadByPartnerRef.get(partner.localAgentRef) ?? 0}
        onSelect={() => {
          void navigation.push({
            id: 'contacts',
            contactView: 'partners',
            partner: { localAgentRef: partner.localAgentRef },
            ...(query.trim() ? { partnerQuery: query } : {}),
          });
        }}
        onMessage={partner.lifecycle === AgentLifecycleStatus.ACTIVE ? () => {
          void navigation.push({ id: 'contacts', partnerChat: { localAgentRef: partner.localAgentRef } }).then(() => {
            onOpenConversation?.();
          });
        } : undefined} />)}
      {showEmptyState ? <EmptyState title={t(`${P}.empty`)} action={<Button size="sm" onClick={() => { void navigation.push({ id: 'explore', exploreSection: 'worlds', exploreSearchKind: 'characters' }); }}>{t(`${P}.discover`)}</Button>} /> : null}
      {partners.length > 0 && !visible.length ? <p className="px-3 py-6 text-center text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.noMatch`)}</p> : null}
      {inventory.hasNextPage ? <div className="flex items-center justify-between gap-2 px-2 pt-3 text-xs text-[var(--nimi-text-secondary)]"><span>{t(`${P}.partial`, { count: partners.length })}</span>
        <Button size="sm" tone="secondary" disabled={inventory.isFetchingNextPage} onClick={() => { void inventory.fetchNextPage(); }}>{t(`${P}.loadMore`)}</Button></div> : null}
    </ScrollArea>
  </div>;
}
