import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import type { ContactRecord, ContactRequestRecord, TabFilter } from './contacts-model';
import { getContactInitial } from './contacts-model';
import { ProfileView } from '@renderer/features/profile/profile-view';
import { toProfileData } from '@renderer/features/profile/profile-model';
import type { ProfileData } from '@renderer/features/profile/profile-model';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import nimiLogo from '@renderer/assets/logo-gray.png';

type ContactsViewProps = {
  searchText: string;
  activeFilter: TabFilter;
  humansCount: number;
  agentsCount: number;
  myAgentsCount: number;
  requestsCount: number;
  blocksCount: number;
  blockedContacts: ContactRecord[];
  agentLimit: {
    used: number;
    limit: number;
    canAdd: boolean;
    reason: string | null;
  } | null;
  allFriends: ContactRecord[];
  filteredContacts: ContactRecord[];
  filteredRequests: ContactRequestRecord[];
  loading: boolean;
  error: boolean;
  onSearchTextChange: (value: string) => void;
  onFilterChange: (filter: TabFilter) => void;
  onMessage: (contact: ContactRecord) => void;
  onViewProfile: (contact: ContactRecord) => void;
  onViewRequestProfile: (request: ContactRequestRecord) => void;
  onAcceptRequest: (request: ContactRequestRecord) => void;
  onRejectRequest: (request: ContactRequestRecord) => void;
  onCancelRequest: (request: ContactRequestRecord) => void;
  onRemoveFriend: (contact: ContactRecord) => void;
  onBlockFriend?: (contact: ContactRecord) => void;
  onUnblockUser?: (contact: ContactRecord) => void;
  onOpenAddContact: () => void;
};

// 分类配置
const CATEGORIES = [
  { id: 'requests' as TabFilter, label: 'New Friends', icon: '👋', countKey: 'requestsCount' },
  { id: 'humans' as TabFilter, label: 'Humans', icon: '👤', countKey: 'humansCount' },
  { id: 'agents' as TabFilter, label: 'Agents', icon: '🤖', countKey: 'agentsCount' },
  { id: 'myAgents' as TabFilter, label: 'My Agents', icon: '⭐', countKey: 'myAgentsCount' },
  { id: 'blocks' as TabFilter, label: 'Blocks', icon: '🚫', countKey: 'blocksCount' },
];

// 记录被拉黑用户的完整信息和之前的分类，用于恢复
interface BlockedUserInfo extends ContactRecord {
  previousCategory: TabFilter;
  blockedAt: number;
}

// Mock 好友请求数据
const MOCK_REQUESTS: ContactRequestRecord[] = [
  {
    id: 'req-1',
    userId: 'user-1',
    displayName: 'Sarah Chen',
    handle: '@sarah_chen',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah&backgroundColor=b6e3f4',
    bio: 'Hi! I would love to connect with you.',
    isAgent: false,
    direction: 'received',
    requestedAt: new Date().toISOString(),
  },
  {
    id: 'req-2',
    userId: 'user-2',
    displayName: 'Alex Morgan',
    handle: '@alex_m',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex&backgroundColor=c0aede',
    bio: 'We met at the tech conference last week!',
    isAgent: false,
    direction: 'received',
    requestedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'req-3',
    userId: 'user-3',
    displayName: 'TechBot Pro',
    handle: '~techbot_pro',
    avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=TechBot&backgroundColor=ffdfbf',
    bio: 'Your AI assistant for coding tasks.',
    isAgent: true,
    direction: 'received',
    requestedAt: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: 'req-4',
    userId: 'user-4',
    displayName: 'Emily Watson',
    handle: '@emily_w',
    avatarUrl: null,
    bio: 'Hello, I am interested in connecting!',
    isAgent: false,
    direction: 'received',
    requestedAt: new Date(Date.now() - 259200000).toISOString(),
  },
  {
    id: 'req-5',
    userId: 'user-5',
    displayName: 'Creative AI',
    handle: '~creative_ai',
    avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Creative&backgroundColor=ffd5dc',
    bio: 'An AI focused on creative writing and art.',
    isAgent: true,
    direction: 'received',
    requestedAt: new Date(Date.now() - 345600000).toISOString(),
  },
];

export function ContactsView(props: ContactsViewProps) {
  const { t } = useTranslation();
  const [removingContact, setRemovingContact] = useState<ContactRecord | null>(null);
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
  const [acceptedRequests, setAcceptedRequests] = useState<Set<string>>(new Set());
  
  // 跟踪已拒绝的好友请求
  const [rejectedRequests, setRejectedRequests] = useState<Set<string>>(new Set(['user-5'])); // mock: user-5 被拒绝
  
  // 从好友请求接受而来的联系人（需要添加到 Humans 列表）
  const [newFriendsFromRequests, setNewFriendsFromRequests] = useState<ContactRecord[]>([]);
  
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

  // 获取当前选中项
  const currentContact = selectedContact;
  const currentRequest = selectedRequest;
  
  // 当前选中项所属的分类
  const currentCategory = selectedCategory;

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
    
    // 合并原始联系人和从好友请求添加的新联系人
    const allContacts = [...props.allFriends, ...newFriendsFromRequests];
    
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
    // 计算待处理的好友请求数量（未接受的 received 请求）
    const pendingRequestsCount = MOCK_REQUESTS.filter(
      r => r.direction === 'received' && !acceptedRequests.has(r.userId)
    ).length;
    return {
      ...props,
      blocksCount: blockedCount,
      requestsCount: pendingRequestsCount,
    };
  };

  const counts = getUpdatedCounts();

  // 按字母分组联系人
  const groupContactsByLetter = (contacts: ContactRecord[]) => {
    const groups: Record<string, ContactRecord[]> = {};
    contacts.forEach(contact => {
      const firstChar = contact.displayName.charAt(0).toUpperCase();
      const key = /^[A-Z]$/i.test(firstChar) ? firstChar : '#';
      if (!groups[key]) groups[key] = [];
      groups[key].push(contact);
    });
    
    Object.keys(groups).forEach(key => {
      if (groups[key]) {
        groups[key].sort((a, b) => a.displayName.localeCompare(b.displayName));
      }
    });
    
    return groups;
  };

  // 处理选择联系人
  const handleSelectContact = (contact: ContactRecord, categoryId: TabFilter) => {
    setSelectedContact(contact);
    setSelectedRequest(null);
    setSelectedCategory(categoryId);
    props.onFilterChange(categoryId);
  };

  // 加载选中联系人的 Profile 数据
  const profileQuery = useQuery({
    queryKey: ['contact-profile', selectedContact?.id],
    queryFn: async () => {
      if (!selectedContact) return null;
      try {
        const result = await dataSync.loadUserProfile(selectedContact.id);
        return toProfileData(result as Record<string, unknown>);
      } catch (error) {
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
    <div className="flex h-full bg-[#F5F7FA]">
      {/* 左侧联系人列表 */}
      <aside className="w-[320px] flex flex-col bg-[#F8F9FB] border-r border-gray-200">
        {/* 顶部标题 */}
        <div className="flex h-14 items-center px-4 shrink-0">
          <h1 className="text-lg font-semibold text-gray-900">Contacts</h1>
        </div>

        {/* 搜索框 */}
        <div className="px-3 pb-3">
          <div className="flex h-10 items-center gap-2">
            <div className="flex-1 flex h-10 items-center rounded-full bg-white px-4 shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="ml-2 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
                placeholder="Search"
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
                  className="ml-1 flex h-6 w-6 items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Clear"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={props.onOpenAddContact}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white border-2 border-[#4ECCA3] text-[#4ECCA3] hover:bg-[#4ECCA3]/5 transition-colors shadow-sm"
              title="Add Friend"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 可展开的分类列表或搜索结果 */}
        <div className="flex-1 overflow-y-auto py-2 space-y-1">
          {props.searchText.trim() ? (
            // 搜索结果显示 - 按分组显示
            (() => {
              const query = props.searchText.trim().toLowerCase();
              const allContacts = [...props.allFriends, ...newFriendsFromRequests].filter(c => !isUserBlocked(c.id));
              
              // 直接匹配的联系人
              const directMatches = allContacts.filter(c => 
                c.displayName.toLowerCase().includes(query) || c.handle.toLowerCase().includes(query)
              );
              
              // 按分类分组直接匹配
              const humans = directMatches.filter(c => !c.isAgent);
              const agents = directMatches.filter(c => c.isAgent && c.agentOwnershipType !== 'MASTER_OWNED');
              const myAgents = directMatches.filter(c => c.isAgent && c.agentOwnershipType === 'MASTER_OWNED');
              
              // 收集匹配联系人所属的 world
              const matchedWorldIds = new Set<string>();
              const matchedWorldNames = new Map<string, string>();
              directMatches.forEach(c => {
                if (c.worldId) {
                  matchedWorldIds.add(c.worldId);
                  if (c.worldName) matchedWorldNames.set(c.worldId, c.worldName);
                }
              });
              
              // 查找同 world 的其他好友（排除已直接匹配的）
              const directMatchIds = new Set(directMatches.map(c => c.id));
              const worldRelatedContacts = allContacts.filter(c => 
                c.worldId && matchedWorldIds.has(c.worldId) && !directMatchIds.has(c.id)
              );
              
              // 按 world 名称分组
              const worldGroups = new Map<string, ContactRecord[]>();
              worldRelatedContacts.forEach(c => {
                if (c.worldId) {
                  if (!worldGroups.has(c.worldId)) {
                    worldGroups.set(c.worldId, []);
                  }
                  worldGroups.get(c.worldId)!.push(c);
                }
              });
              
              const baseGroups: Array<{id: TabFilter; title: string; items: ContactRecord[]; worldId?: string}> = [
                { id: 'humans', title: t('Contacts.tabHumans'), items: humans },
                { id: 'agents', title: t('Contacts.tabAgents'), items: agents },
                { id: 'myAgents', title: t('Contacts.tabMyAgents'), items: myAgents },
              ];
              const worldGroupList: Array<{id: TabFilter; title: string; items: ContactRecord[]; worldId?: string}> = worldGroups.size > 0 
                ? Array.from(worldGroups.entries()).map(([worldId, items]) => ({
                    id: 'world' as TabFilter,
                    title: matchedWorldNames.get(worldId) || t('world') || 'World',
                    items,
                    worldId,
                  }))
                : [];
              const groups = [...baseGroups, ...worldGroupList].filter(g => g.items.length > 0);
              
              // 高亮匹配文字的组件
              const HighlightText = ({ text, query }: { text: string; query: string }) => {
                if (!query) return <>{text}</>;
                const lowerText = text.toLowerCase();
                const lowerQuery = query.toLowerCase();
                const parts: (string | React.ReactNode)[] = [];
                let lastIndex = 0;
                let index = lowerText.indexOf(lowerQuery);
                
                while (index !== -1) {
                  if (index > lastIndex) {
                    parts.push(text.slice(lastIndex, index));
                  }
                  parts.push(<span key={index} className="text-[#4ECCA3] font-medium">{text.slice(index, index + query.length)}</span>);
                  lastIndex = index + query.length;
                  index = lowerText.indexOf(lowerQuery, lastIndex);
                }
                if (lastIndex < text.length) {
                  parts.push(text.slice(lastIndex));
                }
                return <>{parts}</>;
              };
              
              if (groups.length === 0) {
                return (
                  <div className="px-4 py-6 text-center">
                    <div className="text-3xl mb-2">🔍</div>
                    <div className="text-sm text-gray-400">No contacts found</div>
                  </div>
                );
              }
              
              return (
                <div className="space-y-4">
                  {groups.map((group) => (
                    <div key={`${group.id}-${group.title}`}>
                      {/* 分组标题 */}
                      <div className="px-3 py-1.5 text-xs text-gray-500 font-medium flex items-center justify-between">
                        <span>{group.title}</span>
                        <span className="text-gray-400">({group.items.length})</span>
                      </div>
                      {/* 该分组下的联系人 */}
                      <div className="space-y-0.5">
                        {group.items.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => handleSelectContact(contact, group.id === 'world' ? (contact.isAgent ? 'agents' : 'humans') : group.id)}
                            className={`flex w-full items-center gap-3 px-3 py-2.5 mx-1 text-left rounded-lg transition-all duration-150 ${
                              selectedContact?.id === contact.id 
                                ? 'bg-green-100 text-green-800' 
                                : 'hover:bg-green-50/50 text-gray-700'
                            }`}
                          >
                            {contact.avatarUrl ? (
                              <img 
                                src={contact.avatarUrl} 
                                alt={contact.displayName} 
                                className="h-10 w-10 rounded-lg object-cover"
                                style={contact.isAgent ? {
                                  boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
                                } : undefined}
                              />
                            ) : (
                              <div 
                                className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium ${
                                  contact.isAgent 
                                    ? 'bg-gradient-to-br from-[#4ECCA3] to-[#3DBB94] text-white'
                                    : 'bg-gradient-to-br from-green-400 to-green-500 text-white'
                                }`}
                                style={contact.isAgent ? {
                                  boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
                                } : undefined}
                              >
                                {getContactInitial(contact.displayName)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0 text-left">
                              <div className="text-[15px] text-gray-900 truncate">
                                <HighlightText text={contact.displayName} query={query} />
                              </div>
                              <div className="text-xs text-gray-400 truncate">
                                {group.id === 'world' ? (
                                  <span className="text-[#4ECCA3]">{contact.handle}</span>
                                ) : (
                                  <HighlightText text={contact.handle} query={query} />
                                )}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          ) : (
            // 分类列表显示
            CATEGORIES.map((category) => {
            const count = counts[category.countKey as keyof typeof counts] as number;
            const isExpanded = expandedCategories.has(category.id);
            const isRequests = category.id === 'requests';
            const isBlocks = category.id === 'blocks';
            
            // 获取该分类下的项目（使用 mock 数据用于展示）
            const items = isRequests 
              ? MOCK_REQUESTS 
              : getContactsByCategory(category.id);
            
            // 按字母分组（仅联系人）
            const groupedItems = isRequests ? {} : groupContactsByLetter(items as ContactRecord[]);
            const sortedKeys = Object.keys(groupedItems).sort((a, b) => {
              if (a === '#') return 1;
              if (b === '#') return -1;
              return a.localeCompare(b);
            });

            return (
              <div key={category.id} className="px-2">
                {/* 分类标题 - 可点击展开/折叠 */}
                <button
                  type="button"
                  onClick={() => {
                    toggleCategory(category.id);
                    // 点击 New Friends 时，在右侧显示列表
                    if (category.id === 'requests') {
                      setSelectedCategory('requests');
                      setSelectedRequest(null);
                      setSelectedContact(null);
                    }
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left rounded-lg transition-all duration-150 ${
                    isExpanded 
                      ? 'bg-green-50 text-green-700' 
                      : 'hover:bg-green-50/60 text-gray-700'
                  }`}
                >
                  {/* 展开/折叠箭头 */}
                  <svg 
                    width="14" 
                    height="14" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    className={`transition-transform duration-200 ${isExpanded ? 'rotate-90 text-green-600' : 'text-gray-400'}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  
                  <span className="text-xl">{category.icon}</span>
                  <span className={`flex-1 text-[14px] font-medium ${isExpanded ? 'text-green-800' : 'text-gray-700'}`}>
                    {category.label}
                  </span>
                  {count > 0 && (
                    <span className={`text-xs ${isExpanded ? 'text-green-600' : 'text-gray-400'}`}>{count}</span>
                  )}
                </button>

                {/* 展开的列表内容 */}
                {isExpanded && (
                  <div className="mt-1 py-1">
                    {isRequests ? (
                      // 新的朋友列表 - 只显示待处理的 received 请求（未接受且未拒绝）
                      (items as ContactRequestRecord[])
                        .filter(r => r.direction === 'received' && !acceptedRequests.has(r.userId) && !rejectedRequests.has(r.userId))
                        .map((request) => {
                        return (
                          <div
                            key={`${request.direction}:${request.userId}`}
                            className="flex w-full items-center gap-3 px-3 py-2.5 mx-1 rounded-lg transition-all duration-150 hover:bg-green-50/50 text-gray-700"
                          >
                            {/* 头像 */}
                            {request.avatarUrl ? (
                              <img src={request.avatarUrl} alt={request.displayName} className="h-10 w-10 rounded-lg object-cover" />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-500 text-sm font-medium text-white">
                                {getContactInitial(request.displayName)}
                              </div>
                            )}
                            
                            {/* 名字和留言 */}
                            <div className="flex-1 min-w-0">
                              <div className="text-[15px] text-gray-900 truncate">{request.displayName}</div>
                              <div className="text-[13px] text-gray-500 truncate">{request.bio || 'Wants to add you as a friend'}</div>
                            </div>
                            
                            {/* 操作按钮 - 只显示待处理的 received 请求 */}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  props.onAcceptRequest(request);
                                  setAcceptedRequests(prev => new Set(prev).add(request.userId));
                                  // 将接受的请求转换为联系人并添加到 Humans 列表
                                  const newContact: ContactRecord = {
                                    id: request.userId,
                                    displayName: request.displayName,
                                    handle: request.handle,
                                    avatarUrl: request.avatarUrl,
                                    bio: request.bio,
                                    isAgent: request.isAgent,
                                    friendsSince: new Date().toISOString(),
                                    agentOwnershipType: request.isAgent ? 'WORLD_OWNED' : null,
                                  };
                                  setNewFriendsFromRequests(prev => [...prev, newContact]);
                                }}
                                className="px-3 py-1.5 text-xs font-medium bg-[#4ECCA3] text-white rounded-lg hover:bg-[#3DBA92] transition-colors"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  props.onRejectRequest(request);
                                  setRejectedRequests(prev => new Set(prev).add(request.userId));
                                }}
                                className="px-3 py-1.5 text-xs font-medium bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 transition-colors"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : isBlocks ? (
                      // Blocks 列表 - 显示拉黑的用户，带有恢复按钮
                      (items as ContactRecord[]).length === 0 ? (
                        <div className="px-4 py-3 text-sm text-gray-400">No blocked contacts</div>
                      ) : (
                        (items as ContactRecord[]).map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => handleSelectContact(contact, 'blocks')}
                            className={`flex w-full items-center gap-3 px-3 py-2.5 mx-1 text-left rounded-lg transition-all duration-150 ${
                              currentContact?.id === contact.id 
                                ? 'bg-green-100 text-green-800' 
                                : 'hover:bg-green-50/50 text-gray-700'
                            }`}
                          >
                            {contact.avatarUrl ? (
                              <img 
                                src={contact.avatarUrl} 
                                alt={contact.displayName} 
                                className="h-10 w-10 rounded-lg object-cover"
                                style={contact.isAgent ? {
                                  boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
                                } : undefined}
                              />
                            ) : (
                              <div 
                                className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium ${
                                  contact.isAgent 
                                    ? 'bg-gradient-to-br from-[#4ECCA3] to-[#3DBB94] text-white'
                                    : 'bg-gradient-to-br from-green-400 to-green-500 text-white'
                                }`}
                                style={contact.isAgent ? {
                                  boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
                                } : undefined}
                              >
                                {getContactInitial(contact.displayName)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0 text-left">
                              <div className="text-[15px] text-gray-900 truncate">{contact.displayName}</div>
                            </div>
                            {/* 恢复按钮 */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setUnblockingContact(contact);
                              }}
                              className="px-3 py-1.5 text-xs font-medium bg-[#4ECCA3] text-white rounded-lg hover:bg-[#3DBA92] transition-colors"
                            >
                              Restore
                            </button>
                          </button>
                        ))
                      )
                    ) : (
                      // 联系人按字母分组列表
                      sortedKeys.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-gray-400">No contacts</div>
                      ) : (
                        sortedKeys.map((key) => (
                          <div key={key}>
                            {/* 字母分组标题 */}
                            <div className="px-4 py-1.5 text-xs text-gray-400 font-medium">
                              {key}
                            </div>
                            {/* 该字母下的联系人 */}
                            {(groupedItems[key] || []).map((contact) => (
                              <button
                                key={contact.id}
                                type="button"
                                onClick={() => handleSelectContact(contact, category.id)}
                                className={`flex w-full items-center gap-3 px-3 py-2.5 mx-1 text-left rounded-lg transition-all duration-150 ${
                                  currentContact?.id === contact.id 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'hover:bg-green-50/50 text-gray-700'
                                }`}
                              >
                                {contact.avatarUrl ? (
                                  <img 
                                    src={contact.avatarUrl} 
                                    alt={contact.displayName} 
                                    className="h-10 w-10 rounded-lg object-cover"
                                    style={contact.isAgent ? {
                                      boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
                                    } : undefined}
                                  />
                                ) : (
                                  <div 
                                    className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium ${
                                      contact.isAgent 
                                        ? 'bg-gradient-to-br from-[#4ECCA3] to-[#3DBB94] text-white'
                                        : 'bg-gradient-to-br from-green-400 to-green-500 text-white'
                                    }`}
                                    style={contact.isAgent ? {
                                      boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
                                    } : undefined}
                                  >
                                    {getContactInitial(contact.displayName)}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0 text-left">
                                  <div className="text-[15px] text-gray-900 truncate">{contact.displayName}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ))
                      )
                    )}
                  </div>
                )}
              </div>
            );
          }))}
        </div>
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
            requests={MOCK_REQUESTS.filter(r => r.direction === 'received')}
            acceptedRequests={acceptedRequests}
            rejectedRequests={rejectedRequests}
            onAccept={(req) => {
              props.onAcceptRequest(req);
              setAcceptedRequests(prev => new Set(prev).add(req.userId));
              // 将接受的请求转换为联系人并添加到 Humans 列表
              const newContact: ContactRecord = {
                id: req.userId,
                displayName: req.displayName,
                handle: req.handle,
                avatarUrl: req.avatarUrl,
                bio: req.bio,
                isAgent: req.isAgent,
                friendsSince: new Date().toISOString(),
                agentOwnershipType: req.isAgent ? 'WORLD_OWNED' : null,
              };
              setNewFriendsFromRequests(prev => [...prev, newContact]);
            }}
            onReject={(req) => {
              props.onRejectRequest(req);
              setRejectedRequests(prev => new Set(prev).add(req.userId));
            }}
          />
        ) : selectedContact ? (
          // 联系人 Profile - 使用 ProfileView
          <ProfileView
            profile={selectedProfile!}
            isOwnProfile={false}
            loading={profileLoading}
            error={profileError}
            onBack={() => setSelectedContact(null)}
            onMessage={() => {
              if (selectedContact) {
                props.onMessage(selectedContact);
              }
            }}
            onAddFriend={() => {}}
            canAddFriend={false}
            addFriendHint={null}
            onSendGift={() => {
              // 打开送礼物模态框
              if (selectedContact) {
                setGiftTargetContact(selectedContact);
                setGiftModalOpen(true);
              }
            }}
            showMessageButton={!selectedContact?.isAgent}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Block Contact</h3>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to block <span className="font-medium text-gray-700">{blockingContact.displayName}</span>? They will be moved to Blocks.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setBlockingContact(null)}
                className="px-5 py-2 rounded-full text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleBlockUser(blockingContact)}
                className="px-5 py-2 rounded-full text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 transition-colors"
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unblock/恢复 确认对话框 */}
      {unblockingContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Restore Contact</h3>
            <p className="text-sm text-gray-500 mb-6">
              Restore <span className="font-medium text-gray-700">{unblockingContact.displayName}</span> to their previous category?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setUnblockingContact(null)}
                className="px-5 py-2 rounded-full text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleUnblockUser(unblockingContact)}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-[#4ECCA3] text-white hover:bg-[#3DBA92] transition-colors"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
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

// 单个好友请求详情组件
function FriendRequestDetail({ 
  request, 
  isAccepted, 
  onAccept, 
  onReject, 
  onCancel 
}: { 
  request: ContactRequestRecord;
  isAccepted: boolean;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-8">
        <div className="flex flex-col items-center">
          {request.avatarUrl ? (
            <img src={request.avatarUrl} alt={request.displayName} className="h-20 w-20 rounded-xl object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-500 text-2xl font-medium text-white">
              {getContactInitial(request.displayName)}
            </div>
          )}
          <h2 className="mt-4 text-xl font-semibold text-gray-900">{request.displayName}</h2>
          {request.handle && (
            <p className="text-sm text-gray-500">{request.handle}</p>
          )}
          <span className={`mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
            request.direction === 'received' 
              ? 'bg-blue-50 text-blue-600' 
              : 'bg-amber-50 text-amber-600'
          }`}>
            {request.direction === 'received' ? 'Received' : 'Sent'}
          </span>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-xl">
          <p className="text-sm text-gray-600">{request.bio || 'Wants to add you as a friend'}</p>
        </div>

        <div className="mt-6 flex gap-3">
          {request.direction === 'received' ? (
            isAccepted ? (
              <div className="w-full py-3 rounded-full bg-green-100 text-green-700 text-[15px] font-medium text-center">
                Added
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onAccept}
                  className="flex-1 py-3 rounded-full bg-[#0066CC] text-white text-[15px] font-medium hover:bg-[#0052A3] transition-colors"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={onReject}
                  className="flex-1 py-3 rounded-full bg-gray-100 text-gray-700 text-[15px] font-medium hover:bg-gray-200 transition-colors"
                >
                  Reject
                </button>
              </>
            )
          ) : (
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-3 rounded-full bg-gray-100 text-gray-700 text-[15px] font-medium hover:bg-gray-200 transition-colors"
            >
              Withdraw Request
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 好友请求列表组件 - 类似微信"新的朋友"样式
function FriendRequestsList({ 
  requests, 
  acceptedRequests,
  rejectedRequests,
  onAccept,
  onReject
}: { 
  requests: ContactRequestRecord[];
  acceptedRequests: Set<string>;
  rejectedRequests: Set<string>;
  onAccept: (req: ContactRequestRecord) => void;
  onReject: (req: ContactRequestRecord) => void;
}) {
  // 按时间排序（最新的在前）
  const sortedRequests = [...requests].sort((a, b) => {
    const timeA = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
    const timeB = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
    return timeB - timeA;
  });

  const pendingCount = sortedRequests.filter(r => !acceptedRequests.has(r.userId) && !rejectedRequests.has(r.userId)).length;

  return (
    <div className="flex-1 bg-[#F0F4F8] overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex gap-6">
          {/* 请求列表 - 全宽显示 */}
          <div className="flex-1 min-w-0 w-full">
            <div className="rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none rounded-3xl" />
              
              <div className="relative">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Friend Requests</h3>
                
                {/* 请求列表 */}
                <div className="space-y-3">
                  {sortedRequests.map((request) => {
                    const isAccepted = acceptedRequests.has(request.userId);
                    const isRejected = rejectedRequests.has(request.userId);
                    
                    return (
                      <div
                        key={`${request.direction}:${request.userId}`}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-white/60 border border-white/60 transition-all hover:bg-white/80"
                      >
                        {/* 头像 */}
                        {request.avatarUrl ? (
                          <img 
                            src={request.avatarUrl} 
                            alt={request.displayName} 
                            className="h-14 w-14 rounded-2xl object-cover bg-gray-100" 
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-400 to-blue-500 text-lg font-medium text-white">
                            {getContactInitial(request.displayName)}
                          </div>
                        )}
                        
                        {/* 名字和留言 */}
                        <div className="flex-1 min-w-0">
                          <div className="text-[15px] font-semibold text-gray-900">{request.displayName}</div>
                          <p className="text-[13px] text-gray-500 truncate mt-0.5">
                            {request.bio || 'Wants to add you as a friend'}
                          </p>
                        </div>
                        
                        {/* 操作按钮 - 右侧 */}
                        <div className="shrink-0 flex items-center gap-2">
                          {isAccepted ? (
                            // 已接受 - 显示 "Added"
                            <span className="px-3 py-1.5 text-sm font-medium text-green-600 bg-green-50 rounded-lg">Added</span>
                          ) : isRejected ? (
                            // 已拒绝 - 显示 "Rejected"
                            <span className="px-3 py-1.5 text-sm font-medium text-gray-400 bg-gray-100 rounded-lg">Rejected</span>
                          ) : (
                            // 待处理 - 显示 Accept 和 Reject 按钮
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAccept(request);
                                }}
                                className="px-4 py-2 text-sm font-medium bg-[#4ECCA3] text-white rounded-xl hover:bg-[#3DBA92] transition-all shadow-[0_4px_14px_rgba(78,204,163,0.35)] hover:shadow-[0_6px_20px_rgba(78,204,163,0.45)] active:scale-95"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReject(request);
                                }}
                                className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* 空状态 */}
                {sortedRequests.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-50">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    </svg>
                    <p className="text-sm">No friend requests</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
