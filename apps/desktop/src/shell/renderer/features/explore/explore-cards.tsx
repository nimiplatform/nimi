import type { RealmPersonaSourceState } from './realm-persona-source-admission';
import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
export { PersonaSourceCard } from './explore-persona-source-card';
export { toSafeBackgroundImage } from './explore-background-image';
export type ExplorePersonaSourceCardData = {
  // Basic contact info
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isSource: boolean;
  sourceKind?: NimiRealmCoreSourceRef['kind'];
  sourceId?: string;
  sourceContentHash?: string;
  runtimeSourceRef?: string;
  sourceRef?: NimiRealmCoreSourceRef;
  // World info
  worldId: string | null;
  worldName: string | null;
  worldBannerUrl: string | null;
  // RealmPersona source fields
  archetype?: string;
  origin?: string;
  tier?: string;
  state?: string;
  ownershipType?: string;
  pacing?: string;
  visibility?: 'private' | 'unlisted' | 'public' | 'system' | string | null;
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
