import type { ContactRecord, ContactRequestRecord, TabFilter } from './contacts-model.js';

export type ContactsViewProps = {
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
export const CATEGORIES = [
  { id: 'requests' as TabFilter, label: 'New Friends', icon: '👋', countKey: 'requestsCount' },
  { id: 'humans' as TabFilter, label: 'Humans', icon: '👤', countKey: 'humansCount' },
  { id: 'agents' as TabFilter, label: 'Agents', icon: '🤖', countKey: 'agentsCount' },
  { id: 'myAgents' as TabFilter, label: 'My Agents', icon: '⭐', countKey: 'myAgentsCount' },
  { id: 'blocks' as TabFilter, label: 'Blocks', icon: '🚫', countKey: 'blocksCount' },
];

// 记录被拉黑用户的完整信息和之前的分类，用于恢复
export interface BlockedUserInfo extends ContactRecord {
  previousCategory: TabFilter;
  blockedAt: number;
}
