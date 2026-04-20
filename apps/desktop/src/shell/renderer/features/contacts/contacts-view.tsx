import React, { useState, useMemo, useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { IconButton, ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SidebarResizeHandle, SidebarSection, SidebarShell } from '@renderer/components/sidebar.js';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { InlineFeedback } from '@renderer/ui/feedback/inline-feedback';
import type { ContactRecord, ContactRequestRecord, TabFilter } from './contacts-model';
import { toProfileData } from '@renderer/features/profile/profile-model';
import type { ProfileData } from '@renderer/features/profile/profile-model';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import nimiLogo from '@renderer/assets/logo-gray.png';
import type { ContactsViewProps, BlockedUserInfo } from './contacts-view-types.js';
import { FriendRequestDetail, FriendRequestsList } from './contacts-friend-requests.js';
import { BlockConfirmDialog, UnblockConfirmDialog } from './contacts-blocked-users.js';
import { ContactsSearchResults, ContactsCategoryAccordion } from './contacts-category-list.js';
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
    <div data-testid={E2E_IDS.panel('contacts')} className="flex h-full gap-4 px-5 pb-5 pt-4">
      <Surface
        as="aside"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="relative flex w-[320px] shrink-0 flex-col rounded-3xl border-white/60 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
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
        className="flex min-w-0 flex-1 flex-col rounded-3xl border-white/60 p-8 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
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

export function ContactsView(props: ContactsViewProps) {
  const MIN_CONTACTS_SIDEBAR_WIDTH = 240;
  const MAX_CONTACTS_SIDEBAR_WIDTH = 460;
  const { t } = useTranslation();
  const rememberedProfileId = useAppStore((state) => state.selectedProfileId);
  const setSelectedProfileIsAgent = useAppStore((state) => state.setSelectedProfileIsAgent);
  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [blockingContact, setBlockingContact] = useState<ContactRecord | null>(null);
  const [unblockingContact, setUnblockingContact] = useState<ContactRecord | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ContactRequestRecord | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<TabFilter | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    props.onSearchTextChange('');
    setSelectedContact(null);
    setSelectedRequest(null);
    setSelectedCategory(null);
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

  // 处理联系人侧栏拖拽缩放。
  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const nextWidth = Math.min(
        MAX_CONTACTS_SIDEBAR_WIDTH,
        Math.max(MIN_CONTACTS_SIDEBAR_WIDTH, Math.round(event.clientX - rect.left)),
      );
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const [acceptedRequests, setAcceptedRequests] = useState<Set<string>>(new Set());

  // 跟踪已拒绝的好友请求
  const [rejectedRequests, setRejectedRequests] = useState<Set<string>>(new Set());

  // 送礼物模态框状态
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [giftTargetContact, setGiftTargetContact] = useState<ContactRecord | null>(null);

  // 跟踪展开的分类（可以同时展开多个）- 默认全部折叠
  const [expandedCategories, setExpandedCategories] = useState<Set<TabFilter>>(new Set());

  // 切换分类展开/折叠
  const toggleCategory = (categoryId: TabFilter) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  // 判断用户是否被拉黑
  const isUserBlocked = (userId: string): boolean => {
    return blockedUsers.has(userId);
  };

  // 获取被拉黑用户的原始分类
  const getBlockedUserPreviousCategory = (userId: string): TabFilter | null => {
    const info = blockedUsers.get(userId);
    return info?.previousCategory || null;
  };

  // 根据分类获取联系人 - 使用 allFriends 获取完整列表，并过滤掉被拉黑的
  const getContactsByCategory = (categoryId: TabFilter): ContactRecord[] => {
    if (categoryId === 'requests') return [];
    if (categoryId === 'blocks') {
      // Blocks 分类：返回所有被拉黑的用户
      return Array.from(blockedUsers.values());
    }

    const allContacts = props.allFriends;

    return allContacts.filter(c => {
      // 如果被拉黑了，不在任何普通分类中显示
      if (isUserBlocked(c.id)) return false;

      if (categoryId === 'humans') return !c.isAgent;
      if (categoryId === 'agents') return c.isAgent && c.agentOwnershipType !== 'MASTER_OWNED';
      if (categoryId === 'myAgents') return c.isAgent && c.agentOwnershipType === 'MASTER_OWNED';
      return false;
    });
  };

  // 处理拉黑用户
  const handleBlockUser = (contact: ContactRecord) => {
    // 记录当前分类（如果正在查看该联系人）
    const currentCat = selectedCategory;

    const blockedInfo: BlockedUserInfo = {
      ...contact,
      previousCategory: currentCat || 'humans', // 默认恢复到 humans
      blockedAt: Date.now(),
    };

    setBlockedUsers(prev => {
      const newMap = new Map(prev);
      newMap.set(contact.id, blockedInfo);
      return newMap;
    });

    // 如果当前正在查看被拉黑的联系人，清空选中
    if (selectedContact?.id === contact.id) {
      setSelectedContact(null);
    }

    // 展开 Blocks 分类以便用户看到
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      newSet.add('blocks');
      return newSet;
    });

    // 调用父组件的回调
    props.onBlockFriend?.(contact);
    setBlockingContact(null);
  };

  // 处理解除拉黑
  const handleUnblockUser = (contact: ContactRecord) => {
    const previousCategory = getBlockedUserPreviousCategory(contact.id);

    setBlockedUsers(prev => {
      const newMap = new Map(prev);
      newMap.delete(contact.id);
      return newMap;
    });

    // 如果当前正在查看该联系人，清空选中
    if (selectedContact?.id === contact.id) {
      setSelectedContact(null);
    }

    // 展开原来的分类以便用户看到恢复的用户
    if (previousCategory && previousCategory !== 'blocks') {
      setExpandedCategories(prev => {
        const newSet = new Set(prev);
        newSet.add(previousCategory);
        return newSet;
      });
    }

    // 调用父组件的回调
    props.onUnblockUser?.(contact);
    setUnblockingContact(null);
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
    const nextCategory: TabFilter = restoredContact.isAgent
      ? (restoredContact.agentOwnershipType === 'MASTER_OWNED' ? 'myAgents' : 'agents')
      : 'humans';
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
    queryKey: ['contact-profile', selectedContact?.id],
    queryFn: async () => {
      if (!selectedContact) return null;
      const result = selectedContact.isAgent
        ? await dataSync.loadAgentDetails(selectedContact.id)
        : await dataSync.loadUserProfile(selectedContact.id);
      return toProfileData(result);
    },
    enabled: !!selectedContact,
    retry: 1,
  });

  const selectedProfile: ProfileData | null = useMemo(() => {
    if (!selectedContact || !profileQuery.data) return null;
    if (!profileQuery.data.isFriend) {
      return { ...profileQuery.data, isFriend: true };
    }
    return profileQuery.data;
  }, [profileQuery.data, selectedContact]);

  // Profile 加载和错误状态
  const profileError = profileQuery.isError && !!selectedContact;

  if (props.loading) {
    return <ContactsLoadingSkeleton />;
  }

  if (props.error) {
    return (
      <div data-testid={E2E_IDS.panel('contacts')} className="flex h-full px-5 pb-5 pt-4">
        <Surface
          tone="panel"
          material="glass-regular"
          className="flex flex-1 items-center justify-center rounded-3xl border-white/60 text-sm text-red-600 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
        >
          {t('Contacts.loadError')}
        </Surface>
      </div>
    );
  }

  return (
    <div ref={containerRef} data-testid={E2E_IDS.panel('contacts')} className="flex h-full gap-4 px-5 pb-5 pt-4 text-[var(--nimi-text-primary)]">
      {/* 左侧联系人列表 */}
      <SidebarShell
        width={sidebarWidth}
        className="border border-white/60 border-r-[color-mix(in_srgb,var(--nimi-border-subtle)_82%,white)] bg-[var(--nimi-sidebar-canvas)] shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
        data-testid={E2E_IDS.panel('contacts')}
      >
        <div className="relative flex shrink-0 items-center min-h-[var(--nimi-sidebar-header-height)] px-4 gap-2 overflow-hidden">
          <h1
            className={`nimi-type-page-title text-[color:var(--nimi-text-primary)] transition-opacity duration-200 ${searchOpen ? 'opacity-0' : 'opacity-100'}`}
          >
            {t('Contacts.title')}
          </h1>
          <div
            className={`ml-auto flex items-center gap-1 transition-opacity duration-200 ${searchOpen ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          >
            <Tooltip content={t('Contacts.searchPlaceholder', { defaultValue: 'Search friends' })} placement="bottom">
              <IconButton
                onClick={() => setSearchOpen(true)}
                tone="ghost"
                icon={(
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                )}
                className="h-9 w-9 shrink-0 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]"
                aria-label={t('Contacts.searchPlaceholder', { defaultValue: 'Search friends' })}
              />
            </Tooltip>
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
          </div>
          <div
            className={`absolute inset-y-0 right-0 flex items-center gap-2 pl-3 pr-4 bg-[var(--nimi-sidebar-canvas)] transition-transform duration-200 ease-out ${searchOpen ? 'w-full translate-x-0' : 'w-full translate-x-full pointer-events-none'}`}
          >
            <div className="flex min-w-0 flex-1 items-center rounded-full bg-[var(--nimi-action-ghost-hover)] px-3 py-1.5">
              <span className="shrink-0 text-[var(--nimi-text-muted)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                ref={searchInputRef}
                className="ml-2 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--nimi-field-placeholder)]"
                value={props.searchText}
                onChange={(event) => props.onSearchTextChange(event.target.value)}
                placeholder={t('Contacts.searchPlaceholder', { defaultValue: 'Search friends' })}
                aria-label={t('Contacts.searchPlaceholder', { defaultValue: 'Search friends' })}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    closeSearch();
                  }
                }}
              />
            </div>
            <Tooltip content={t('Home.clear', { defaultValue: 'Clear' })} placement="bottom">
              <IconButton
                onClick={closeSearch}
                tone="ghost"
                icon={(
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}
                className="h-9 w-9 shrink-0 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]"
                aria-label={t('Home.clear', { defaultValue: 'Clear' })}
              />
            </Tooltip>
          </div>
        </div>

        <ScrollArea
          className="flex-1"
          contentClassName="space-y-1 py-1.5"
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
              <ContactsCategoryAccordion
                counts={counts}
                expandedCategories={expandedCategories}
                filteredRequests={props.filteredRequests}
                acceptedRequests={acceptedRequests}
                rejectedRequests={rejectedRequests}
                currentContactId={selectedContact?.id ?? null}
                getContactsByCategory={getContactsByCategory}
                onToggleCategory={toggleCategory}
                onSelectContact={handleSelectContact}
                onAcceptRequest={(request) => {
                  props.onAcceptRequest(request);
                  setAcceptedRequests(prev => new Set(prev).add(request.userId));
                }}
                onRejectRequest={(request) => {
                  props.onRejectRequest(request);
                  setRejectedRequests(prev => new Set(prev).add(request.userId));
                }}
                onUnblock={(contact) => setUnblockingContact(contact)}
                onSelectRequests={() => {
                  setSelectedCategory('requests');
                  setSelectedRequest(null);
                  setSelectedContact(null);
                }}
              />
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
              props.onAcceptRequest(selectedRequest);
              setAcceptedRequests(prev => new Set(prev).add(selectedRequest.userId));
            }}
            onReject={() => props.onRejectRequest(selectedRequest)}
            onCancel={() => props.onCancelRequest(selectedRequest)}
          />
        ) : selectedCategory === 'requests' ? (
          // New Friends 列表页 - 显示所有请求（按时间排序）
          <FriendRequestsList
            requests={props.filteredRequests.filter(r => r.direction === 'received')}
            acceptedRequests={acceptedRequests}
            rejectedRequests={rejectedRequests}
            onAccept={(req) => {
              props.onAcceptRequest(req);
              setAcceptedRequests(prev => new Set(prev).add(req.userId));
            }}
            onReject={(req) => {
              props.onRejectRequest(req);
              setRejectedRequests(prev => new Set(prev).add(req.userId));
            }}
          />
        ) : selectedContact && selectedProfile ? (
          <ContactDetailView
            profile={selectedProfile}
            loading={false}
            error={false}
            onClose={() => {
              setSelectedContact(null);
              setSelectedProfileId(null);
              setSelectedProfileIsAgent(null);
            }}
            onMessage={() => {
              if (selectedContact) {
                props.onMessage(selectedContact);
              }
            }}
            onSendGift={() => {
              // 打开送礼物模态框
              if (selectedContact) {
                setGiftTargetContact(selectedContact);
                setGiftModalOpen(true);
              }
            }}
            onBlock={selectedContact ? () => setBlockingContact(selectedContact) : undefined}
            onRemove={selectedContact ? () => {
              const removedContact = selectedContact;
              props.onRemoveFriend(removedContact);
              setSelectedContact(null);
              setSelectedProfileId(null);
              setSelectedProfileIsAgent(null);
            } : undefined}
            showMessageButton={!selectedProfile?.isAgent}
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
          onConfirm={() => handleBlockUser(blockingContact)}
          onCancel={() => setBlockingContact(null)}
        />
      )}

      {/* Unblock/恢复 确认对话框 */}
      {unblockingContact && (
        <UnblockConfirmDialog
          contact={unblockingContact}
          onConfirm={() => handleUnblockUser(unblockingContact)}
          onCancel={() => setUnblockingContact(null)}
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
