import React, { useState, useMemo, useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconButton,
  ScrollArea,
  Surface,
  Tooltip,
} from '@nimiplatform/kit/ui';
import {
  SidebarHeader,
  SidebarResizeHandle,
  SidebarSearch,
  SidebarSection,
  SidebarShell,
} from '@renderer/components/sidebar.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { InlineFeedback } from '@renderer/ui/feedback/inline-feedback';
import type { ContactRecord, ContactRequestRecord, TabFilter } from './contacts-model';
import nimiLogo from '@renderer/assets/logo-gray.png';
import type { ContactsViewProps, BlockedUserInfo } from './contacts-view-types.js';
import { FriendRequestDetail, FriendRequestsList } from './contacts-friend-requests.js';
import { UnblockConfirmDialog } from './contacts-blocked-users.js';
import {
  ContactsChipList,
  ContactsFilterChips,
  ContactsRequestsBanner,
  ContactsSearchResults,
  type ContactsChipFilter,
} from './contacts-category-list.js';
import { ContactDetailProfileModal, type ContactDetailProfileSeed } from './contact-detail-profile-modal.js';

function toContactDetailProfileSeed(contact: ContactRecord): ContactDetailProfileSeed {
  return {
    id: contact.id,
    displayName: contact.displayName,
    handle: contact.handle,
    avatarUrl: contact.avatarUrl,
    bio: contact.bio,
    isAgent: contact.isAgent,
    tags: contact.tags,
    gender: contact.gender,
    worldName: contact.worldName,
    worldBannerUrl: contact.worldBannerUrl,
    agentOwnershipType: contact.agentOwnershipType,
    agentWorldId: contact.worldId,
    agentOwnerWorldId: contact.worldId,
  };
}

function SkeletonBlock(props: { className: string }) {
  return <div className={`animate-pulse rounded-full bg-slate-200/75 ${props.className}`} />;
}

function ContactsLoadingSkeleton() {
  return (
    <div data-testid={E2E_IDS.panel('contacts')} className="flex h-full gap-2">
      <Surface
        as="aside"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="relative flex w-[340px] shrink-0 flex-col rounded-3xl border border-white/60 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <SkeletonBlock className="h-7 w-28 rounded-lg" />
          <div className="ml-auto flex items-center gap-1">
            <SkeletonBlock className="h-9 w-9 rounded-xl" />
            <SkeletonBlock className="h-9 w-9 rounded-xl" />
          </div>
        </div>

        <ScrollArea
          className="flex-1"
          contentClassName="space-y-3 px-3 py-2"
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <Surface key={`contacts-skeleton-row-${index}`} tone="card" elevation="base" className="rounded-2xl p-3">
              <div className="flex items-center gap-3">
                <SkeletonBlock className="h-11 w-11 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <SkeletonBlock className="h-4 w-24 rounded-md" />
                  <SkeletonBlock className="h-3 w-32 rounded-md" />
                </div>
              </div>
            </Surface>
          ))}
        </ScrollArea>
      </Surface>

      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-w-0 flex-1 flex-col rounded-3xl border border-white/60 p-8 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
      >
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
          <div className="mb-8 flex items-center gap-4">
            <SkeletonBlock className="h-20 w-20 shrink-0" />
            <div className="flex-1 space-y-3">
              <SkeletonBlock className="h-7 w-40 rounded-lg" />
              <SkeletonBlock className="h-4 w-56 rounded-md" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`contacts-stat-skeleton-${index}`} className="rounded-2xl bg-slate-50 p-4">
                <SkeletonBlock className="mx-auto h-6 w-14 rounded-md" />
                <SkeletonBlock className="mx-auto mt-2 h-3 w-16 rounded-md" />
              </div>
            ))}
          </div>

          <div className="mt-8 space-y-4">
            <SkeletonBlock className="h-5 w-32 rounded-md" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`contacts-detail-skeleton-${index}`} className="space-y-2">
                <SkeletonBlock className="h-4 w-full rounded-md" />
                <SkeletonBlock className="h-4 w-5/6 rounded-md" />
              </div>
            ))}
          </div>

          <div className="mt-auto flex gap-3 pt-8">
            <SkeletonBlock className="h-11 w-32 rounded-xl" />
            <SkeletonBlock className="h-11 w-28 rounded-xl" />
          </div>
        </div>
      </Surface>
    </div>
  );
}

const CONTACTS_SIDEBAR_DEFAULT_WIDTH = 340;
const CONTACTS_SIDEBAR_MIN_WIDTH = 280;
const CONTACTS_SIDEBAR_MAX_WIDTH = 420;

export function ContactsView(props: ContactsViewProps) {
  const { t } = useTranslation();
  const rememberedProfileId = useAppStore((state) => state.selectedProfileId);
  const setSelectedProfileIsAgent = useAppStore((state) => state.setSelectedProfileIsAgent);
  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(CONTACTS_SIDEBAR_DEFAULT_WIDTH);
  const [unblockingContact, setUnblockingContact] = useState<ContactRecord | null>(null);
  const [unblockMutationPending, setUnblockMutationPending] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ContactRequestRecord | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<TabFilter | null>(null);

  const closeSearch = () => {
    props.onSearchTextChange('');
    setSelectedContact(null);
    setProfileModalOpen(false);
    setSelectedRequest(null);
    setSelectedCategory(null);
  };

  // 处理联系人侧栏拖拽缩放，宽度只属于本地布局状态，不成为联系人数据真相。
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const startResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const cleanup = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dragCleanupRef.current = null;
    };

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const nextWidth = Math.min(
        CONTACTS_SIDEBAR_MAX_WIDTH,
        Math.max(CONTACTS_SIDEBAR_MIN_WIDTH, Math.round(moveEvent.clientX - rect.left)),
      );
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      cleanup();
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // 本地状态：被拉黑的用户列表（包含完整联系人和之前的分类信息）
  const [blockedUsers, setBlockedUsers] = useState<Map<string, BlockedUserInfo>>(new Map());

  // 同步 props.blockedContacts 到本地状态
  useEffect(() => {
    setBlockedUsers(prev => {
      const newMap = new Map<string, BlockedUserInfo>();
      // 保留已有的 previousCategory 信息
      for (const contact of props.blockedContacts) {
        const existing = prev.get(contact.id);
        newMap.set(contact.id, {
          ...contact,
          previousCategory: existing?.previousCategory || 'humans',
          blockedAt: existing?.blockedAt || Date.now(),
        });
      }
      return newMap;
    });
  }, [props.blockedContacts]);

  const [acceptedRequests, setAcceptedRequests] = useState<Set<string>>(new Set());

  // 跟踪已拒绝的好友请求
  const [rejectedRequests, setRejectedRequests] = useState<Set<string>>(new Set());

  // 顶部 chip 过滤器 — 区别于 props.activeFilter（后者由父组件持久化的视图过滤器）
  const [chipFilter, setChipFilter] = useState<ContactsChipFilter>('all');

  // 判断用户是否被拉黑
  const isUserBlocked = (userId: string): boolean => {
    return blockedUsers.has(userId);
  };

  // 当前未拉黑的联系人快照（用于派生 chip 数量与列表）
  const activeFriends = useMemo(
    () => props.allFriends.filter((contact) => !isUserBlocked(contact.id)),
    [props.allFriends, blockedUsers],
  );
  const blockedContactsList = useMemo(() => Array.from(blockedUsers.values()), [blockedUsers]);

  const handleUnblockUser = async (contact: ContactRecord) => {
    if (unblockMutationPending) return;

    try {
      setUnblockMutationPending(true);
      await props.onUnblockUser?.(contact);
      if (selectedContact?.id === contact.id) {
        setSelectedContact(null);
      }
      setUnblockingContact(null);
    } catch {
      // Parent mutation owns user feedback; keep the dialog open for retry.
    } finally {
      setUnblockMutationPending(false);
    }
  };

  const acceptRequestWithEvidence = async (request: ContactRequestRecord) => {
    await props.onAcceptRequest(request);
    setAcceptedRequests(prev => new Set(prev).add(request.userId));
  };

  const rejectRequestWithEvidence = async (request: ContactRequestRecord) => {
    await props.onRejectRequest(request);
    setRejectedRequests(prev => new Set(prev).add(request.userId));
  };

  const cancelRequestWithEvidence = async (request: ContactRequestRecord) => {
    await props.onCancelRequest(request);
  };

  // 更新各分类的数量（包含本地拉黑状态）
  const getUpdatedCounts = () => {
    const blockedCount = blockedUsers.size;
    const pendingRequestsCount = Math.max(0, props.requestsCount - acceptedRequests.size - rejectedRequests.size);
    return {
      ...props,
      blocksCount: blockedCount,
      requestsCount: pendingRequestsCount,
    };
  };

  const counts = getUpdatedCounts();

  // 当 allFriends 刷新时，同步更新 selectedContact（避免头像等字段显示旧缓存数据）
  useEffect(() => {
    if (!selectedContact) {
      return;
    }
    const updated = props.allFriends.find((contact) => contact.id === selectedContact.id)
      || props.blockedContacts.find((contact) => contact.id === selectedContact.id);
    if (!updated) {
      setSelectedContact(null);
      setProfileModalOpen(false);
      setSelectedProfileId(null);
      setSelectedProfileIsAgent(null);
      return;
    }
    if (updated.avatarUrl !== selectedContact.avatarUrl || updated.displayName !== selectedContact.displayName) {
      setSelectedContact(updated);
    }
  }, [props.allFriends, props.blockedContacts, selectedContact, setSelectedProfileId, setSelectedProfileIsAgent]);

  // 处理选择联系人
  useEffect(() => {
    if (!rememberedProfileId || selectedContact || selectedRequest) {
      return;
    }
    const restoredContact = props.allFriends.find((contact) => contact.id === rememberedProfileId) || null;
    if (!restoredContact) {
      return;
    }
    const nextCategory: TabFilter = restoredContact.isAgent ? 'agents' : 'humans';
    setSelectedContact(restoredContact);
    setProfileModalOpen(true);
    setSelectedRequest(null);
    setSelectedCategory(nextCategory);
    props.onFilterChange(nextCategory);
  }, [props, rememberedProfileId, selectedContact, selectedRequest]);

  const handleSelectContact = (contact: ContactRecord, categoryId: TabFilter) => {
    setSelectedContact(contact);
    setProfileModalOpen(true);
    setSelectedRequest(null);
    setSelectedCategory(categoryId);
    setSelectedProfileId(contact.id);
    setSelectedProfileIsAgent(contact.isAgent);
    props.onFilterChange(categoryId);
  };

  const addContactAction = (
    <Tooltip content={t('Contacts.addContact', { defaultValue: 'Add Friend' })} placement="bottom">
      <IconButton
        onClick={props.onOpenAddContact}
        tone="ghost"
        icon={(
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        )}
        className="h-9 w-9 shrink-0 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]"
        aria-label={t('Contacts.addContact', { defaultValue: 'Add Friend' })}
      />
    </Tooltip>
  );

  if (props.loading) {
    return <ContactsLoadingSkeleton />;
  }

  if (props.error) {
    return (
      <div data-testid={E2E_IDS.panel('contacts')} className="flex h-full">
        <Surface
          tone="panel"
          material="glass-regular"
          className="flex flex-1 items-center justify-center rounded-none border-0 text-sm text-red-600"
        >
          {t('Contacts.loadError')}
        </Surface>
      </div>
    );
  }

  return (
    <div ref={containerRef} data-testid={E2E_IDS.panel('contacts')} className="flex h-full gap-2 text-[var(--nimi-text-primary)]">
      <SidebarShell
        width={sidebarWidth}
        className="rounded-3xl border border-white/60 border-r-[color-mix(in_srgb,var(--nimi-border-subtle)_82%,white)] bg-[var(--nimi-sidebar-canvas)] shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
        data-testid={E2E_IDS.panel('contacts')}
      >
        <SidebarHeader
          title={(
            <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="nimi-type-page-title text-[color:var(--nimi-text-primary)]">{t('Contacts.title')}</h1>
                <p className="mt-1.5 text-xs text-[color:var(--nimi-text-muted)]">
                  {t('Contacts.totalCount', { defaultValue: '{{count}} contacts', count: counts.humansCount + counts.agentsCount })}
                </p>
              </div>
            </div>
          )}
          className="px-4 pt-5 pb-4"
        />

        <div className="pt-1 pb-3">
          <ContactsFilterChips
            value={chipFilter}
            onChange={setChipFilter}
          />
        </div>

        <div className="pb-2">
          <SidebarSearch
            value={props.searchText}
            onChange={props.onSearchTextChange}
            onClear={closeSearch}
            placeholder={t('Contacts.searchPlaceholder', { defaultValue: 'Search friends' })}
            clearLabel={t('Home.clear', { defaultValue: 'Clear' })}
            primaryAction={addContactAction}
          />
        </div>

        <ScrollArea
          className="flex-1"
          contentClassName="space-y-2 pt-2 pb-3"
        >
          <SidebarSection>
            {/* governed sidebar kinds: 'category-row', 'entity-row' */}
            {props.searchText.trim() ? (
              <ContactsSearchResults
                searchText={props.searchText}
                allFriends={props.allFriends}
                isUserBlocked={isUserBlocked}
                selectedContactId={selectedContact?.id ?? null}
                onSelectContact={handleSelectContact}
              />
            ) : (
              <>
                <ContactsRequestsBanner
                  count={counts.requestsCount}
                  onSelect={() => {
                    setSelectedCategory('requests');
                    setSelectedRequest(null);
                    setSelectedContact(null);
                    setProfileModalOpen(false);
                  }}
                />
                <ContactsChipList
                  filter={chipFilter}
                  allFriends={activeFriends}
                  blockedContacts={blockedContactsList}
                  currentContactId={selectedContact?.id ?? null}
                  onSelectContact={handleSelectContact}
                  onUnblock={(contact) => setUnblockingContact(contact)}
                />
              </>
            )}
          </SidebarSection>
        </ScrollArea>
        <SidebarResizeHandle
          ariaLabel={t('Contacts.resizeSidebar', { defaultValue: 'Resize contacts sidebar' })}
          onMouseDown={startResize}
        />
      </SidebarShell>

      {/* 右侧详情区：profile 详情由弹层承载，面板只保留当前联系人入口。 */}
      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border-white/60 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
      >
        {props.feedback ? (
          <div className="px-6 pt-4">
            <InlineFeedback
              feedback={props.feedback}
              onDismiss={props.onDismissFeedback}
            />
          </div>
        ) : null}
        {!selectedRequest && selectedCategory !== 'requests' && !selectedContact ? (
          // 空状态 - Nimi Logo 居中于整个详情面板
          <div className="flex min-w-0 flex-1 items-center justify-center bg-transparent px-6 py-6">
            <img
              src={nimiLogo}
              alt="Nimi"
              className="w-64 h-64 object-contain"
            />
          </div>
        ) : (
        <ScrollArea
          className="flex min-w-0 flex-1 flex-col"
          viewportClassName="bg-transparent"
        >
        {selectedRequest ? (
          // 单个好友请求详情
          <FriendRequestDetail
            request={selectedRequest}
            isAccepted={acceptedRequests.has(selectedRequest.userId)}
            onAccept={() => {
              void acceptRequestWithEvidence(selectedRequest);
            }}
            onReject={() => {
              void rejectRequestWithEvidence(selectedRequest);
            }}
            onCancel={() => {
              void cancelRequestWithEvidence(selectedRequest);
            }}
          />
        ) : selectedCategory === 'requests' ? (
          // New Friends 列表页 - 显示所有请求（按时间排序）
          <FriendRequestsList
            requests={props.filteredRequests.filter(r => r.direction === 'received')}
            acceptedRequests={acceptedRequests}
            rejectedRequests={rejectedRequests}
            onAccept={(req) => {
              void acceptRequestWithEvidence(req);
            }}
            onReject={(req) => {
              void rejectRequestWithEvidence(req);
            }}
          />
        ) : selectedContact ? (
          <div className="flex min-h-full items-center justify-center bg-transparent px-6 py-6">
            <div className="flex w-full max-w-md flex-col items-center rounded-[28px] border border-white/70 bg-white/76 px-8 py-9 text-center shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]">
              <EntityAvatar
                imageUrl={selectedContact.avatarUrl}
                name={selectedContact.displayName}
                kind={selectedContact.isAgent ? 'agent' : 'human'}
                sizeClassName="h-20 w-20"
                textClassName="text-2xl font-semibold"
                fallbackClassName={selectedContact.isAgent ? undefined : 'bg-gradient-to-br from-[#4ECCA3]/18 to-[#4ECCA3]/5 text-[#1f8f69]'}
                className={selectedContact.isAgent ? '' : 'rounded-full border border-white/85 shadow-[0_14px_34px_rgba(15,23,42,0.10)]'}
              />
              <h2 className="mt-5 max-w-full truncate text-xl font-semibold text-[var(--nimi-text-primary)]">
                {selectedContact.displayName}
              </h2>
              <p className="mt-1 max-w-full truncate text-sm text-[var(--nimi-text-muted)]">
                {selectedContact.isAgent ? t('Contacts.agentBadge', { defaultValue: 'Agent' }) : t('Contacts.humanBadge', { defaultValue: 'Human' })}
                {selectedContact.handle ? ` · ${selectedContact.handle}` : ''}
              </p>
              {selectedContact.bio ? (
                <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">
                  {selectedContact.bio}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setProfileModalOpen(true)}
                className="mt-6 inline-flex items-center justify-center rounded-full bg-[#4ECCA3] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(78,204,163,0.24)] transition hover:bg-[#41b992]"
              >
                {t('Contacts.openProfile', { defaultValue: 'Open profile' })}
              </button>
            </div>
          </div>
        ) : null}
        </ScrollArea>
        )}
      </Surface>

      {selectedContact ? (
        <ContactDetailProfileModal
          open={profileModalOpen}
          profileId={selectedContact.id}
          profileSeed={toContactDetailProfileSeed(selectedContact)}
          onClose={() => setProfileModalOpen(false)}
        />
      ) : null}

      {/* Unblock/恢复 确认对话框 */}
      {unblockingContact && (
        <UnblockConfirmDialog
          contact={unblockingContact}
          onConfirm={() => {
            void handleUnblockUser(unblockingContact);
          }}
          onCancel={() => setUnblockingContact(null)}
        />
      )}
    </div>
  );
}
