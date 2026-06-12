/**
 * Renderer bridge for the agent canonical memory export save command.
 *
 * Backend authority: `apps/desktop/src-tauri/src/desktop_agent_memory_export.rs`
 * (classified `desktop_agent_memory_export`, D-GATE-092). The command persists
 * the SDK-assembled export envelope into the OS Downloads directory and
 * reveals it; envelope assembly stays in the typed SDK helper
 * (`createNimiRuntimeAgentMemoryExport`, S-SURFACE-015/016).
 *
 * Fail-closed: the backend rejects empty payloads, invalid JSON, and
 * envelopes without the `schemaVersion` marker. This module parses the typed
 * success payload and otherwise propagates the typed error — it never
 * fabricates an artifact path or a pseudo-success result.
 */

import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

/** Typed result of a successful memory export save. */
export interface AgentMemoryExportSaveResult {
  /** Absolute path of the produced `.json` artifact. */
  readonly artifactPath: string;
  /** Byte size of the persisted envelope. */
  readonly byteSize: number;
  /** UTC RFC3339 timestamp the artifact was persisted at. */
  readonly savedAt: string;
}

function parseAgentMemoryExportSaveResult(value: unknown): AgentMemoryExportSaveResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop_agent_memory_export_save returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  const artifactPath = record.artifactPath;
  const savedAt = record.savedAt;
  if (typeof artifactPath !== 'string' || !artifactPath.trim()) {
    throw new Error('desktop_agent_memory_export_save returned no artifactPath');
  }
  if (typeof savedAt !== 'string' || !savedAt.trim()) {
    throw new Error('desktop_agent_memory_export_save returned no savedAt');
  }
  return {
    artifactPath,
    byteSize: Number(record.byteSize || 0),
    savedAt,
  };
}

/**
 * Persist a pre-assembled memory export envelope to the OS Downloads
 * directory. Rejects with the typed backend error on any fail-closed path;
 * the caller surfaces that state and must not synthesize an artifact.
 */
export async function saveAgentMemoryExport(
  envelopeJson: string,
): Promise<AgentMemoryExportSaveResult> {
  if (!hasTauriInvoke()) {
    throw new Error('desktop_agent_memory_export_save requires Tauri runtime');
  }
  return invokeChecked(
    'desktop_agent_memory_export_save',
    { envelopeJson },
    parseAgentMemoryExportSaveResult,
  );
}
