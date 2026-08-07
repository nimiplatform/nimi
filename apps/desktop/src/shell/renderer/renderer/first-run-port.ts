import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';

export interface DesktopRendererFirstRunPort {
  available(): boolean;
  ensureRecordCreated(): Promise<NimiProductControlRecordProjection>;
  pickDataRootDirectory(): Promise<string | null>;
  selectDataRoot(path: string): Promise<NimiProductControlRecordProjection>;
  getRecord(): Promise<NimiProductControlRecordProjection>;
  admitReadyForUse(): Promise<NimiProductControlRecordProjection>;
}

export function createUnavailableDesktopFirstRunPort(code: string): DesktopRendererFirstRunPort {
  const rejected = (): never => { throw new Error(code); };
  return Object.freeze({
    available: () => false,
    ensureRecordCreated: async () => rejected(),
    pickDataRootDirectory: async () => rejected(),
    selectDataRoot: async () => rejected(),
    getRecord: async () => rejected(),
    admitReadyForUse: async () => rejected(),
  });
}
