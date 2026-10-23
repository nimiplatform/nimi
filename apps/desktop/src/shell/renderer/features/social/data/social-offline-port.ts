
export interface RealmSocialOfflinePort {
  syncProfileMetadata(key: string, profile: object): Promise<void>;
  loadProfileMetadata<T extends object>(key: string): Promise<T | null>;
  markCacheFallbackUsed(): void;
  markRealmUnreachable(): void;
}
