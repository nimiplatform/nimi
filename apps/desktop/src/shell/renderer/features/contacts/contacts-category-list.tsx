import React from 'react';
import { useTranslation } from 'react-i18next';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import type { ContactRecord, ContactRequestRecord, TabFilter } from './contacts-model.js';
import { CATEGORIES } from './contacts-view-types.js';
import { BlockedUsersList } from './contacts-blocked-users.js';

// ---------- Highlight matched text in search results ----------

function HighlightText({ text, query }: { text: string; query: string }) {
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
}

function getContactPalette(contact: ContactRecord) {
  return getSemanticAgentPalette({
    description: contact.bio,
    worldName: contact.worldName,
    tags: contact.tags,
  });
}

// ---------- Search results panel ----------

export function ContactsSearchResults({
  searchText,
  allFriends,
  isUserBlocked,
  selectedContactId,
  onSelectContact,
}: {
  searchText: string;
  allFriends: ContactRecord[];
  isUserBlocked: (id: string) => boolean;
  selectedContactId: string | null;
  onSelectContact: (contact: ContactRecord, categoryId: TabFilter) => void;
}) {
  const { t } = useTranslation();
  const query = searchText.trim().toLowerCase();
  const allContacts = allFriends.filter(c => !isUserBlocked(c.id));

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
          <div className="px-3 py-1 text-xs text-gray-500 font-medium flex items-center justify-between">
            <span>{group.title}</span>
            <span className="text-gray-400">({group.items.length})</span>
          </div>
          {/* 该分组下的联系人 */}
          <div className="space-y-0.5">
            {group.items.map((contact) => (
              <ContactListItem
                key={contact.id}
                contact={contact}
                isSelected={selectedContactId === contact.id}
                secondaryText={group.id === 'world' ? contact.handle : undefined}
                query={query}
                onClick={() => onSelectContact(contact, group.id === 'world' ? (contact.isAgent ? 'agents' : 'humans') : group.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Category accordion (non-search mode) ----------

export function ContactsCategoryAccordion({
  counts,
  expandedCategories,
  filteredRequests,
  acceptedRequests,
  rejectedRequests,
  currentContactId,
  getContactsByCategory,
  onToggleCategory,
  onSelectContact,
  onAcceptRequest,
  onRejectRequest,
  onUnblock,
  onSelectRequests,
}: {
  counts: {
    humansCount: number;
    agentsCount: number;
    myAgentsCount: number;
    requestsCount: number;
    blocksCount: number;
  };
  expandedCategories: Set<TabFilter>;
  filteredRequests: ContactRequestRecord[];
  acceptedRequests: Set<string>;
  rejectedRequests: Set<string>;
  currentContactId: string | null;
  getContactsByCategory: (categoryId: TabFilter) => ContactRecord[];
  onToggleCategory: (categoryId: TabFilter) => void;
  onSelectContact: (contact: ContactRecord, categoryId: TabFilter) => void;
  onAcceptRequest: (request: ContactRequestRecord) => void;
  onRejectRequest: (request: ContactRequestRecord) => void;
  onUnblock: (contact: ContactRecord) => void;
  onSelectRequests: () => void;
}) {
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

  return (
    <>
      {CATEGORIES.map((category) => {
        const count = counts[category.countKey as keyof typeof counts] as number;
        const isExpanded = expandedCategories.has(category.id);
        const isRequests = category.id === 'requests';
        const isBlocks = category.id === 'blocks';

        // 获取该分类下的项目
        const items = isRequests
          ? filteredRequests
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
                onToggleCategory(category.id);
                // 点击 New Friends 时，在右侧显示列表
                if (category.id === 'requests') {
                  onSelectRequests();
                }
              }}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left rounded-lg transition-all duration-150 ${
                isExpanded
                  ? 'bg-mint-50 text-mint-700'
                  : 'hover:bg-mint-50/60 text-gray-700'
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
                className={`transition-transform duration-200 ${isExpanded ? 'rotate-90 text-mint-600' : 'text-gray-400'}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>

              <span className="text-xl">{category.icon}</span>
              <span className={`flex-1 text-[14px] font-medium ${isExpanded ? 'text-mint-700' : 'text-gray-700'}`}>
                {category.label}
              </span>
              {count > 0 && (
                <span className={`text-xs ${isExpanded ? 'text-mint-600' : 'text-gray-400'}`}>{count}</span>
              )}
            </button>

            {/* 展开的列表内容 */}
            {isExpanded && (
              <div className="mt-0.5 py-0.5">
                {isRequests ? (
                  // 新的朋友列表 - 只显示待处理的 received 请求（未接受且未拒绝）
                  (items as ContactRequestRecord[])
                    .filter(r => r.direction === 'received' && !acceptedRequests.has(r.userId) && !rejectedRequests.has(r.userId))
                    .map((request) => {
                    return (
                      <div
                        key={`${request.direction}:${request.userId}`}
                        className="mx-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-gray-700 transition-all duration-150 hover:bg-mint-50/50"
                      >
                        {/* 头像 */}
                        <EntityAvatar
                          imageUrl={request.avatarUrl}
                          name={request.displayName}
                          kind={request.isAgent ? 'agent' : 'human'}
                          sizeClassName="h-10 w-10"
                          radiusClassName={request.isAgent ? 'rounded-[10px]' : undefined}
                          innerRadiusClassName={request.isAgent ? 'rounded-[8px]' : undefined}
                          textClassName="text-sm font-medium"
                        />

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
                              onAcceptRequest(request);
                            }}
                            className="px-3 py-1.5 text-xs font-medium bg-[#4ECCA3] text-white rounded-lg hover:bg-[#3DBA92] transition-colors"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRejectRequest(request);
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
                  // Blocks 列表
                  <BlockedUsersList
                    contacts={items as ContactRecord[]}
                    currentContactId={currentContactId}
                    onSelect={(contact) => onSelectContact(contact, 'blocks')}
                    onUnblock={onUnblock}
                  />
                ) : (
                  // 联系人按字母分组列表
                  sortedKeys.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400">No contacts</div>
                  ) : (
                    sortedKeys.map((key) => (
                      <div key={key}>
                        {/* 字母分组标题 */}
                        <div className="px-4 py-1 text-xs text-gray-400 font-medium">
                          {key}
                        </div>
                        {/* 该字母下的联系人 */}
                        {(groupedItems[key] || []).map((contact) => (
                          <ContactListItem
                            key={contact.id}
                            contact={contact}
                            isSelected={currentContactId === contact.id}
                            onClick={() => onSelectContact(contact, category.id)}
                          />
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
    </>
  );
}

function ContactListItem({
  contact,
  isSelected,
  query,
  secondaryText,
  onClick,
}: {
  contact: ContactRecord;
  isSelected: boolean;
  query?: string;
  secondaryText?: string;
  onClick: () => void;
}) {
  const palette = getContactPalette(contact);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 mx-1 text-left rounded-lg transition-all duration-150 ${
        isSelected
          ? 'bg-mint-50 text-mint-700'
          : 'hover:bg-mint-50/50 text-gray-700'
      }`}
    >
      <EntityAvatar
        imageUrl={contact.avatarUrl}
        name={contact.displayName}
        kind={contact.isAgent ? 'agent' : 'human'}
        sizeClassName="h-10 w-10"
        radiusClassName={contact.isAgent ? 'rounded-[10px]' : undefined}
        innerRadiusClassName={contact.isAgent ? 'rounded-[8px]' : undefined}
        textClassName="text-sm font-medium"
      />
      <div className="flex-1 min-w-0 text-left">
        <div className="text-[15px] text-gray-900 truncate">
          {query ? <HighlightText text={contact.displayName} query={query} /> : contact.displayName}
        </div>
        {(secondaryText || contact.worldName) && (
          <div className="text-xs truncate" style={{ color: contact.isAgent ? palette.accent : undefined }}>
            {secondaryText || contact.worldName}
          </div>
        )}
      </div>
    </button>
  );
}
