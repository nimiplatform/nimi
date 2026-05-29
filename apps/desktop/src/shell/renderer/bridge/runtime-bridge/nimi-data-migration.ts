/**
 * Renderer bridge for the `nimi_data` directory-ownership + migration flow.
 *
 * Backend authority: `apps/desktop/src-tauri/src/nimi_data_migration/**`,
 * spec `P-MIG-006/007/008` in `local-config-migration-contract.md`.
 *
 * This is the typed renderer surface the later T10.3 Settings / T10.4 Support
 * UI waves call to drive the `P-MIG-007` data-root migration and the
 * `P-MIG-008` destructive-cleanup flow. It does NOT itself render any panel.
 */

import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';

/** Terminal / contract state of a `nimi_data` migration (`P-MIG-007`). */
export type NimiDataMigrationState =
  | 'preview'
  | 'confirmed'
  | 'in_progress'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'repair_required';

/** One per-directory impact line of a migration preview. */
export interface NimiDataDirectoryImpact {
  readonly directory: string;
  readonly owner: string;
  readonly runtimeOwned: boolean;
  readonly declared: boolean;
  readonly totalBytes: number;
  readonly fileCount: number;
}

/** The `P-MIG-007` size / impact preview of a data-root migration. */
export interface NimiDataMigrationPreview {
  readonly sourceRoot: string;
  readonly targetRoot: string;
  readonly totalBytes: number;
  readonly totalFiles: number;
  readonly totalDirectories: number;
  readonly directories: readonly NimiDataDirectoryImpact[];
  readonly unownedDirectories: readonly string[];
  readonly includesRuntimeOwnedData: boolean;
}

/** The typed outcome of running a `nimi_data` data-root migration. */
export interface NimiDataMigrationOutcome {
  readonly state: NimiDataMigrationState;
  readonly previousRoot: string;
  readonly newRoot: string;
  readonly preview: NimiDataMigrationPreview;
  readonly verifiedBytes: number;
  readonly verifiedFiles: number;
  readonly verifiedDigest: string | null;
  readonly oldRootRetained: boolean;
  readonly error: string | null;
}

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
 * The `P-MIG-008` impact preview for reclaiming a retained old `nimi_data`
 * data root. Reclaiming the old root is always destructive, so
 * `requiresConfirmation` is always `true`. `sameAsActive` / `activeNestedInOld`
 * are two fail-close conditions that make a reclaim impossible, and `recorded`
 * reflects whether the backend migration ledger actually retained this path;
 * `reclaimable` is `recorded && !sameAsActive && !activeNestedInOld`. When not
 * reclaimable the backend does not scan the path, so `totalBytes` / `fileCount`
 * are reported as `0` rather than probing an unauthorized location.
 */
export interface NimiDataOldRootReclaimPlan {
  readonly oldRoot: string;
  readonly activeRoot: string;
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly requiresConfirmation: boolean;
  readonly sameAsActive: boolean;
  readonly activeNestedInOld: boolean;
  readonly recorded: boolean;
  readonly reclaimable: boolean;
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

const MIGRATION_STATES = new Set<NimiDataMigrationState>([
  'preview',
  'confirmed',
  'in_progress',
  'verifying',
  'completed',
  'failed',
  'repair_required',
]);

function parseDirectoryImpact(value: unknown): NimiDataDirectoryImpact {
  const record = asRecord(value, 'nimi_data directory impact');
  return {
    directory: String(record.directory || ''),
    owner: String(record.owner || ''),
    runtimeOwned: record.runtimeOwned === true,
    declared: record.declared === true,
    totalBytes: Number(record.totalBytes || 0),
    fileCount: Number(record.fileCount || 0),
  };
}

function parsePreview(value: unknown): NimiDataMigrationPreview {
  const record = asRecord(value, 'nimi_data migration preview');
  return {
    sourceRoot: String(record.sourceRoot || ''),
    targetRoot: String(record.targetRoot || ''),
    totalBytes: Number(record.totalBytes || 0),
    totalFiles: Number(record.totalFiles || 0),
    totalDirectories: Number(record.totalDirectories || 0),
    directories: Array.isArray(record.directories)
      ? record.directories.map(parseDirectoryImpact)
      : [],
    unownedDirectories: Array.isArray(record.unownedDirectories)
      ? record.unownedDirectories.map((entry) => String(entry || '')).filter(Boolean)
      : [],
    includesRuntimeOwnedData: record.includesRuntimeOwnedData === true,
  };
}

function parseOutcome(value: unknown): NimiDataMigrationOutcome {
  const record = asRecord(value, 'nimi_data migration outcome');
  const state = String(record.state || '') as NimiDataMigrationState;
  if (!MIGRATION_STATES.has(state)) {
    throw new Error(`nimi_data migration returned invalid state: ${state}`);
  }
  const verifiedDigest = record.verifiedDigest;
  return {
    state,
    previousRoot: String(record.previousRoot || ''),
    newRoot: String(record.newRoot || ''),
    preview: parsePreview(record.preview),
    verifiedBytes: Number(record.verifiedBytes || 0),
    verifiedFiles: Number(record.verifiedFiles || 0),
    verifiedDigest:
      typeof verifiedDigest === 'string' && verifiedDigest.trim() ? verifiedDigest : null,
    oldRootRetained: record.oldRootRetained === true,
    error: typeof record.error === 'string' && record.error.trim() ? record.error : null,
  };
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

function parseOldRootReclaimPlan(value: unknown): NimiDataOldRootReclaimPlan {
  const record = asRecord(value, 'nimi_data old-root reclaim plan');
  return {
    oldRoot: String(record.oldRoot || ''),
    activeRoot: String(record.activeRoot || ''),
    totalBytes: Number(record.totalBytes || 0),
    fileCount: Number(record.fileCount || 0),
    requiresConfirmation: record.requiresConfirmation === true,
    sameAsActive: record.sameAsActive === true,
    activeNestedInOld: record.activeNestedInOld === true,
    recorded: record.recorded === true,
    reclaimable: record.reclaimable === true,
  };
}

/**
 * `P-MIG-007` preview: compute the size / impact preview for moving the
 * current `nimi_data` data root to `targetRoot`. Moves nothing.
 */
export async function previewNimiDataMigration(
  targetRoot: string,
): Promise<NimiDataMigrationPreview> {
  if (!hasTauriInvoke()) {
    throw new Error('nimi_data_migration_preview requires Tauri runtime');
  }
  return invokeChecked('nimi_data_migration_preview', { payload: { targetRoot } }, parsePreview);
}

/**
 * `P-MIG-007` run: execute a confirmed `nimi_data` data-root migration —
 * staged integrity-checked copy, atomic promote, pointer cutover last.
 *
 * The caller MUST have shown the user the preview and obtained an explicit
 * confirmation before invoking this. On a `completed` outcome the caller must
 * follow up with the Runtime `config.json` `dataRootRef` re-sync.
 */
export async function runNimiDataMigration(
  targetRoot: string,
): Promise<NimiDataMigrationOutcome> {
  if (!hasTauriInvoke()) {
    throw new Error('nimi_data_migration_run requires Tauri runtime');
  }
  return invokeChecked('nimi_data_migration_run', { payload: { targetRoot } }, parseOutcome);
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

/**
 * `P-MIG-008` plan: compute the impact preview for reclaiming a retained old
 * `nimi_data` data root (`MigrationOutcome.previousRoot`, when
 * `oldRootRetained` is `true`). Deletes nothing. The active (protected) data
 * root is resolved backend-side, never supplied by the renderer.
 */
export async function planNimiDataOldRootReclaim(
  oldRoot: string,
): Promise<NimiDataOldRootReclaimPlan> {
  if (!hasTauriInvoke()) {
    throw new Error('nimi_data_old_root_reclaim_plan requires Tauri runtime');
  }
  return invokeChecked(
    'nimi_data_old_root_reclaim_plan',
    { payload: { oldRoot } },
    parseOldRootReclaimPlan,
  );
}

/**
 * `P-MIG-008` execute: reclaim a retained old `nimi_data` data root. Always
 * destructive, so `confirmation` must equal
 * {@link NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION}. Fails closed if the old
 * root resolves to the active data root or the active root is nested inside it.
 */
export async function reclaimNimiDataOldRoot(
  oldRoot: string,
  confirmation?: string,
): Promise<NimiDataCleanupOutcome> {
  if (!hasTauriInvoke()) {
    throw new Error('nimi_data_old_root_reclaim_execute requires Tauri runtime');
  }
  return invokeChecked(
    'nimi_data_old_root_reclaim_execute',
    { payload: { oldRoot, confirmation: confirmation ?? null } },
    parseCleanupOutcome,
  );
}
