import type {
  NimiProductControlRecordProjection,
  NimiProductControlSelectedDataRootProjection,
} from '@nimiplatform/sdk/runtime';
import type {
  DesktopHomeProfileStatus,
  ProductControlMaintenanceReplacementProjection,
} from '../bridge/runtime-bridge/product-control.js';

export interface DesktopRendererFirstRunPort {
  available(): boolean;
  getHomeProfileStatus(): Promise<DesktopHomeProfileStatus>;
  retryHomeProfile(): Promise<{ readonly requested: boolean }>;
  ensureRecordCreated(): Promise<NimiProductControlRecordProjection>;
  pickDataRootDirectory(): Promise<string | null>;
  selectDataRoot(path: string): Promise<NimiProductControlRecordProjection>;
  getRecord(): Promise<NimiProductControlRecordProjection>;
  admitReadyForUse(): Promise<NimiProductControlRecordProjection>;
  /** Startup recovery while Runtime refuses its stored data (product-surfaces r038). */
  getSelectedDataRoot(): Promise<NimiProductControlSelectedDataRootProjection>;
  pickNewEmptyDataRootDirectory(title: string): Promise<string | null>;
  replaceDataRootInMaintenance(targetRoot: string): Promise<ProductControlMaintenanceReplacementProjection>;
  relaunchFromMaintenance(): Promise<{ readonly requested: boolean }>;
}
