import type { CharacterSourceState } from './character-source-materialization';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
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
  sourceKind?: CharacterSourceRefV3['kind'];
  sourceId?: string;
  sourceHash?: string;
  runtimeSourceRef?: string;
  sourceRef?: CharacterSourceRefV3;
  // World info
  worldId: string | null;
  worldName: string | null;
  worldBannerUrl: string | null;
  // PersonaCharacter source fields
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
  sourceState?: CharacterSourceState;
};
