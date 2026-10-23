import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererStorageDirs } from './settings-port.js';

export const NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION = 'CLEAN';

export interface NimiDataCleanupPlan {
  readonly directory: string;
  readonly owner: string;
  readonly cleanupClass: string;
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly requiresConfirmation: boolean;
  readonly runtimeOwnerBlocked: boolean;
}

export interface NimiDataCleanupOutcome {
  readonly directory: string;
  readonly removedBytes: number;
  readonly removedFiles: number;
}

export interface NimiAppHostCachePlan {
  readonly profileCount: number;
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly hostsRunning: boolean;
}

export interface NimiAppHostCacheOutcome {
  readonly removedBytes: number;
  readonly removedFiles: number;
  readonly failedEntries: number;
  readonly complete: boolean;
}

export interface DesktopRendererSupportRepairPort {
  loadProductControlRecord(): Promise<NimiProductControlRecordProjection>;
  loadStorageDirs(): Promise<DesktopRendererStorageDirs>;
  planDataCleanup(directory: string): Promise<NimiDataCleanupPlan>;
  executeDataCleanup(directory: string, confirmation?: string): Promise<NimiDataCleanupOutcome>;
  planAppHostCacheCleanup(): Promise<NimiAppHostCachePlan>;
  executeAppHostCacheCleanup(): Promise<NimiAppHostCacheOutcome>;
}
