import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, InlineAlert, NimiTabs, ScrollArea, SearchField, Surface } from '@nimiplatform/kit/ui';
import type { Realm, RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { useAppStore, useAppStoreApi, useHomeNavigation, useHomeDestination } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useHomeListPosition } from '../../app-shell/providers/use-home-list-position.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRealmHumanChatData } from '../chat/data/realm-human-chat-data-context.js';
import { useHumanChatList } from '../chat/use-human-chat-list.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { FriendHandleLookupDialog } from './friend-handle-lookup-dialog.js';

import { loadHumanContactPage, useReceivedFriendRequests, type ContactSection, type ContactRow, type ContactPage } from './human-contact-data.js';
import { HumanIdentityPreview } from './human-identity-preview.js';
import { RelationshipActionsMenu } from './relationship-actions-menu.js';
import { ArrowLeft, UserPlus, MessageCircle, Inbox } from 'lucide-react';
type RelationshipAction = RealmModel<'FriendshipAction'>;
type Confirmation = { row: ContactRow; action: 'remove' | 'block' | 'unblock' };

export function HumanContactsPanel() {
  const accountId = useAppStore(state => String(state.auth.user?.id || ''));
  const realmBaseUrl = useAppStore(state => String(state.runtimeDefaults?.realm.realmBaseUrl || ''));
  return <AccountContactsPanel key={realmBaseUrl + '|' + accountId} accountId={accountId} realmBaseUrl={realmBaseUrl} />;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r032
function AccountContactsPanel({ accountId, realmBaseUrl }: { accountId: string; realmBaseUrl: string }) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const navigation = useHomeNavigation();
  const chat = useRealmHumanChatData();
  const queryClient = useQueryClient();
  const authStatus = useAppStore(state => state.auth.status);
  const conversations = useHumanChatList(authStatus);
  const i18n = useDesktopI18nResource();
  const tab = useHomeDestination().chat?.contactsSection ?? 'friends';
  const pageTitle = tab === 'conversations' ? t('Relationship.contacts.tabs.conversations') : t('Relationship.contacts.title');
  const setTab = (contactsSection: ContactSection) => {
    void navigation.replace({ id: 'chat', chat: { mode: 'human', contactsSection } });
    setSelectedBlocked(null); setFeedback(null);
  };
  const requests = useReceivedFriendRequests();
  const requestCount = requests.data?.pages[0]?.total;
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [selectedBlocked, setSelectedBlocked] = useState<ContactRow | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const operation = useRef<ReturnType<typeof captureAccountActionScope>>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.dispose(); }; }, []);
  const key = ['human-contacts', realmBaseUrl, accountId, tab, tab === 'friends' ? search.trim() : ''] as const;
  const contacts = useInfiniteQuery({
    queryKey: key, initialPageParam: '',
    queryFn: ({ pageParam }) => loadHumanContactPage(bindings.sdk.realm(), tab === 'conversations' ? 'friends' : tab, pageParam, search.trim()),
    getNextPageParam: page => page.nextCursor || undefined,
    enabled: Boolean(accountId) && tab !== 'conversations',
  });
  const blockedRelationship = useQuery({
    queryKey: ['blocked-contact-relationship', realmBaseUrl, accountId, selectedBlocked?.id],
    queryFn: () => bindings.sdk.realm().social.getMyRelationshipWithUser({ path: { id: selectedBlocked!.id } }),
    enabled: Boolean(selectedBlocked),
  });
  const rows = [...new Map((contacts.data?.pages.flatMap(page => page.items) ?? []).map(row => [row.id, row])).values()];
  const total = contacts.data?.pages[0]?.total;
  const friendCount = queryClient.getQueryData<{ pages: ContactPage[] }>(['human-contacts', realmBaseUrl, accountId, 'friends', ''])?.pages[0]?.total;
  const viewport = useHomeListPosition(`contacts:${tab}:${search}`, tab === 'conversations' ? !conversations.isPending : !contacts.isPending, false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['human-contacts', realmBaseUrl, accountId] });
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    void queryClient.invalidateQueries({ queryKey: ['user-profile'] });
    void queryClient.invalidateQueries({ queryKey: ['human-profile-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['blocked-contact-relationship', realmBaseUrl, accountId] });
    void queryClient.invalidateQueries({ queryKey: ['notification-page'] });
    void queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
  };
  const run = async (row: ContactRow, task: (realm: Realm) => Promise<unknown>, success: string, removesCurrentRow = false) => {
    if (operation.current) return;
    const scope = captureAccountActionScope(store);
    if (!scope) { setFeedback({ error: true, message: t('Profile.accountUnavailable') }); return; }
    operation.current = scope; setPending(row.id); setFeedback(null);
    try {
      await task(bindings.sdk.realm());
      if (!scope.isCurrent()) return;
      setConfirmation(null);
      setFeedback({ error: false, message: success });
      if (removesCurrentRow) queryClient.setQueryData(key, (current: { pages: ContactPage[]; pageParams: string[] } | undefined) => current ? {
        ...current, pages: current.pages.map(page => ({ ...page, items: page.items.filter(item => item.id !== row.id), total: Math.max(0, page.total - 1) })),
      } : current);
      refresh();
    } catch (error) {
      if (scope.isCurrent()) { setConfirmation(null); setFeedback({ error: true, message: error instanceof Error ? error.message : t('Relationship.contacts.actionFailed') }); }
    } finally {
      const current = scope.isCurrent(); scope.dispose(); if (operation.current === scope) operation.current = null;
      if (current && mounted.current) setPending(null);
    }
  };
  const relationshipAction = (row: ContactRow, action: RelationshipAction, removesCurrentRow = true) => {
    // The rendered row/selection captured this relationship identity. Never look
    // up a replacement id when an old request or confirmation is submitted.
    const relationshipId = row.relationshipId;
    if (!relationshipId) { setFeedback({ error: true, message: t('Relationship.contacts.relationshipChanged') }); return; }
    void run(row, realm => realm.social.applyFriendshipAction({ path: { id: row.id }, body: { action, relationshipId } }), t('Relationship.contacts.actionDone.' + action), removesCurrentRow);
  };
  const openChat = (row: ContactRow) => {
    const origin = navigation.getSnapshot().current.key;
    void run(row, async () => {
      const opened = await chat.startChatWithTarget(row.id);
      if (!opened?.chatId) throw new Error(t('Relationship.openChatFailed'));
      if (operation.current?.isCurrent() && navigation.getSnapshot().current.key === origin) {
        void queryClient.invalidateQueries({ queryKey: ['chats'] });
        await navigation.push({ id: 'chat', chat: { mode: 'human', targetId: row.id, threadId: opened.chatId } });
      }
    }, t('Relationship.contacts.chatOpened'));
  };
  const applyConfirmation = () => {
    if (!confirmation) return;
    const { row, action } = confirmation;
    if (action === 'remove') { relationshipAction(row, action, tab === 'friends'); return; }
    void run(row, realm => action === 'block'
      ? realm.social.blockUser({ path: { id: row.id }, body: {} })
      : realm.social.unblockUser({ path: { id: row.id } }), t('Relationship.contacts.actionDone.' + action), action === 'unblock' && tab === 'blocked');
  };
  const selectedRelationship = blockedRelationship.data;
  const blockedRowWithRelationship = selectedBlocked && selectedRelationship?.relationshipId
    ? { ...selectedBlocked, relationshipId: selectedRelationship.relationshipId } : null;
  return <ScrollArea viewportRef={viewport} className="min-h-0 flex-1 pr-[76px]" contentClassName="mx-auto w-full max-w-[760px] px-5 pb-8 pt-10 sm:pt-14">
    <Surface as="section" tone="card" padding="none" className="overflow-hidden rounded-2xl" aria-label={pageTitle}>
      <header className="flex items-center justify-between gap-4 px-6 pb-5 pt-6">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--nimi-text-primary)]">{pageTitle}</h1>
        <Button tone="primary" size="sm" leadingIcon={<UserPlus size={16} />} onClick={() => setAddOpen(true)}>{t('Relationship.findByHandleTitle')}</Button>
      </header>
      {tab === 'friends' || tab === 'conversations' ? <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--nimi-border-subtle)] px-4">
        <NimiTabs className="border-b-0" ariaLabel={t('Relationship.contacts.title')} items={(['conversations','friends'] as const).map(value => ({ value, label: <span>{t('Relationship.contacts.tabs.' + value)}{value === 'friends' && friendCount !== undefined ? <span className="ml-2 text-xs tabular-nums text-[var(--nimi-text-secondary)]">{friendCount}</span> : null}</span> }))} value={tab} onValueChange={value => setTab(value as ContactSection)} />
        <div className="flex items-center gap-1 pb-1">
          <Button tone="ghost" size="sm" leadingIcon={<Inbox size={15} />} onClick={() => setTab('received')}>{t('Relationship.contacts.requests')}{requestCount ? <span className="ml-1 rounded-full bg-[var(--nimi-action-primary-bg)] px-1.5 text-xs tabular-nums text-[var(--nimi-action-primary-text)]">{requestCount}</span> : null}</Button>
          <RelationshipActionsMenu label={t('Relationship.contacts.manageContacts')} items={[{ id: 'blocked', label: t('Relationship.contacts.tabs.blocked'), onSelect: () => setTab('blocked') }]} />
        </div>
      </div> : <div className="space-y-3 border-b border-[var(--nimi-border-subtle)] px-5 pb-3">
        <div className="flex items-center gap-3">
          <Button tone="ghost" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={() => setTab('friends')}>{t('Relationship.contacts.tabs.friends')}</Button>
          <h2 className="text-sm font-semibold">{tab === 'blocked' ? t('Relationship.contacts.tabs.blocked') : t('Relationship.contacts.requests')}{total !== undefined ? <span className="ml-2 text-xs font-normal tabular-nums text-[var(--nimi-text-secondary)]">{total}</span> : null}</h2>
        </div>
        {tab !== 'blocked' ? <NimiTabs className="border-b-0" ariaLabel={t('Relationship.contacts.requests')} items={(['received','sent'] as const).map(value => ({ value, label: t('Relationship.contacts.tabs.' + value) }))} value={tab} onValueChange={value => setTab(value as ContactSection)} /> : null}
      </div>}
      <div className="space-y-3 p-5">
        {tab === 'friends' ? <SearchField className="mb-3 max-w-xs rounded-lg" value={search} onChange={event => setSearch(event.target.value)} onClear={() => setSearch('')} clearLabel={t('Common.clear')} placeholder={t('Relationship.contacts.search')} aria-label={t('Relationship.contacts.search')} /> : null}
    {feedback ? <div className="space-y-2"><InlineAlert tone={feedback.error ? 'danger' : 'success'}>{feedback.message}</InlineAlert>{feedback.error ? <Button tone="ghost" size="sm" onClick={() => { void contacts.refetch(); if (selectedBlocked) void blockedRelationship.refetch(); }}>{t('Relationship.contacts.refreshList')}</Button> : null}</div> : null}
    {tab === 'conversations' ? <section className="space-y-3" aria-label={t('Relationship.contacts.tabs.conversations')}>
      {conversations.isPending ? <p role="status">{t('Common.loading')}</p> : null}
      {conversations.isError ? <div className="space-y-2"><InlineAlert tone="danger">{t('Relationship.contacts.loadFailed')}</InlineAlert><Button tone="secondary" onClick={() => { void conversations.refetch(); }}>{t('Common.retry')}</Button></div> : null}
      {conversations.data?.items.length ? <>
        <ul className="divide-y divide-[var(--nimi-border-subtle)]">{conversations.data.items.map(item => <li key={item.id}>
          <button type="button" onClick={() => { void navigation.push({ id: 'chat', chat: { mode: 'human', targetId: item.otherUser.id, threadId: item.id } }); }} className="flex w-full items-start gap-3 rounded-lg px-2 py-4 text-left hover:bg-[var(--nimi-surface-active)]">
            <EntityAvatar name={item.otherUser.displayName || item.otherUser.handle} imageUrl={item.otherUser.avatarUrl} media={item.otherUser.avatarMedia} kind="human" sizeClassName="h-10 w-10 shrink-0" />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.otherUser.displayName || item.otherUser.handle}</span><span className="mt-1 block text-sm text-[var(--nimi-text-secondary)]">{item.lastMessage ? t('Relationship.contacts.messagePreview') : t('Chat.noMessages')}</span></span>
            <span className="shrink-0 text-right"><time dateTime={item.lastMessageAt || item.updatedAt} className="block text-xs text-[var(--nimi-text-secondary)]">{i18n.formatDate(item.lastMessageAt || item.updatedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>{item.unreadCount > 0 ? <span className="mt-1 inline-block rounded-full bg-[var(--nimi-action-primary-bg)] px-2 py-0.5 text-xs text-[var(--nimi-action-primary-text)]" aria-label={t('Relationship.contacts.unreadMessages', { count: item.unreadCount })}>{item.unreadCount}</span> : null}</span>
          </button>
        </li>)}</ul>
      </> : !conversations.isPending && !conversations.isError ? <p className="px-4 py-12 text-center text-sm leading-relaxed text-[var(--nimi-text-secondary)]">{t('Relationship.contacts.emptyConversations')}</p> : null}
      {conversations.hasNextPage ? <Button tone="secondary" loading={conversations.isFetchingNextPage} onClick={() => { void conversations.fetchNextPage(); }}>{t('Relationship.contacts.loadMore')}</Button> : null}
    </section> : <>
    {contacts.isPending ? <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('Common.loading')}</p> : null}
    {contacts.isError ? <div className="space-y-2"><InlineAlert tone="danger">{t('Relationship.contacts.loadFailed')}</InlineAlert><Button tone="secondary" onClick={() => { void contacts.refetch(); }}>{t('Common.retry')}</Button></div> : null}
    {!contacts.isPending && !contacts.isError && !rows.length ? <p className="px-4 py-12 text-center text-sm leading-relaxed text-[var(--nimi-text-secondary)]">{tab === 'friends' && search.trim() ? t('Relationship.contacts.noSearchResults') : t('Relationship.contacts.empty.' + tab)}</p> : null}
    <ul className="divide-y divide-[var(--nimi-border-subtle)]">
      {rows.map(row => <li key={row.id} className="flex min-h-[80px] items-center gap-3 rounded-xl px-3 py-4 hover:bg-[var(--nimi-surface-active)]">
        <div className="min-w-0 flex-1">
          <HumanIdentityPreview {...row} avatarFallbackClassName="bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]" disabled={row.isDeleted} onMessage={tab === 'friends' && !pending ? () => openChat(row) : undefined} />
          {row.requestMessage ? <p className="ml-[52px] mt-2 whitespace-pre-wrap break-words text-sm text-[var(--nimi-text-secondary)]">{row.requestMessage}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {tab === 'friends' ? <>
            <Button size="sm" tone="ghost" className="text-[var(--nimi-action-primary-bg)]" leadingIcon={<MessageCircle size={16} />} disabled={Boolean(pending) || row.isDeleted} onClick={() => openChat(row)}>{t('Relationship.contacts.openChat')}</Button>
            <RelationshipActionsMenu label={t('Relationship.contacts.personActions', { name: row.displayName || row.handle })} disabled={Boolean(pending)} items={[
              { id: 'remove', label: t('Profile.removeFriend'), onSelect: () => setConfirmation({ row, action: 'remove' }) },
              ...(!row.isDeleted ? [{ id: 'block', label: t('Profile.blockUser'), onSelect: () => setConfirmation({ row, action: 'block' }) }] : []),
            ]} />
          </> : tab === 'received' ? <>
            <Button size="sm" tone="primary" disabled={Boolean(pending) || row.isDeleted} onClick={() => relationshipAction(row, 'accept')}>{t('Relationship.accept')}</Button>
            <Button size="sm" tone="secondary" disabled={Boolean(pending)} onClick={() => relationshipAction(row, 'reject')}>{t('Relationship.reject')}</Button>
            {!row.isDeleted ? <RelationshipActionsMenu label={t('Relationship.contacts.personActions', { name: row.displayName || row.handle })} disabled={Boolean(pending)} items={[{ id: 'block', label: t('Profile.blockUser'), onSelect: () => setConfirmation({ row, action: 'block' }) }]} /> : null}
          </> : tab === 'sent' ? <Button size="sm" tone="secondary" disabled={Boolean(pending)} onClick={() => relationshipAction(row, 'cancel')}>{t('Relationship.contacts.cancelRequest')}</Button> : <>
            <Button size="sm" tone="secondary" disabled={Boolean(pending)} onClick={() => setConfirmation({ row, action: 'unblock' })}>{t('Profile.unblock')}</Button>
            <Button size="sm" tone="ghost" disabled={Boolean(pending)} onClick={() => setSelectedBlocked(row)}>{t('Relationship.contacts.manageRelationship')}</Button>
          </>}
        </div>
      </li>)}
    </ul>
    {contacts.hasNextPage ? <Button tone="secondary" loading={contacts.isFetchingNextPage} onClick={() => { void contacts.fetchNextPage(); }}>{t('Relationship.contacts.loadMore')}</Button> : null}
    </>}
    {selectedBlocked ? <section className="space-y-3 border-t border-[var(--nimi-border-subtle)] pt-4">
      <h2 className="font-semibold">{t('Relationship.contacts.blockedRelationship', { name: selectedBlocked.displayName || selectedBlocked.handle || t('Relationship.contacts.deletedUser') })}</h2>
      {blockedRelationship.isPending ? <p role="status">{t('Common.loading')}</p> : blockedRelationship.isError ? <><InlineAlert tone="danger">{t('Relationship.contacts.loadFailed')}</InlineAlert><Button tone="secondary" onClick={() => { void blockedRelationship.refetch(); }}>{t('Common.retry')}</Button></> : <>
        <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Relationship.contacts.relationshipState.' + selectedRelationship?.state)}</p>
        {blockedRowWithRelationship && selectedRelationship?.state === 'active' ? <Button tone="secondary" disabled={Boolean(pending)} onClick={() => setConfirmation({ row: blockedRowWithRelationship, action: 'remove' })}>{t('Profile.removeFriend')}</Button> : null}
        {blockedRowWithRelationship && selectedRelationship?.state === 'pending_outgoing' ? <Button tone="secondary" disabled={Boolean(pending)} onClick={() => relationshipAction(blockedRowWithRelationship, 'cancel', false)}>{t('Relationship.contacts.cancelRequest')}</Button> : null}
        {blockedRowWithRelationship && selectedRelationship?.state === 'pending_incoming' ? <Button tone="secondary" disabled={Boolean(pending)} onClick={() => relationshipAction(blockedRowWithRelationship, 'reject', false)}>{t('Relationship.reject')}</Button> : null}
      </>}
    </section> : null}
      </div>
    </Surface>
    <ConfirmDialog open={Boolean(confirmation)} title={confirmation ? t('Relationship.contacts.confirmTitle.' + confirmation.action) : ''}
      message={confirmation ? t('Relationship.contacts.confirmBody.' + confirmation.action, { name: confirmation.row.displayName || confirmation.row.handle || t('Relationship.contacts.deletedUser') }) : ''}
      confirmLabel={confirmation ? t('Relationship.contacts.confirmTitle.' + confirmation.action) : ''} cancelLabel={t('Common.cancel')} pending={Boolean(pending)}
      confirmTone={confirmation?.action === 'unblock' ? 'primary' : 'danger'} onConfirm={applyConfirmation} onClose={() => { if (!pending) setConfirmation(null); }} />
    {addOpen ? <FriendHandleLookupDialog onClose={() => { setAddOpen(false); refresh(); }} /> : null}
  </ScrollArea>;
}
