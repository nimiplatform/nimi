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

export interface DesktopRendererSupportRepairPort {
  loadProductControlRecord(): Promise<NimiProductControlRecordProjection>;
  loadStorageDirs(): Promise<DesktopRendererStorageDirs>;
  planDataCleanup(directory: string): Promise<NimiDataCleanupPlan>;
  executeDataCleanup(directory: string, confirmation?: string): Promise<NimiDataCleanupOutcome>;
}

export function createUnavailableDesktopRendererSupportRepairPort(
  reason = 'DESKTOP_RENDERER_SUPPORT_REPAIR_UNAVAILABLE',
): DesktopRendererSupportRepairPort {
  const unavailable = async (): Promise<never> => {
    throw new Error(reason);
  };
  return Object.freeze({
    loadProductControlRecord: unavailable,
    loadStorageDirs: unavailable,
    planDataCleanup: unavailable,
    executeDataCleanup: unavailable,
  });
}
