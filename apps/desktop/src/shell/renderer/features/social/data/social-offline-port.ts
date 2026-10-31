
export interface RealmSocialOfflinePort {
  capture(): RealmSocialOfflinePort;
  syncProfileMetadata(key: string, profile: object): Promise<void>;
  loadProfileMetadata<T extends object>(key: string): Promise<T | null>;
  removeProfileMetadata(key: string): Promise<void>;
  markCacheFallbackUsed(): void;
  markRealmUnreachable(): void;
}
