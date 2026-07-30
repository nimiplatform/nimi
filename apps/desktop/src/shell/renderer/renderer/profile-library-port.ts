import type {
  NimiAccountProfileLibraryProjection,
  NimiAIProfile,
} from '@nimiplatform/sdk/ai';

export interface DesktopRendererProfileLibraryPort {
  available(): boolean;
  createId(): string;
  load(): Promise<NimiAccountProfileLibraryProjection>;
  create(profile: NimiAIProfile): Promise<NimiAccountProfileLibraryProjection>;
  edit(profile: NimiAIProfile): Promise<NimiAccountProfileLibraryProjection>;
  import(profiles: NimiAIProfile[]): Promise<NimiAccountProfileLibraryProjection>;
  export(profileIds?: string[]): Promise<NimiAIProfile[]>;
  delete(profileId: string): Promise<NimiAccountProfileLibraryProjection>;
}

function profileLibraryUnadmitted(): never {
  throw new Error('DESKTOP_SIMULATOR_PROFILE_LIBRARY_UNADMITTED');
}

export function createUnavailableDesktopRendererProfileLibraryPort(): DesktopRendererProfileLibraryPort {
  return Object.freeze({
    available: () => false,
    createId: profileLibraryUnadmitted,
    load: async () => profileLibraryUnadmitted(),
    create: async () => profileLibraryUnadmitted(),
    edit: async () => profileLibraryUnadmitted(),
    import: async () => profileLibraryUnadmitted(),
    export: async () => profileLibraryUnadmitted(),
    delete: async () => profileLibraryUnadmitted(),
  });
}
