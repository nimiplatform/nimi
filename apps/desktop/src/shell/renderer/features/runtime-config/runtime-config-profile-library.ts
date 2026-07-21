import type {
  NimiAccountProfileLibraryIndexEntry,
  NimiAccountProfileLibraryOrigin,
  NimiAccountProfileLibraryProfile,
  NimiAccountProfileLibraryProjection,
  NimiAIProfile,
} from '@nimiplatform/sdk/ai';
import type { DesktopRendererProfileLibraryPort } from '../../renderer/profile-library-port.js';

export type LibraryProfileOrigin = NimiAccountProfileLibraryOrigin;
export type LibraryProfile = NimiAccountProfileLibraryProfile;
export type LibraryIndexEntry = NimiAccountProfileLibraryIndexEntry;
export type { NimiAccountProfileLibraryProjection };

export type AccountProfileLibraryResource = Readonly<{
  load(): Promise<NimiAccountProfileLibraryProjection>;
  ensureAccountDefault(): Promise<void>;
  loadAccountDefault(): Promise<NimiAIProfile>;
  create(profile: NimiAIProfile): Promise<NimiAccountProfileLibraryProjection>;
  edit(profile: NimiAIProfile): Promise<NimiAccountProfileLibraryProjection>;
  import(profiles: NimiAIProfile[]): Promise<NimiAccountProfileLibraryProjection>;
  export(profileIds?: string[]): Promise<NimiAIProfile[]>;
  delete(profileId: string): Promise<NimiAccountProfileLibraryProjection>;
  ensureLoaded(): Promise<void>;
  cachedProfiles(): NimiAIProfile[];
  cached(): NimiAccountProfileLibraryProjection | null;
  createEmpty(profileId?: string): NimiAIProfile;
  clear(): void;
}>;

export function createAccountProfileLibraryResource(
  port: DesktopRendererProfileLibraryPort,
): AccountProfileLibraryResource {
  let projectionCache: NimiAccountProfileLibraryProjection | null = null;
  const adopt = (projection: NimiAccountProfileLibraryProjection) => {
    projectionCache = projection;
    return projection;
  };

  const load = async () => adopt(await port.load());
  return Object.freeze({
    load,
    ensureAccountDefault: port.ensureAccountDefault,
    loadAccountDefault: port.loadAccountDefault,
    async create(profile) {
      return adopt(await port.create(profile));
    },
    async edit(profile) {
      return adopt(await port.edit(profile));
    },
    async import(profiles) {
      return adopt(await port.import(profiles));
    },
    export: (profileIds = []) => port.export(profileIds),
    async delete(profileId) {
      return adopt(await port.delete(profileId));
    },
    async ensureLoaded() {
      if (projectionCache || !port.available()) return;
      await load();
    },
    cachedProfiles() {
      return projectionCache?.profiles.map((entry) => entry.profile) ?? [];
    },
    cached: () => projectionCache,
    createEmpty(profileId) {
      return {
        profileId: profileId || port.createId(),
        title: '',
        description: '',
        tags: [],
        capabilities: {},
      };
    },
    clear() {
      projectionCache = null;
    },
  });
}
