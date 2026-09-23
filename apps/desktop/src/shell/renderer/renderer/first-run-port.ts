import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import type { DesktopHomeProfileStatus } from '../bridge/runtime-bridge/product-control.js';

export interface DesktopRendererFirstRunPort {
  available(): boolean;
  getHomeProfileStatus(): Promise<DesktopHomeProfileStatus>;
  retryHomeProfile(): Promise<{ readonly requested: boolean }>;
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
    getHomeProfileStatus: async () => rejected(),
    retryHomeProfile: async () => rejected(),
    ensureRecordCreated: async () => rejected(),
    pickDataRootDirectory: async () => rejected(),
    selectDataRoot: async () => rejected(),
    getRecord: async () => rejected(),
    admitReadyForUse: async () => rejected(),
  });
}
