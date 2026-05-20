import type { RealmAgentFriendState } from './realm-agent-friend-state';
export { AgentRecommendationCard } from './explore-agent-recommendation-card';
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
export function toSafeBackgroundImage(rawUrl: string | null | undefined): string | null {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) {
    return null;
  }
  try {
    const baseUrl =
      typeof window !== 'undefined' && typeof window.location?.href === 'string'
        ? window.location.href
        : 'https://nimi.invalid';
    const parsed = new URL(normalized, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return `url(${JSON.stringify(parsed.toString())})`;
  } catch {
    return null;
  }
}
