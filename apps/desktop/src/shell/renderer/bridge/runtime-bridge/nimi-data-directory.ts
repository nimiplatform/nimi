/**
 * Renderer bridge for `nimi_data` directory ownership and cleanup.
 *
 * Desktop hosts implement this boundary against the Product Control ready
 * data root. Canonical product authority:
 * `.nimi/spec/platform/product-lifecycle.authority.yaml`
 * (`definition.nimi.platform.product-lifecycle.nimi-data-ownership`,
 * `P-MIG-006`, and `P-MIG-008`).
 *
 * This is the typed renderer surface for the admitted `P-MIG-008`
 * destructive-cleanup flow. Data-root relocation is not exposed in this
 * pre-launch product.
 */

import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
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

function asExactRecord(
  value: unknown,
  label: string,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned invalid payload`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} returned invalid payload`);
  }
  return record;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error(`${label} returned invalid text`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} returned invalid integer`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} returned invalid boolean`);
  }
  return value;
}

export function parseCleanupPlan(value: unknown): NimiDataCleanupPlan {
  const record = asExactRecord(value, 'nimi_data cleanup plan', [
    'cleanupClass',
    'directory',
    'fileCount',
    'owner',
    'requiresConfirmation',
    'runtimeOwnerBlocked',
    'totalBytes',
  ]);
  return {
    directory: requireText(record.directory, 'nimi_data cleanup plan directory'),
    owner: requireText(record.owner, 'nimi_data cleanup plan owner'),
    cleanupClass: requireText(record.cleanupClass, 'nimi_data cleanup plan cleanupClass'),
    totalBytes: requireNonNegativeInteger(record.totalBytes, 'nimi_data cleanup plan totalBytes'),
    fileCount: requireNonNegativeInteger(record.fileCount, 'nimi_data cleanup plan fileCount'),
    requiresConfirmation: requireBoolean(
      record.requiresConfirmation,
      'nimi_data cleanup plan requiresConfirmation',
    ),
    runtimeOwnerBlocked: requireBoolean(
      record.runtimeOwnerBlocked,
      'nimi_data cleanup plan runtimeOwnerBlocked',
    ),
  };
}

export function parseCleanupOutcome(value: unknown): NimiDataCleanupOutcome {
  const record = asExactRecord(value, 'nimi_data cleanup outcome', [
    'directory',
    'removedBytes',
    'removedFiles',
  ]);
  return {
    directory: requireText(record.directory, 'nimi_data cleanup outcome directory'),
    removedBytes: requireNonNegativeInteger(
      record.removedBytes,
      'nimi_data cleanup outcome removedBytes',
    ),
    removedFiles: requireNonNegativeInteger(
      record.removedFiles,
      'nimi_data cleanup outcome removedFiles',
    ),
  };
}

/** `P-MIG-008` plan: compute the cleanup impact of a `nimi_data` directory. */
export async function planNimiDataCleanup(directory: string): Promise<NimiDataCleanupPlan> {
  if (!hasElectronInvoke()) {
    throw new Error('nimi_data_cleanup_plan requires a standard shell host');
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
  if (!hasElectronInvoke()) {
    throw new Error('nimi_data_cleanup_execute requires a standard shell host');
  }
  return invokeChecked(
    'nimi_data_cleanup_execute',
    { payload: { directory, confirmation: confirmation ?? null } },
    parseCleanupOutcome,
  );
}
