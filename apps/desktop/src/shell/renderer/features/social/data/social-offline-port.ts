import type { JsonObject } from '@nimiplatform/sdk/types';
import type { SocialMutationKind } from '../../../infra/offline/types.js';

export interface RealmSocialOfflinePort {
  syncProfileMetadata(key: string, profile: object): Promise<void>;
  loadProfileMetadata<T extends object>(key: string): Promise<T | null>;
  markCacheFallbackUsed(): void;
  markRealmUnreachable(): void;
  queueSocialMutation(input: {
    readonly kind: SocialMutationKind;
    readonly payload: JsonObject;
    readonly now: () => number;
  }): Promise<void>;
}
