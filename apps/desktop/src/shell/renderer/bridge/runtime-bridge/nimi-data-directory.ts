/**
 * Renderer bridge for `nimi_data` directory ownership and cleanup.
 *
 * Backend authority: `apps/desktop/src-tauri/src/nimi_data_directory/**`,
 * spec `P-MIG-006/008` in `local-config-migration-contract.md`.
 *
 * This is the typed renderer surface for the admitted `P-MIG-008`
 * destructive-cleanup flow. Data-root relocation is not exposed in this
 * pre-launch product.
 */

import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

/** The `P-MIG-008` cleanup impact plan for a `nimi_data` directory. */
export interface NimiDataCleanupPlan {
  readonly directory: string;
  readonly owner: string;
  readonly cleanupClass: string;
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly requiresConfirmation: boolean;
  readonly runtimeOwnerBlocked: boolean;
}

/** The result of a confirmed `nimi_data` cleanup. */
export interface NimiDataCleanupOutcome {
  readonly directory: string;
  readonly removedBytes: number;
  readonly removedFiles: number;
}

/**
 * The explicit `P-MIG-008` destructive-cleanup confirmation token a UI must
 * collect from the user before a non-pure-cache cleanup. It mirrors the
 * backend `DESTRUCTIVE_CLEANUP_CONFIRMATION` constant.
 */
export const NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION = 'CLEAN';

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned invalid payload`);
  }
  return value as Record<string, unknown>;
}

function parseCleanupPlan(value: unknown): NimiDataCleanupPlan {
  const record = asRecord(value, 'nimi_data cleanup plan');
  return {
    directory: String(record.directory || ''),
    owner: String(record.owner || ''),
    cleanupClass: String(record.cleanupClass || ''),
    totalBytes: Number(record.totalBytes || 0),
    fileCount: Number(record.fileCount || 0),
    requiresConfirmation: record.requiresConfirmation === true,
    runtimeOwnerBlocked: record.runtimeOwnerBlocked === true,
  };
}

function parseCleanupOutcome(value: unknown): NimiDataCleanupOutcome {
  const record = asRecord(value, 'nimi_data cleanup outcome');
  return {
    directory: String(record.directory || ''),
    removedBytes: Number(record.removedBytes || 0),
    removedFiles: Number(record.removedFiles || 0),
  };
}

/** `P-MIG-008` plan: compute the cleanup impact of a `nimi_data` directory. */
export async function planNimiDataCleanup(directory: string): Promise<NimiDataCleanupPlan> {
  if (!hasTauriInvoke()) {
    throw new Error('nimi_data_cleanup_plan requires Tauri runtime');
  }
  return invokeChecked('nimi_data_cleanup_plan', { directory }, parseCleanupPlan);
}

/**
 * `P-MIG-008` execute: run a confirmed cleanup of a `nimi_data` directory.
 * `confirmation` must equal {@link NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION}
 * for any non-pure-cache directory.
 */
export async function executeNimiDataCleanup(
  directory: string,
  confirmation?: string,
): Promise<NimiDataCleanupOutcome> {
  if (!hasTauriInvoke()) {
    throw new Error('nimi_data_cleanup_execute requires Tauri runtime');
  }
  return invokeChecked(
    'nimi_data_cleanup_execute',
    { payload: { directory, confirmation: confirmation ?? null } },
    parseCleanupOutcome,
  );
}
