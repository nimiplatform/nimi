import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  InlineAlert,
  LoadingSkeleton,
  ScrollArea,
  SearchField,
  SegmentedControl,
  Tooltip,
} from '@nimiplatform/kit/ui';
import type { Realm, RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { RealmHumanAvatar } from '../chat/realm-human-avatar.js';
import { useAppStore, useAppStoreApi, useHomeNavigation, useHomeDestination } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useHomeListPosition } from '../../app-shell/providers/use-home-list-position.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRealmHumanChatData } from '../chat/data/realm-human-chat-data-context.js';
import { FriendHandleLookupView } from './friend-handle-lookup-view.js';
import { MyHandleShareCard } from './my-handle-share-card.js';
import { loadHumanContactPage, useReceivedFriendRequests, type ContactSection, type ContactRow, type ContactPage } from './human-contact-data.js';
import { RelationshipActionsMenu } from './relationship-actions-menu.js';
import { ArrowLeft, ChevronDown, ChevronUp, Inbox, MessageCircle, UserPlus } from 'lucide-react';

type RelationshipAction = RealmModel<'FriendshipAction'>;
type Confirmation = { row: ContactRow; action: 'remove' | 'block' | 'unblock' };
type ContactsPanelView = Exclude<ContactSection, 'conversations'> | 'add';

export function HumanContactsPanel({
  unreadByUserId,
  onOpenConversation,
}: {
  unreadByUserId?: ReadonlyMap<string, number>;
  onOpenConversation?: () => void;
}) {
  const accountId = useAppStore(state => String(state.auth.user?.id || ''));
  const realmBaseUrl = useAppStore(state => String(state.runtimeDefaults?.realm.realmBaseUrl || ''));
  return <AccountContactsPanel key={realmBaseUrl + '|' + accountId} accountId={accountId} realmBaseUrl={realmBaseUrl} unreadByUserId={unreadByUserId} onOpenConversation={onOpenConversation} />;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r032
function AccountContactsPanel({ accountId, realmBaseUrl, unreadByUserId, onOpenConversation }: {
  accountId: string;
  realmBaseUrl: string;
  unreadByUserId?: ReadonlyMap<string, number>;
  onOpenConversation?: () => void;
}) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const chat = useRealmHumanChatData();
  const queryClient = useQueryClient();
  const myHandle = useAppStore(state =>
    typeof state.auth.user?.handle === 'string'
      ? state.auth.user.handle.trim().replace(/^@+/, '')
      : '',
  );
  const requested = destination.chat?.contactsSection;
  const routeTab = requested && requested !== 'conversations' ? requested : undefined;
  const [localView, setLocalView] = useState<ContactsPanelView>(() => routeTab ?? 'friends');
  const [addPrefill, setAddPrefill] = useState('');
  useEffect(() => {
    if (routeTab) {
      setLocalView(routeTab);
      setAddPrefill('');
    }
  }, [routeTab]);
  const view = localView;
  const queryTab: Exclude<ContactSection, 'conversations'> = view === 'add' ? 'friends' : view;
  const hasMainView = Boolean(
    destination.partnerChat ||
    destination.chat?.threadId ||
    destination.chat?.targetId ||
    destination.profileId ||
    destination.partner ||
    destination.partnerManagerAnchorId,
  );
  const setView = (next: ContactsPanelView, prefill = '') => {
    setLocalView(next);
    setAddPrefill(next === 'add' ? prefill : '');
    if (next !== 'add' && !hasMainView && destination.id === 'contacts') {
      void navigation.replace({ id: 'contacts', chat: { mode: 'human', contactsSection: next } });
    }
    setSelectedBlocked(null);
    setFeedback(null);
  };
  const openAddFriend = (prefill = '') => setView('add', prefill);
  const selectedProfileId = destination.profileId ?? null;
  const requests = useReceivedFriendRequests();
  const requestCount = requests.data?.pages[0]?.total;
  const [search, setSearch] = useState('');
  const [selectedBlocked, setSelectedBlocked] = useState<ContactRow | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const operation = useRef<ReturnType<typeof captureAccountActionScope>>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.dispose(); }; }, []);

  const trimmedSearch = search.trim();
  const key = ['human-contacts', realmBaseUrl, accountId, queryTab, queryTab === 'friends' ? trimmedSearch : ''] as const;
  const contacts = useInfiniteQuery({
    queryKey: key,
    initialPageParam: '',
    queryFn: ({ pageParam }) => loadHumanContactPage(bindings.sdk.realm(), queryTab, pageParam, trimmedSearch),
    getNextPageParam: page => page.nextCursor || undefined,
    enabled: Boolean(accountId),
  });
  const blockedRelationship = useQuery({
    queryKey: ['blocked-contact-relationship', realmBaseUrl, accountId, selectedBlocked?.id],
    queryFn: () => bindings.sdk.realm().social.getMyRelationshipWithUser({ path: { id: selectedBlocked!.id } }),
    enabled: Boolean(selectedBlocked),
  });
  const rows = [...new Map((contacts.data?.pages.flatMap(page => page.items) ?? []).map(row => [row.id, row])).values()];
  const total = contacts.data?.pages[0]?.total;
  const sentCache = queryClient.getQueryData<{ pages: ContactPage[] }>(['human-contacts', realmBaseUrl, accountId, 'sent', '']);
  const sentCount = view === 'sent' ? total : sentCache?.pages[0]?.total;
  const viewport = useHomeListPosition(`contacts:${view}:${search}`, !contacts.isPending, false);

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
      if (removesCurrentRow && selectedBlocked?.id === row.id) setSelectedBlocked(null);
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
        await navigation.push({ id: 'contacts', chat: { mode: 'human', targetId: row.id, threadId: opened.chatId } });
        onOpenConversation?.();
      }
    }, t('Relationship.contacts.chatOpened'));
  };
  const openProfile = (row: ContactRow) => {
    if (row.isDeleted) return;
    const currentDest = navigation.getSnapshot().current.destination;
    void navigation.push({ id: currentDest.id === 'contacts' ? 'contacts' : 'profile', profileId: row.id });
  };
  const applyConfirmation = () => {
    if (!confirmation) return;
    const { row, action } = confirmation;
    if (action === 'remove') { relationshipAction(row, action, view === 'friends'); return; }
    void run(row, realm => action === 'block'
      ? realm.social.blockUser({ path: { id: row.id }, body: {} })
      : realm.social.unblockUser({ path: { id: row.id } }), t('Relationship.contacts.actionDone.' + action), action === 'unblock' && view === 'blocked');
  };

  const selectedRelationship = blockedRelationship.data;
  const blockedRowWithRelationship = selectedBlocked && selectedRelationship?.relationshipId
    ? { ...selectedBlocked, relationshipId: selectedRelationship.relationshipId } : null;

  const isZeroFriends = view === 'friends' && !trimmedSearch && !contacts.isPending && !contacts.isError && rows.length === 0;
  const showFriendSearchRow = view === 'friends' && (rows.length > 0 || Boolean(trimmedSearch) || contacts.isError);
  const normalizedSearchHandle = trimmedSearch.replace(/^@+/, '');
  const canPrefillHandle = Boolean(normalizedSearchHandle) && !/\s/.test(normalizedSearchHandle);

  const subViewTitle = view === 'add'
    ? t('Relationship.findByHandleTitle')
    : view === 'blocked'
      ? t('Relationship.contacts.tabs.blocked')
      : t('Relationship.contacts.requests');

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="human-contacts-panel"
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented || confirmation) return;
        if (view !== 'friends') {
          event.preventDefault();
          event.stopPropagation();
          setView('friends');
        }
      }}
    >
      {view === 'friends' ? (
        <div className="shrink-0 space-y-2 px-3 pb-2.5 pt-2">
          {showFriendSearchRow ? (
            <div className="flex items-center gap-2">
              <SearchField
                className="flex-1 text-[13px]"
                value={search}
                onChange={event => setSearch(event.target.value)}
                onClear={() => setSearch('')}
                clearLabel={t('Common.clear')}
                placeholder={t('Relationship.contacts.search')}
                aria-label={t('Relationship.contacts.search')}
              />
              <Button
                size="sm"
                tone="secondary"
                leadingIcon={<UserPlus size={14} />}
                aria-label={t('Relationship.findByHandleTitle')}
                onClick={() => openAddFriend()}
              >
                {t('Relationship.contacts.addFriendShort')}
              </Button>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Button tone="ghost" size="sm" leadingIcon={<Inbox size={14} />} onClick={() => setView('received')}>
              {t('Relationship.contacts.requests')}
              {requestCount ? (
                <span className="ml-1 rounded-full bg-[var(--nimi-action-primary-bg)] px-1.5 py-px text-[11px] font-semibold tabular-nums text-[var(--nimi-action-primary-text)]">
                  {requestCount > 99 ? '99+' : requestCount}
                </span>
              ) : null}
            </Button>
            <Button
              tone="ghost"
              size="sm"
              className="text-xs font-medium text-[var(--nimi-text-secondary)]"
              aria-label={t('Relationship.contacts.tabs.blocked')}
              onClick={() => setView('blocked')}
            >
              {t('Relationship.contacts.blockedShort')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 space-y-2 border-b border-[var(--nimi-border-subtle)] px-3 pb-2.5 pt-2">
          <div className="flex items-center gap-2">
            <Button tone="ghost" size="sm" leadingIcon={<ArrowLeft size={15} />} onClick={() => setView('friends')}>
              {t('Relationship.contacts.tabs.friends')}
            </Button>
            <h2 className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
              {subViewTitle}
              {view === 'blocked' && total !== undefined ? (
                <span className="ml-1.5 text-xs font-normal tabular-nums text-[var(--nimi-text-secondary)]">{total}</span>
              ) : null}
            </h2>
          </div>
          {view === 'received' || view === 'sent' ? (
            <SegmentedControl
              size="sm"
              className="grid w-full grid-cols-2"
              ariaLabel={t('Relationship.contacts.requests')}
              value={view}
              onValueChange={value => setView(value as 'received' | 'sent')}
              items={[
                {
                  value: 'received',
                  label: requestCount ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span>{t('Relationship.contacts.tabs.received')}</span>
                      <span className="rounded-full bg-[var(--nimi-action-primary-bg)] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[var(--nimi-action-primary-text)]">
                        {requestCount > 99 ? '99+' : requestCount}
                      </span>
                    </span>
                  ) : t('Relationship.contacts.tabs.received'),
                },
                {
                  value: 'sent',
                  label: sentCount ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span>{t('Relationship.contacts.tabs.sent')}</span>
                      <span className="rounded-full bg-[var(--nimi-surface-card)] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[var(--nimi-text-secondary)]">
                        {sentCount > 99 ? '99+' : sentCount}
                      </span>
                    </span>
                  ) : t('Relationship.contacts.tabs.sent'),
                },
              ]}
            />
          ) : null}
          {view === 'blocked' ? (
            <p className="px-1 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
              {t('Relationship.contacts.blockedDescription')}
            </p>
          ) : null}
        </div>
      )}

      <ScrollArea viewportRef={viewport} className="min-h-0 flex-1" contentClassName="space-y-2 px-2.5 pb-20 pt-1">
        {view === 'add' ? (
          <FriendHandleLookupView
            key={addPrefill}
            initialHandle={addPrefill}
            myHandle={myHandle}
            onSuccess={refresh}
            onBackToFriends={() => setView('friends')}
            onOpenSentRequests={() => setView('sent')}
            onOpenReceivedRequests={() => setView('received')}
          />
        ) : (
          <>
            {feedback ? (
              <div className="space-y-1.5 px-1">
                <InlineAlert tone={feedback.error ? 'danger' : 'success'}>{feedback.message}</InlineAlert>
                {feedback.error ? (
                  <Button
                    tone="ghost"
                    size="sm"
                    onClick={() => {
                      void contacts.refetch();
                      if (selectedBlocked) void blockedRelationship.refetch();
                    }}
                  >
                    {t('Relationship.contacts.refreshList')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {contacts.isPending ? (
              <div className="px-1 py-2">
                <span role="status" className="sr-only">{t('Common.loading')}</span>
                <LoadingSkeleton lines={3} />
              </div>
            ) : null}

            {contacts.isError ? (
              <div className="space-y-2 px-1">
                <InlineAlert tone="danger">{t('Relationship.contacts.loadFailed')}</InlineAlert>
                <Button size="sm" tone="secondary" onClick={() => { void contacts.refetch(); }}>
                  {t('Common.retry')}
                </Button>
              </div>
            ) : null}

            {isZeroFriends ? (
              <div className="space-y-3 px-1 pt-3" data-testid="friends-empty-state">
                <EmptyState
                  icon={<UserPlus size={20} />}
                  title={t('Relationship.contacts.emptyTitle.friends')}
                  description={t('Relationship.contacts.empty.friends')}
                  action={
                    <Button size="sm" tone="primary" leadingIcon={<UserPlus size={14} />} onClick={() => openAddFriend()}>
                      {t('Relationship.findByHandleTitle')}
                    </Button>
                  }
                />
                {myHandle ? <MyHandleShareCard handle={myHandle} /> : null}
              </div>
            ) : !contacts.isPending && !contacts.isError && !rows.length && view === 'friends' && trimmedSearch ? (
              <div className="flex flex-col items-center gap-3 px-3 py-8 text-center" data-testid="friends-search-empty">
                <p className="text-sm leading-relaxed text-[var(--nimi-text-secondary)]">
                  {t('Relationship.contacts.noSearchResultsFor', { query: trimmedSearch })}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    size="sm"
                    tone="secondary"
                    leadingIcon={<UserPlus size={14} />}
                    onClick={() => openAddFriend(canPrefillHandle ? `@${normalizedSearchHandle}` : '')}
                  >
                    {canPrefillHandle
                      ? t('Relationship.contacts.addFriendFromSearch', { handle: `@${normalizedSearchHandle}` })
                      : t('Relationship.findByHandleTitle')}
                  </Button>
                  <Button size="sm" tone="ghost" onClick={() => setSearch('')}>
                    {t('Relationship.contacts.clearSearch')}
                  </Button>
                </div>
              </div>
            ) : !contacts.isPending && !contacts.isError && !rows.length ? (
              <p className="px-3 py-10 text-center text-sm leading-relaxed text-[var(--nimi-text-secondary)]">
                {t('Relationship.contacts.empty.' + view)}
              </p>
            ) : null}

            <ul className="space-y-1">
              {rows.map(row => {
                const name = row.isDeleted ? t('Relationship.contacts.deletedUser') : row.displayName || row.handle || t('Common.unknown');
                const selected = selectedProfileId === row.id;
                const unread = unreadByUserId?.get(row.id) ?? 0;
                const isBlockedExpanded = view === 'blocked' && selectedBlocked?.id === row.id;

                return (
                  <li
                    key={row.id}
                    className={`group rounded-xl transition-colors ${
                      selected
                        ? 'bg-[var(--nimi-surface-active)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)]'
                        : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)]'
                    }`}
                  >
                    <div className="flex min-h-[64px] items-center gap-2 px-2.5 py-2.5">
                      <button
                        type="button"
                        disabled={row.isDeleted}
                        aria-current={selected ? 'true' : undefined}
                        aria-label={t('Relationship.contacts.previewPerson', { name })}
                        onClick={() => openProfile(row)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:cursor-default"
                      >
                        <RealmHumanAvatar
                          accountId={row.id}
                          name={name}
                          imageUrl={row.isDeleted ? null : row.avatarUrl}
                          media={row.isDeleted ? null : row.avatarMedia}
                          resourceId={row.isDeleted ? null : row.avatarResourceId}
                          className="h-11 w-11 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="block truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{name}</span>
                            {unread > 0 ? (
                              <span className="shrink-0 rounded-full bg-[var(--nimi-action-primary-bg)] px-1.5 py-px text-[10px] font-bold text-[var(--nimi-action-primary-text)]">
                                {unread > 99 ? '99+' : unread}
                              </span>
                            ) : null}
                          </span>
                          {row.isDeleted ? (
                            <span className="mt-0.5 block truncate text-xs text-[var(--nimi-text-muted)]">
                              {t('Relationship.contacts.deletedUserSubtitle')}
                            </span>
                          ) : row.handle ? (
                            <span className="mt-0.5 block truncate text-xs text-[var(--nimi-text-secondary)]">
                              @{row.handle.replace(/^@+/, '')}
                            </span>
                          ) : null}
                        </span>
                      </button>

                      {view === 'friends' ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                          {!row.isDeleted ? (
                            <Tooltip content={t('Relationship.contacts.openChat')} placement="top">
                              <IconButton
                                size="sm"
                                tone="ghost"
                                icon={<MessageCircle size={15} />}
                                aria-label={t('Relationship.contacts.openChat')}
                                className={selected ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-muted)] group-hover:text-[var(--nimi-text-primary)]'}
                                disabled={Boolean(pending)}
                                onClick={() => openChat(row)}
                              />
                            </Tooltip>
                          ) : null}
                          <RelationshipActionsMenu
                            label={t('Relationship.contacts.personActions', { name })}
                            disabled={Boolean(pending)}
                            items={[
                              { id: 'remove', label: t('Profile.removeFriend'), onSelect: () => setConfirmation({ row, action: 'remove' }) },
                              ...(!row.isDeleted ? [{ id: 'block', label: t('Profile.blockUser'), onSelect: () => setConfirmation({ row, action: 'block' }) }] : []),
                            ]}
                          />
                        </div>
                      ) : view === 'received' && !row.isDeleted ? (
                        <RelationshipActionsMenu
                          label={t('Relationship.contacts.personActions', { name })}
                          disabled={Boolean(pending)}
                          items={[
                            { id: 'block', label: t('Profile.blockUser'), onSelect: () => setConfirmation({ row, action: 'block' }) },
                          ]}
                        />
                      ) : null}
                    </div>

                    {row.requestMessage ? (
                      <p className="mx-3 mb-2 ml-[62px] whitespace-pre-wrap break-words rounded-lg bg-[var(--nimi-surface-panel)] px-2.5 py-1.5 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                        {row.requestMessage}
                      </p>
                    ) : null}

                    {view === 'received' ? (
                      <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pl-[62px]">
                        <Button size="sm" tone="primary" disabled={Boolean(pending) || row.isDeleted} onClick={() => relationshipAction(row, 'accept')}>
                          {t('Relationship.accept')}
                        </Button>
                        <Button size="sm" tone="secondary" disabled={Boolean(pending)} onClick={() => relationshipAction(row, 'reject')}>
                          {t('Relationship.reject')}
                        </Button>
                      </div>
                    ) : view === 'sent' ? (
                      <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pl-[62px]">
                        <span className="text-xs text-[var(--nimi-text-secondary)]">
                          {t('Relationship.contacts.awaitingConfirmation')}
                        </span>
                        <Button size="sm" tone="secondary" disabled={Boolean(pending)} onClick={() => relationshipAction(row, 'cancel')}>
                          {t('Relationship.contacts.cancelRequest')}
                        </Button>
                      </div>
                    ) : view === 'blocked' ? (
                      <div className="space-y-2 px-3 pb-2.5 pl-[62px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" tone="secondary" disabled={Boolean(pending)} onClick={() => setConfirmation({ row, action: 'unblock' })}>
                            {t('Profile.unblock')}
                          </Button>
                          <Button
                            size="sm"
                            tone="ghost"
                            aria-expanded={isBlockedExpanded}
                            trailingIcon={isBlockedExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            disabled={Boolean(pending)}
                            onClick={() => setSelectedBlocked(current => current?.id === row.id ? null : row)}
                          >
                            {t('Relationship.contacts.manageRelationship')}
                          </Button>
                        </div>

                        {isBlockedExpanded ? (
                          <div
                            data-testid="blocked-relationship-inline"
                            className="space-y-2 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-2.5"
                          >
                            {blockedRelationship.isPending ? (
                              <p role="status" className="text-xs text-[var(--nimi-text-secondary)]">{t('Common.loading')}</p>
                            ) : blockedRelationship.isError ? (
                              <div className="space-y-2">
                                <InlineAlert tone="danger">{t('Relationship.contacts.loadFailed')}</InlineAlert>
                                <Button size="sm" tone="secondary" onClick={() => { void blockedRelationship.refetch(); }}>
                                  {t('Common.retry')}
                                </Button>
                              </div>
                            ) : (
                              <>
                                <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                                  {t('Relationship.contacts.relationshipState.' + selectedRelationship?.state)}
                                </p>
                                {blockedRowWithRelationship && selectedRelationship?.state === 'active' ? (
                                  <Button size="sm" tone="secondary" disabled={Boolean(pending)} onClick={() => setConfirmation({ row: blockedRowWithRelationship, action: 'remove' })}>
                                    {t('Profile.removeFriend')}
                                  </Button>
                                ) : null}
                                {blockedRowWithRelationship && selectedRelationship?.state === 'pending_outgoing' ? (
                                  <Button size="sm" tone="secondary" disabled={Boolean(pending)} onClick={() => relationshipAction(blockedRowWithRelationship, 'cancel', false)}>
                                    {t('Relationship.contacts.cancelRequest')}
                                  </Button>
                                ) : null}
                                {blockedRowWithRelationship && selectedRelationship?.state === 'pending_incoming' ? (
                                  <Button size="sm" tone="secondary" disabled={Boolean(pending)} onClick={() => relationshipAction(blockedRowWithRelationship, 'reject', false)}>
                                    {t('Relationship.reject')}
                                  </Button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {contacts.hasNextPage ? (
              <div className="flex items-center justify-between gap-2 px-1 pt-2 text-xs text-[var(--nimi-text-secondary)]">
                {total !== undefined ? (
                  <span>{t('Relationship.contacts.loadedSummary', { shown: rows.length, total })}</span>
                ) : <span />}
                <Button size="sm" tone="secondary" loading={contacts.isFetchingNextPage} onClick={() => { void contacts.fetchNextPage(); }}>
                  {t('Relationship.contacts.loadMore')}
                </Button>
              </div>
            ) : view === 'friends' && rows.length > 0 && total !== undefined && !trimmedSearch ? (
              <p className="px-2 pt-2 text-center text-xs text-[var(--nimi-text-muted)]">
                {t('Relationship.contacts.friendsTotal', { count: total })}
              </p>
            ) : null}
          </>
        )}
      </ScrollArea>

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation ? t('Relationship.contacts.confirmTitle.' + confirmation.action) : ''}
        message={confirmation ? t('Relationship.contacts.confirmBody.' + confirmation.action, { name: confirmation.row.displayName || confirmation.row.handle || t('Relationship.contacts.deletedUser') }) : ''}
        confirmLabel={confirmation ? t('Relationship.contacts.confirmTitle.' + confirmation.action) : ''}
        cancelLabel={t('Common.cancel')}
        pending={Boolean(pending)}
        confirmTone={confirmation?.action === 'unblock' ? 'primary' : 'danger'}
        onConfirm={applyConfirmation}
        onClose={() => { if (!pending) setConfirmation(null); }}
      />
    </div>
  );
}
