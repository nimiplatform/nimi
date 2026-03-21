import type { LocalAuditLedger } from '../audit/local-audit-ledger';
import type {
  DecisionRecord,
  InstallInput,
  LifecycleState,
  ModManifest,
} from '../contracts/types';
import { emitRuntimeLog } from '../../telemetry/logger';
import { extractRuntimeErrorFields } from '../../telemetry/error-fields';
import type { SandboxManager } from '../sandbox/sandbox-manager';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { createSecureIdSuffix } from '../../id.js';

export type RuntimeContext = {
  manifest: ModManifest;
  grantedCapabilities: string[];
  sandboxProfileId: string;
  instanceId: string;
  state: LifecycleState;
  mode: InstallInput['mode'];
};

export function buildDecisionRecord(
  modId: string,
  version: string,
  stage: DecisionRecord['stage'],
  result: DecisionRecord['result'],
  reasonCodes: string[],
): DecisionRecord {
  return {
    decisionId: `decision:${stage}:${Date.now().toString(36)}:${createSecureIdSuffix()}`,
    modId,
    version,
    stage,
    result,
    reasonCodes,
    createdAt: new Date().toISOString(),
  };
}

export function buildContextKey(modId: string, version: string): string {
  return `${modId}@${version}`;
}

export async function persistStageTrailRecords(
  audit: LocalAuditLedger,
  stageTrail: DecisionRecord[],
  eventType: string,
): Promise<void> {
  for (const item of stageTrail) {
    try {
      await audit.append({
        id: item.decisionId,
        modId: item.modId,
        stage: item.stage,
        eventType,
        decision: item.result,
        reasonCodes: item.reasonCodes,
        occurredAt: item.createdAt,
      });
    } catch (error) {
      const errorFields = extractRuntimeErrorFields(error);
      emitRuntimeLog({
        level: 'error',
        area: 'execution-kernel',
        message: 'action:audit-persistence:failed',
        traceId: errorFields.traceId,
        details: {
          decisionId: item.decisionId,
          modId: item.modId,
          stage: item.stage,
          eventType,
          reasonCode: errorFields.reasonCode,
          actionHint: errorFields.actionHint,
          retryable: errorFields.retryable,
          traceId: errorFields.traceId,
          error: errorFields.message || (error instanceof Error ? error.message : String(error || '')),
        },
      });
    }
  }
}

export function collectInstalledMods(contexts: Map<string, RuntimeContext>): Array<{
  modId: string;
  version: string;
  state: LifecycleState;
  mode: InstallInput['mode'];
}> {
  const result: Array<{
    modId: string;
    version: string;
    state: LifecycleState;
    mode: InstallInput['mode'];
  }> = [];
  for (const [, ctx] of contexts) {
    result.push({
      modId: ctx.manifest.id,
      version: ctx.manifest.version,
      state: ctx.state,
      mode: ctx.mode,
    });
  }
  return result;
}

export function resolveSandboxCapability(
  contexts: Map<string, RuntimeContext>,
  sandbox: SandboxManager,
  key: string,
  capability: string,
): { allowed: boolean; reasonCode: string } {
  const ctx = contexts.get(key);
  if (!ctx) {
    return { allowed: false, reasonCode: ReasonCode.MOD_NOT_INSTALLED };
  }
  return sandbox.checkCapability(ctx.sandboxProfileId, capability);
}
