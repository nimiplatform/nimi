import React, { useState, useMemo, useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  IconButton,
  ScrollArea,
  Surface,
  Tooltip,
} from '@nimiplatform/nimi-kit/ui';
import {
  SidebarHeader,
  SidebarResizeHandle,
  SidebarSearch,
  SidebarSection,
  SidebarShell,
} from '@renderer/components/sidebar.js';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { InlineFeedback } from '@renderer/ui/feedback/inline-feedback';
import type { ContactRecord, ContactRequestRecord, TabFilter } from './contacts-model';
import { toProfileData } from '@renderer/features/profile/profile-model';
import type { ProfileData } from '@renderer/features/profile/profile-model';
import {
  isPrivateProfileAccessError,
  toRestrictedContactProfileData,
} from './contact-private-profile.js';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import nimiLogo from '@renderer/assets/logo-gray.png';
import type { ContactsViewProps, BlockedUserInfo } from './contacts-view-types.js';
import { FriendRequestDetail, FriendRequestsList } from './contacts-friend-requests.js';
import { BlockConfirmDialog, RemoveFriendConfirmDialog, UnblockConfirmDialog } from './contacts-blocked-users.js';
import {
  ContactsChipList,
  ContactsFilterChips,
  ContactsRequestsBanner,
  ContactsSearchResults,
  type ContactsChipFilter,
} from './contacts-category-list.js';
import { ContactDetailView } from './contact-detail-view.js';
import {
  ContactDetailErrorState,
  ContactDetailLoadingState,
} from './contact-detail-view-content-shell.js';

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
  const [blockingContact, setBlockingContact] = useState<ContactRecord | null>(null);
  const [unblockingContact, setUnblockingContact] = useState<ContactRecord | null>(null);
  const [removingContact, setRemovingContact] = useState<ContactRecord | null>(null);
  const [blockMutationPending, setBlockMutationPending] = useState(false);
  const [unblockMutationPending, setUnblockMutationPending] = useState(false);
  const [removeMutationPending, setRemoveMutationPending] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ContactRequestRecord | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<TabFilter | null>(null);

  const closeSearch = () => {
    props.onSearchTextChange('');
    setSelectedContact(null);
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

  // 送礼物模态框状态
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [giftTargetContact, setGiftTargetContact] = useState<ContactRecord | null>(null);

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

  const handleBlockUser = async (contact: ContactRecord) => {
    if (blockMutationPending) return;

    try {
      setBlockMutationPending(true);
      await props.onBlockFriend?.(contact);
      if (selectedContact?.id === contact.id) {
        setSelectedContact(null);
      }
      setBlockingContact(null);
    } catch {
      // Parent mutation owns user feedback; keep the dialog open for retry.
    } finally {
      setBlockMutationPending(false);
    }
  };

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

  const handleRemoveUser = async (contact: ContactRecord) => {
    if (removeMutationPending) return;

    try {
      setRemoveMutationPending(true);
      await props.onRemoveFriend(contact);
      if (selectedContact?.id === contact.id) {
        setSelectedContact(null);
        setSelectedProfileId(null);
        setSelectedProfileIsAgent(null);
      }
      setRemovingContact(null);
    } catch {
      // Parent mutation owns user feedback; keep the dialog open for retry.
    } finally {
      setRemoveMutationPending(false);
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
    setSelectedContact((prev) => {
      if (!prev) return prev;
      const updated = props.allFriends.find((c) => c.id === prev.id);
      if (!updated) return prev;
      if (updated.avatarUrl === prev.avatarUrl && updated.displayName === prev.displayName) return prev;
      return updated;
    });
  }, [props.allFriends]);

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
    setSelectedRequest(null);
    setSelectedCategory(nextCategory);
    props.onFilterChange(nextCategory);
  }, [props, rememberedProfileId, selectedContact, selectedRequest]);

  const handleSelectContact = (contact: ContactRecord, categoryId: TabFilter) => {
    setSelectedContact(contact);
    setSelectedRequest(null);
    setSelectedCategory(categoryId);
    setSelectedProfileId(contact.id);
    setSelectedProfileIsAgent(contact.isAgent);
    props.onFilterChange(categoryId);
  };

  // 加载选中联系人的 Profile 数据
  const profileQuery = useQuery({
    queryKey: ['contact-profile', selectedContact?.id, 'restricted-state-v1'],
    queryFn: async () => {
      if (!selectedContact) return null;
      try {
        const result = selectedContact.isAgent
          ? await dataSync.loadAgentDetails(selectedContact.id)
          : await dataSync.loadUserProfile(selectedContact.id);
        return toProfileData(result);
      } catch (error) {
        if (!selectedContact.isAgent && isPrivateProfileAccessError(error)) {
          return toRestrictedContactProfileData(selectedContact);
        }
        throw error;
      }
    },
    enabled: !!selectedContact,
    retry: (failureCount, error) => !isPrivateProfileAccessError(error) && failureCount < 1,
  });

  const selectedContactIsBlocked = Boolean(
    selectedContact && (selectedCategory === 'blocks' || blockedUsers.has(selectedContact.id)),
  );

  const selectedProfile: ProfileData | null = useMemo(() => {
    if (!selectedContact || !profileQuery.data) return null;
    if (selectedContactIsBlocked) {
      return { ...profileQuery.data, isFriend: false };
    }
    if (!profileQuery.data.isFriend) {
      return { ...profileQuery.data, isFriend: true };
    }
    return profileQuery.data;
  }, [profileQuery.data, selectedContact, selectedContactIsBlocked]);

  // Profile 加载和错误状态
  const profileError = profileQuery.isError && !!selectedContact;
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

      {/* 右侧详情区 - 使用共享 profile 详情页 */}
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
        ) : selectedContact && selectedProfile ? (
          <ContactDetailView
            profile={selectedProfile}
            loading={false}
            error={false}
            isBlockedProfile={selectedContactIsBlocked}
            isRestrictedProfile={selectedProfile.accessState === 'restricted'}
            onClose={() => {
              setSelectedContact(null);
              setSelectedProfileId(null);
              setSelectedProfileIsAgent(null);
            }}
            onMessage={selectedProfile.accessState === 'restricted' || selectedContactIsBlocked ? () => {} : () => {
              if (selectedContact) {
                props.onMessage(selectedContact);
              }
            }}
            onSendGift={selectedProfile.accessState === 'restricted' ? () => {} : () => {
              // 打开送礼物模态框
              if (selectedContact) {
                setGiftTargetContact(selectedContact);
                setGiftModalOpen(true);
              }
            }}
            onBlock={selectedContact ? () => setBlockingContact(selectedContact) : undefined}
            onRemove={selectedContact ? () => setRemovingContact(selectedContact) : undefined}
            showMessageButton={
              selectedProfile.accessState !== 'restricted'
              && !selectedContactIsBlocked
              && (!selectedProfile.isAgent || (selectedContact?.isAgent === true && selectedProfile.isFriend))
            }
            hideBackButton
          />
        ) : selectedContact && profileError ? (
          <div className="flex h-full items-center justify-center bg-transparent px-6 py-6">
            <ContactDetailErrorState
              backLabel={t('Common.back')}
              label={t('ProfileView.error')}
              onClose={() => {
                setSelectedContact(null);
                setSelectedProfileId(null);
                setSelectedProfileIsAgent(null);
              }}
            />
          </div>
        ) : selectedContact ? (
          <div className="flex h-full items-center justify-center bg-transparent px-6 py-6">
            <ContactDetailLoadingState label={t('ProfileView.loading', { defaultValue: 'Loading profile...' })} />
          </div>
        ) : null}
        </ScrollArea>
        )}
      </Surface>

      {/* Block 确认对话框 */}
      {blockingContact && (
        <BlockConfirmDialog
          contact={blockingContact}
          onConfirm={() => {
            void handleBlockUser(blockingContact);
          }}
          onCancel={() => setBlockingContact(null)}
        />
      )}

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

      {/* Remove friend confirmation dialog */}
      {removingContact && (
        <RemoveFriendConfirmDialog
          contact={removingContact}
          pending={removeMutationPending}
          onConfirm={() => {
            void handleRemoveUser(removingContact);
          }}
          onCancel={() => {
            if (!removeMutationPending) {
              setRemovingContact(null);
            }
          }}
        />
      )}

      {/* 送礼物模态框 */}
      <SendGiftModal
        open={giftModalOpen && !!giftTargetContact}
        receiverId={giftTargetContact?.id || ''}
        receiverName={giftTargetContact?.displayName || giftTargetContact?.handle || 'User'}
        receiverHandle={giftTargetContact?.handle}
        receiverIsAgent={giftTargetContact?.isAgent === true}
        receiverAvatarUrl={giftTargetContact?.avatarUrl}
        onClose={() => {
          setGiftModalOpen(false);
          setGiftTargetContact(null);
        }}
        onSent={() => {
          setGiftModalOpen(false);
          setGiftTargetContact(null);
        }}
      />
    </div>
  );
}
