import {
  createNimiRuntimeAgentMemoryExport,
  type NimiHostRuntimeAgentMemoryExportClient,
} from '@nimiplatform/sdk/runtime';
import {
  saveAgentMemoryExport,
  type AgentMemoryExportSaveResult,
} from '@renderer/bridge/runtime-bridge/agent-memory-export';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopRuntime,
} from './sdk/desktop-nimi-client-session';

/**
 * Hard per-export record ceiling. The SDK helper fails closed (no silent
 * truncation) when the canonical store holds more records than this; raising
 * the bound is an explicit product decision, not a tuning knob.
 */
const DESKTOP_MEMORY_EXPORT_MAX_RECORDS = 50_000;

export interface DesktopAgentMemoryExportOutcome extends AgentMemoryExportSaveResult {
  readonly recordCount: number;
  readonly bankCount: number;
}

function getDesktopAgentMemoryExportClient(): NimiHostRuntimeAgentMemoryExportClient {
  const accountRuntime = getDesktopAccountRuntime();
  return {
    appId: getDesktopAppId(),
    auth: accountRuntime.auth,
    appAuth: accountRuntime.grants,
    agent: getDesktopRuntime().agents,
  };
}

/**
 * Assemble the typed canonical-memory export envelope through the SDK helper
 * (S-SURFACE-015/016 non-authoritative posture) and persist it via the
 * classified desktop save command. The desktop host supplies the export
 * clock; the SDK owns no time authority.
 */
export async function exportDesktopAgentMemory(
  agentId: string,
): Promise<DesktopAgentMemoryExportOutcome> {
  const envelope = await createNimiRuntimeAgentMemoryExport(
    getDesktopAgentMemoryExportClient(),
    {
      agentId,
      exportedAt: new Date().toISOString(),
      maxRecords: DESKTOP_MEMORY_EXPORT_MAX_RECORDS,
      // First-party host: subject resolution stays with the SDK scope runner,
      // mirroring the runtime-agent-memory adapter posture.
      getSubjectUserId: () => undefined,
    },
  );
  const saved = await saveAgentMemoryExport(JSON.stringify(envelope, null, 2));
  return {
    ...saved,
    recordCount: envelope.records.length,
    bankCount: envelope.banks.length,
  };
}
