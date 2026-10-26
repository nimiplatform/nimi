import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import type { CharacterSourceState } from './character-source-materialization';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import type { CharacterSourceViewerRelationProjection } from '../realm-source/character-source-profile-projection.js';
export { PersonaSourceCard } from './explore-persona-source-card';
export { toSafeBackgroundImage } from './explore-background-image';
export type ExplorePersonaSourceCardData = {
  materializationActionState?: 'running' | 'refresh';
  // Basic contact info
  id: string;
  name: string;
  handle: string;
  avatarMedia: RealmModel<'MediaDeliveryDto'> | null;
  avatarUrl: string | null;
  bio: string | null;
  sourceRef: CharacterSourceRefV3;
  viewerRelation: CharacterSourceViewerRelationProjection;
  // World info
  worldId: string;
  worldName: string;
  worldBannerUrl: string | null;
  // PersonaCharacter source fields
  role: string | null;
  archetype: string | null;
  cadence: string | null;
  ownership: 'worldOwned' | 'userOwned';
  visibility?: 'private' | 'unlisted' | 'public' | 'system' | string | null;
  isOnline?: boolean;
  // Social/Stats
  tags: string[];
  friendsCount?: number;
  postsCount?: number;
  likesCount?: number;
  sourceState?: CharacterSourceState;
};
