import type { RealmPersonaSourceState } from './realm-persona-source-admission';
export { AgentRecommendationCard } from './explore-agent-recommendation-card';
export { toSafeBackgroundImage } from './explore-background-image';
export type ExploreAgentCardData = {
  // Basic contact info
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isSource: boolean;
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
  sourceState?: RealmPersonaSourceState;
};
