import type { RealmAgentFriendState } from './realm-agent-friend-state';
export { AgentRecommendationCard } from './explore-agent-recommendation-card';
export { toSafeBackgroundImage } from './explore-background-image';
export type ExploreAgentCardData = {
  // Basic contact info
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isAgent: boolean;
  // World info
  worldId: string | null;
  worldName: string | null;
  worldBannerUrl: string | null;
  // Agent specific fields
  category?: string;
  origin?: string;
  tier?: string;
  state?: string;
  ownershipType?: string;
  wakeStrategy?: string;
  accountVisibility?: string | null;
  isOnline?: boolean;
  // Social/Stats
  tags: string[];
  friendsCount?: number;
  postsCount?: number;
  likesCount?: number;
  giftStats?: Record<string, number>;
  // World score for progress bar
  worldScoreEwma?: number;
  // RealmAgent friend state from Realm social truth (D-EXPL-005). Derived by
  // `resolveRealmAgentFriendState` against the AgentFriend / Friendship graph;
  // never guessed renderer-side. Drives the D-EXPL-006 primary action.
  friendState?: RealmAgentFriendState;
};
