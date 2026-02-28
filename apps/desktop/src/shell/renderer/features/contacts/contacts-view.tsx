import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContactRecord, ContactRequestRecord, TabFilter } from './contacts-model';
import { getContactInitial } from './contacts-model';

type ContactsViewProps = {
  searchText: string;
  activeFilter: TabFilter;
  humansCount: number;
  agentsCount: number;
  myAgentsCount: number;
  requestsCount: number;
  blocksCount: number;
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

// 记录被拉黑用户之前的分类，用于恢复
interface BlockedUserInfo {
  userId: string;
  previousCategory: TabFilter;
  timestamp: number;
}

export function ContactsView(props: ContactsViewProps) {
  const { t } = useTranslation();
  const [removingContact, setRemovingContact] = useState<ContactRecord | null>(null);
  const [blockingContact, setBlockingContact] = useState<ContactRecord | null>(null);
  const [unblockingContact, setUnblockingContact] = useState<ContactRecord | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ContactRequestRecord | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<TabFilter | null>(null);
  
  // 本地状态：被拉黑的用户列表（包含之前的分类信息）
  const [blockedUsers, setBlockedUsers] = useState<Map<string, BlockedUserInfo>>(new Map());
  
  // 跟踪展开的分类（可以同时展开多个）
  const [expandedCategories, setExpandedCategories] = useState<Set<TabFilter>>(new Set(['humans']));

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
  const getContactsByCategory = (categoryId: TabFilter) => {
    if (categoryId === 'requests') return [];
    if (categoryId === 'blocks') {
      // Blocks 分类：返回所有被拉黑的用户
      return props.allFriends.filter(c => isUserBlocked(c.id));
    }
    
    return props.allFriends.filter(c => {
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
      userId: contact.id,
      previousCategory: currentCat || 'humans', // 默认恢复到 humans
      timestamp: Date.now(),
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
    return {
      ...props,
      blocksCount: blockedCount,
      // 其他数量可能需要调整，取决于实际需求
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
      <aside className="w-[320px] flex flex-col bg-white border-r border-gray-200">
        {/* 顶部标题 */}
        <div className="flex h-14 items-center justify-between px-4 border-b border-gray-200 shrink-0">
          <h1 className="text-lg font-semibold text-gray-900">Contacts</h1>
          <button
            type="button"
            onClick={props.onOpenAddContact}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="Add Friend"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {/* 搜索框 */}
        <div className="p-3 border-b border-gray-100">
          <div className="flex h-9 items-center rounded-lg bg-gray-100 px-3">
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
          </div>
        </div>

        {/* 可展开的分类列表 */}
        <div className="flex-1 overflow-y-auto">
          {CATEGORIES.map((category) => {
            const count = counts[category.countKey as keyof typeof counts] as number;
            const isExpanded = expandedCategories.has(category.id);
            const isRequests = category.id === 'requests';
            const isBlocks = category.id === 'blocks';
            
            // 获取该分类下的项目
            const items = isRequests 
              ? props.filteredRequests 
              : getContactsByCategory(category.id);
            
            // 按字母分组（仅联系人）
            const groupedItems = isRequests ? {} : groupContactsByLetter(items as ContactRecord[]);
            const sortedKeys = Object.keys(groupedItems).sort((a, b) => {
              if (a === '#') return 1;
              if (b === '#') return -1;
              return a.localeCompare(b);
            });

            return (
              <div key={category.id} className="border-b border-gray-100 last:border-b-0">
                {/* 分类标题 - 可点击展开/折叠 */}
                <button
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  {/* 展开/折叠箭头 */}
                  <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  
                  <span className="text-2xl">{category.icon}</span>
                  <span className="flex-1 text-[15px] text-gray-900">{category.label}</span>
                  {count > 0 && (
                    <span className="text-xs text-gray-400">{count}</span>
                  )}
                </button>

                {/* 展开的列表内容 */}
                {isExpanded && (
                  <div className="bg-[#F8F9FB]">
                    {isRequests ? (
                      // 新的朋友列表
                      (items as ContactRequestRecord[]).map((request) => (
                        <button
                          key={`${request.direction}:${request.userId}`}
                          type="button"
                          onClick={() => {
                            setSelectedRequest(request);
                            setSelectedContact(null);
                            props.onFilterChange('requests');
                          }}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors pl-11 ${
                            currentRequest?.userId === request.userId ? 'bg-[#E6F0FF]' : ''
                          }`}
                        >
                          {request.avatarUrl ? (
                            <img src={request.avatarUrl} alt={request.displayName} className="h-10 w-10 rounded-lg object-cover" />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-500 text-sm font-medium text-white">
                              {getContactInitial(request.displayName)}
                            </div>
                          )}
                          <div className="flex-1 min-w-0 text-left">
                            <div className="text-[15px] text-gray-900 truncate">{request.displayName}</div>
                            <div className="text-[13px] text-gray-500 truncate">{request.bio || 'Wants to add you as a friend'}</div>
                          </div>
                        </button>
                      ))
                    ) : isBlocks ? (
                      // Blocks 列表 - 显示拉黑的用户，带有恢复按钮
                      (items as ContactRecord[]).length === 0 ? (
                        <div className="px-11 py-3 text-sm text-gray-400">No blocked contacts</div>
                      ) : (
                        (items as ContactRecord[]).map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => handleSelectContact(contact, 'blocks')}
                            className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors pl-11 ${
                              currentContact?.id === contact.id ? 'bg-[#E6F0FF]' : ''
                            }`}
                          >
                            {contact.avatarUrl ? (
                              <img src={contact.avatarUrl} alt={contact.displayName} className="h-10 w-10 rounded-lg object-cover" />
                            ) : (
                              <div className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium ${
                                contact.isAgent 
                                  ? 'bg-gradient-to-br from-purple-400 to-purple-500 text-white'
                                  : 'bg-gradient-to-br from-green-400 to-green-500 text-white'
                              }`}>
                                {getContactInitial(contact.displayName)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0 text-left">
                              <div className="text-[15px] text-gray-900 truncate">{contact.displayName}</div>
                              <div className="text-[13px] text-gray-500 truncate">Blocked</div>
                            </div>
                            {/* 恢复按钮 */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setUnblockingContact(contact);
                              }}
                              className="px-3 py-1 text-xs font-medium text-[#0066CC] bg-blue-50 rounded-full hover:bg-blue-100 transition-colors"
                            >
                              Restore
                            </button>
                          </button>
                        ))
                      )
                    ) : (
                      // 联系人按字母分组列表
                      sortedKeys.length === 0 ? (
                        <div className="px-11 py-3 text-sm text-gray-400">No contacts</div>
                      ) : (
                        sortedKeys.map((key) => (
                          <div key={key}>
                            {/* 字母分组标题 */}
                            <div className="px-11 py-1 text-xs text-gray-400 font-medium">
                              {key}
                            </div>
                            {/* 该字母下的联系人 */}
                            {(groupedItems[key] || []).map((contact) => (
                              <button
                                key={contact.id}
                                type="button"
                                onClick={() => handleSelectContact(contact, category.id)}
                                className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors pl-11 ${
                                  currentContact?.id === contact.id ? 'bg-[#E6F0FF]' : ''
                                }`}
                              >
                                {contact.avatarUrl ? (
                                  <img src={contact.avatarUrl} alt={contact.displayName} className="h-10 w-10 rounded-lg object-cover" />
                                ) : (
                                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium ${
                                    contact.isAgent 
                                      ? 'bg-gradient-to-br from-purple-400 to-purple-500 text-white'
                                      : 'bg-gradient-to-br from-green-400 to-green-500 text-white'
                                  }`}>
                                    {getContactInitial(contact.displayName)}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0 text-left">
                                  <div className="text-[15px] text-gray-900 truncate">{contact.displayName}</div>
                                  {contact.bio && (
                                    <div className="text-[13px] text-gray-500 truncate">{contact.bio}</div>
                                  )}
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
          })}
        </div>
      </aside>

      {/* 右侧详情区 */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#F5F7FA]">
        {selectedRequest ? (
          // 新的朋友详情
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-8">
              <div className="flex flex-col items-center">
                {selectedRequest.avatarUrl ? (
                  <img src={selectedRequest.avatarUrl} alt={selectedRequest.displayName} className="h-20 w-20 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-500 text-2xl font-medium text-white">
                    {getContactInitial(selectedRequest.displayName)}
                  </div>
                )}
                <h2 className="mt-4 text-xl font-semibold text-gray-900">{selectedRequest.displayName}</h2>
                {selectedRequest.handle && (
                  <p className="text-sm text-gray-500">{selectedRequest.handle}</p>
                )}
              </div>

              <div className="mt-6 p-4 bg-gray-50 rounded-xl">
                <p className="text-sm text-gray-600">{selectedRequest.bio || 'Wants to add you as a friend'}</p>
              </div>

              <div className="mt-6 flex gap-3">
                {selectedRequest.direction === 'received' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => props.onAcceptRequest(selectedRequest)}
                      className="flex-1 py-3 rounded-full bg-[#0066CC] text-white text-[15px] font-medium hover:bg-[#0052A3] transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onRejectRequest(selectedRequest)}
                      className="flex-1 py-3 rounded-full bg-gray-100 text-gray-700 text-[15px] font-medium hover:bg-gray-200 transition-colors"
                    >
                      Reject
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => props.onCancelRequest(selectedRequest)}
                    className="w-full py-3 rounded-full bg-gray-100 text-gray-700 text-[15px] font-medium hover:bg-gray-200 transition-colors"
                  >
                    Withdraw Request
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : selectedContact ? (
          // 联系人详情
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-sm">
              <div className="p-8 flex items-start gap-4">
                {selectedContact.avatarUrl ? (
                  <img src={selectedContact.avatarUrl} alt={selectedContact.displayName} className="h-16 w-16 rounded-xl object-cover" />
                ) : (
                  <div className={`flex h-16 w-16 items-center justify-center rounded-xl text-xl font-medium ${
                    selectedContact.isAgent 
                      ? 'bg-gradient-to-br from-purple-400 to-purple-500 text-white'
                      : 'bg-gradient-to-br from-green-400 to-green-500 text-white'
                  }`}>
                    {getContactInitial(selectedContact.displayName)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold text-gray-900 truncate">{selectedContact.displayName}</h2>
                  <p className="text-sm text-gray-500 mt-1">@{selectedContact.handle.replace(/^@/, '')}</p>
                </div>
              </div>

              <div className="border-t border-gray-100" />

              <div className="p-6 space-y-4">
                {selectedContact.bio && (
                  <div className="flex">
                    <span className="w-20 text-sm text-gray-500 shrink-0">Bio</span>
                    <span className="flex-1 text-sm text-gray-900">{selectedContact.bio}</span>
                  </div>
                )}
                {selectedContact.location && (
                  <div className="flex">
                    <span className="w-20 text-sm text-gray-500 shrink-0">Location</span>
                    <span className="flex-1 text-sm text-gray-900">{selectedContact.location}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100" />

              <div className="p-6">
                <div className="flex gap-4">
                  {/* 消息按钮 - 在非 Blocks 分类下显示 */}
                  {currentCategory !== 'blocks' && (
                    <button
                      type="button"
                      onClick={() => props.onMessage(selectedContact)}
                      className="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0066CC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      <span className="text-sm text-[#0066CC]">Message</span>
                    </button>
                  )}
                  
                  {/* Block 按钮 - 只在非 Blocks 分类且非 Agent 时显示 */}
                  {currentCategory !== 'blocks' && !selectedContact.isAgent && (
                    <button
                      type="button"
                      onClick={() => setBlockingContact(selectedContact)}
                      className="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                      <span className="text-sm text-gray-600">Block</span>
                    </button>
                  )}
                  
                  {/* Unblock/恢复按钮 - 只在 Blocks 分类下显示 */}
                  {currentCategory === 'blocks' && (
                    <button
                      type="button"
                      onClick={() => setUnblockingContact(selectedContact)}
                      className="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0066CC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <span className="text-sm text-[#0066CC]">Restore</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          // 空状态
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto mb-4 opacity-30">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p>Select a contact to view details</p>
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
                className="px-5 py-2 rounded-full text-sm font-medium bg-[#0066CC] text-white hover:bg-[#0052A3] transition-colors"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
