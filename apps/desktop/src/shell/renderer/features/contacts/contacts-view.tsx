import React, { useState, useMemo, useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { Tooltip } from '@renderer/components/tooltip.js';
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

export function ContactsView(props: ContactsViewProps) {
  const MIN_CONTACTS_SIDEBAR_WIDTH = 280;
  const MAX_CONTACTS_SIDEBAR_WIDTH = 420;
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
  const rememberedProfileId = useAppStore((state) => state.selectedProfileId);
  const setSelectedProfileIsAgent = useAppStore((state) => state.setSelectedProfileIsAgent);
  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [blockingContact, setBlockingContact] = useState<ContactRecord | null>(null);
  const [unblockingContact, setUnblockingContact] = useState<ContactRecord | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ContactRequestRecord | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<TabFilter | null>(null);

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

  // 跟踪已接受的好友请求（用于在列表中显示"Added"状态）
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
      try {
        const result = selectedContact.isAgent
          ? await dataSync.loadAgentDetails(selectedContact.handle || selectedContact.id)
          : await dataSync.loadUserProfile(selectedContact.id);
        return toProfileData(result as Record<string, unknown>);
      } catch (_error) {
        // 如果 API 失败，使用联系人数据构建基础 Profile
        return toProfileData({
          id: selectedContact.id,
          displayName: selectedContact.displayName,
          handle: selectedContact.handle,
          avatarUrl: selectedContact.avatarUrl,
          bio: selectedContact.bio,
          isAgent: selectedContact.isAgent,
          createdAt: selectedContact.friendsSince,
          isFriend: true,
          tags: selectedContact.tags || [],
          languages: [],
          city: selectedContact.location || null,
          countryCode: null,
          gender: selectedContact.gender || null,
          worldName: selectedContact.worldName || null,
          worldBannerUrl: selectedContact.worldBannerUrl || null,
        } as Record<string, unknown>);
      }
    },
    enabled: !!selectedContact,
    retry: 1,
  });

  // 将 ContactRecord 转换为 ProfileData 用于 ProfileView
  const selectedProfile: ProfileData | null = useMemo(() => {
    if (!selectedContact) return null;

    // 如果有查询结果，使用查询结果
    if (profileQuery.data) {
      return profileQuery.data;
    }

    // 否则使用基础数据构建
    return toProfileData({
      id: selectedContact.id,
      displayName: selectedContact.displayName,
      handle: selectedContact.handle,
      avatarUrl: selectedContact.avatarUrl,
      bio: selectedContact.bio,
      isAgent: selectedContact.isAgent,
      createdAt: selectedContact.friendsSince,
      isFriend: true,
      tags: selectedContact.tags || [],
      languages: [],
      city: selectedContact.location || null,
      countryCode: null,
      gender: selectedContact.gender || null,
      worldName: selectedContact.worldName || null,
      worldBannerUrl: selectedContact.worldBannerUrl || null,
    } as Record<string, unknown>);
  }, [selectedContact, profileQuery.data]);

  // Profile 加载和错误状态
  const profileLoading = profileQuery.isPending && !!selectedContact;
  const profileError = profileQuery.isError && !!selectedContact;

  if (props.loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#F5F7FA]">
        <span className="text-sm text-gray-500">{t('Contacts.loading')}</span>
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex h-full items-center justify-center bg-[#F5F7FA]">
        <span className="text-sm text-red-600">{t('Contacts.loadError')}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full bg-[#F5F7FA]">
      {/* 左侧联系人列表 */}
      <aside
        className="relative flex shrink-0 flex-col bg-[#F8F9FB]"
        style={{ width: `${sidebarWidth}px` }}
      >
        {/* 顶部标题 */}
        <div className="flex h-14 items-center px-4 shrink-0">
          <h1 className={APP_PAGE_TITLE_CLASS}>Contacts</h1>
        </div>

        {/* 搜索框 */}
        <div className="px-3 pb-3">
          <div className="flex h-10 items-center gap-2">
            <div className="flex h-10 min-w-0 max-w-[268px] flex-1 items-center rounded-full bg-white px-4 shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="ml-2 min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
                placeholder="Search friends"
                value={props.searchText}
                onChange={(e) => props.onSearchTextChange(e.target.value)}
              />
              {/* 清除按钮 */}
              {props.searchText && (
                <button
                  type="button"
                  onClick={() => {
                    props.onSearchTextChange('');
                    setSelectedContact(null);
                    setSelectedRequest(null);
                    setSelectedCategory(null);
                  }}
                  className="ml-1 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  title="Clear"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <Tooltip content="Add Friend" placement="bottom">
              <button
                type="button"
                onClick={props.onOpenAddContact}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[999px] border-2 border-[#4ECCA3] bg-white text-[#4ECCA3] shadow-sm transition-colors hover:bg-[#4ECCA3]/5"
                aria-label="Add Friend"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* 可展开的分类列表或搜索结果 */}
        <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5">
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
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize contacts sidebar"
          onMouseDown={startResize}
          className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize bg-transparent"
        />
      </aside>

      {/* 右侧详情区 - 使用 ProfileView */}
      <main className="flex-1 flex flex-col min-w-0 bg-white overflow-y-auto">
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
        ) : selectedContact ? (
          <ContactDetailView
            profile={selectedProfile!}
            loading={profileLoading}
            error={profileError}
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
            onRemove={selectedContact ? () => props.onRemoveFriend(selectedContact) : undefined}
            showMessageButton={Boolean(selectedContact?.isAgent && flags.mode === 'desktop')}
          />
        ) : (
          // 空状态 - 显示 Nimi Logo
          <div className="flex-1 flex items-center justify-center bg-white">
            <div className="text-center">
              {/* Nimi Logo */}
              <img
                src={nimiLogo}
                alt="Nimi"
                className="mx-auto w-64 h-64 object-contain"
              />
            </div>
          </div>
        )}
      </main>

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
        receiverAvatarUrl={giftTargetContact?.avatarUrl}
        onClose={() => {
          setGiftModalOpen(false);
          setGiftTargetContact(null);
        }}
        onSent={() => {
          // 可以添加成功提示
          setGiftModalOpen(false);
          setGiftTargetContact(null);
        }}
      />
    </div>
  );
}
