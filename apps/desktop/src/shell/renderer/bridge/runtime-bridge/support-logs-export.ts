/**
 * Renderer bridge for the Support `logs` sub-area log-export command
 * (`D-SUP-006`).
 *
 * Backend authority: `apps/desktop/src-tauri/src/desktop_logs_export.rs`,
 * spec `D-SUP-006` in `support-surface-contract.md`. The command bundles
 * `<nimi_data>/logs/` into a user-locatable `.zip` archive in the OS Downloads
 * directory and reveals it in the OS file manager.
 *
 * Fail-closed (`D-SUP-006`): the backend returns a typed `Err` for a missing,
 * unreadable, or empty logs directory. This module parses the typed success
 * payload and otherwise propagates the typed error to the caller — it never
 * fabricates an artifact path or a pseudo-success result.
 */

import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

/** Typed result of a successful log export (`D-SUP-006`). */
export interface LogsExportResult {
  /** Absolute path of the produced `.zip` archive. */
  readonly artifactPath: string;
  /** Number of log files bundled into the archive. */
  readonly fileCount: number;
  /** Total uncompressed byte size of the bundled log files. */
  readonly byteSize: number;
  /** UTC RFC3339 timestamp the export was produced at. */
  readonly exportedAt: string;
}

function parseLogsExportResult(value: unknown): LogsExportResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop_logs_export returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  const artifactPath = record.artifactPath;
  const exportedAt = record.exportedAt;
  if (typeof artifactPath !== 'string' || !artifactPath.trim()) {
    throw new Error('desktop_logs_export returned no artifactPath');
  }
  if (typeof exportedAt !== 'string' || !exportedAt.trim()) {
    throw new Error('desktop_logs_export returned no exportedAt');
  }
  return {
    artifactPath,
    fileCount: Number(record.fileCount || 0),
    byteSize: Number(record.byteSize || 0),
    exportedAt,
  };
}

/**
 * `D-SUP-006`: export `<nimi_data>/logs/` to a user-locatable archive.
 *
 * Resolves to the typed {@link LogsExportResult} on success. Rejects with the
 * typed backend error when the logs directory is missing, unreadable, or
 * empty — the caller surfaces that fail-closed state and must not synthesize
 * an artifact.
 */
export async function exportDesktopLogs(): Promise<LogsExportResult> {
  if (!hasTauriInvoke()) {
    throw new Error('desktop_logs_export requires Tauri runtime');
  }
  return invokeChecked('desktop_logs_export', {}, parseLogsExportResult);
}
